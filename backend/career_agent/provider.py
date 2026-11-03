"""ModelProvider abstraction.

Every model call in the Career Agent goes through `ModelProvider.complete_json`,
which asks for structured JSON, validates it against a small JSON schema,
retries on malformed output / rate limits / timeouts, and logs without secrets.

Providers, in priority order (see `get_provider`):
  * MetaProvider    - Meta Model API (https://api.meta.ai/v1, OpenAI-compatible
                      chat completions, `MODEL_API_KEY`, default `muse-spark-1.3`).
  * GroqProvider    - the app's existing Groq client + `get_best_model()` fallback.
  * OfflineProvider - deterministic heuristics, no LLM. Used when no credentials
                      exist or as a labelled fallback when a live call fails.
"""
import json
import logging
import os
import random
import re
import time

import requests

log = logging.getLogger("career_agent.provider")
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("[CareerAgent] %(levelname)s %(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)

META_BASE_URL = "https://api.meta.ai/v1"
META_DEFAULT_MODEL = "muse-spark-1.3"
META_DOCUMENTED_MODELS = ("muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1", "muse-wonder-1.0")


class ProviderError(Exception):
    """A model call failed after retries (or could not be attempted)."""


class RetryableError(Exception):
    def __init__(self, message, retry_after=None):
        super().__init__(message)
        self.retry_after = retry_after


# ── JSON parsing + validation ────────────────────────────────────────────────

def parse_json(raw):
    """Parse model output into a dict, tolerating code fences and leading prose."""
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("empty model output")
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def validate(schema, data, path="$"):
    """Minimal JSON-schema validator (type/properties/required/items/enum).

    Returns a list of error strings; empty means valid.
    """
    errors = []
    expected = schema.get("type")
    type_map = {"object": dict, "array": list, "string": str, "boolean": bool,
                "integer": int, "number": (int, float)}
    if expected:
        py_type = type_map[expected]
        if not isinstance(data, py_type) or (expected in ("integer", "number") and isinstance(data, bool)):
            return [f"{path}: expected {expected}"]
    if "enum" in schema and data not in schema["enum"]:
        errors.append(f"{path}: {data!r} not in {schema['enum']}")
    if expected == "object":
        for key in schema.get("required", []):
            if key not in data:
                errors.append(f"{path}.{key}: missing")
        for key, sub in schema.get("properties", {}).items():
            if key in data:
                errors.extend(validate(sub, data[key], f"{path}.{key}"))
    if expected == "array" and "items" in schema:
        for i, item in enumerate(data):
            errors.extend(validate(schema["items"], item, f"{path}[{i}]"))
    return errors


# ── Base provider ────────────────────────────────────────────────────────────

class ModelProvider:
    name = "base"
    is_meta = False
    is_llm = True

    def __init__(self, model=None, timeout=None, max_retries=None):
        self.model = model
        self.timeout = timeout or float(os.environ.get("CAREER_AGENT_TIMEOUT", "40"))
        self.max_retries = 2 if max_retries is None else max_retries

    @property
    def label(self):
        return f"{self.display_name} · {self.model}" if self.model else self.display_name

    display_name = "Model"

    def describe(self):
        return {"provider": self.name, "model": self.model, "is_meta": self.is_meta,
                "is_llm": self.is_llm, "label": self.label}

    def _chat(self, messages, schema, task, max_tokens):  # pragma: no cover - abstract
        raise NotImplementedError

    def complete_json(self, task, messages, schema, context=None, max_tokens=1500):
        """Run a structured-output call and return validated JSON (dict)."""
        attempt_messages = list(messages)
        last_error = None
        for attempt in range(self.max_retries + 1):
            started = time.time()
            try:
                raw = self._chat(attempt_messages, schema, task, max_tokens)
            except RetryableError as exc:
                last_error = exc
                wait = exc.retry_after if exc.retry_after is not None else (0.6 * (2 ** attempt) + random.random() * 0.3)
                wait = min(float(wait), 8.0)
                log.warning("task=%s provider=%s attempt=%d retryable error: %s (sleep %.1fs)",
                            task, self.name, attempt + 1, exc, wait)
                if attempt < self.max_retries:
                    time.sleep(wait)
                continue
            except ProviderError:
                raise
            except Exception as exc:  # unexpected client failure: don't retry blindly
                raise ProviderError(f"{type(exc).__name__}: {exc}") from exc

            elapsed = time.time() - started
            try:
                data = parse_json(raw)
                errors = validate(schema, data)
            except (ValueError, json.JSONDecodeError) as exc:
                errors = [f"invalid JSON: {exc}"]
                data = None
            if not errors:
                log.info("task=%s provider=%s model=%s ok in %.1fs", task, self.name, self.model, elapsed)
                return data
            last_error = ProviderError("; ".join(errors[:5]))
            log.warning("task=%s provider=%s attempt=%d malformed output: %s", task, self.name, attempt + 1,
                        "; ".join(errors[:3]))
            attempt_messages = list(messages) + [
                {"role": "assistant", "content": (raw if isinstance(raw, str) else json.dumps(raw))[:4000]},
                {"role": "user", "content": "Your previous reply was not valid for the required JSON schema ("
                 + "; ".join(errors[:5]) + "). Reply again with ONLY a JSON object matching the schema."},
            ]
        raise ProviderError(f"{task}: {last_error}")


# ── Meta Model API ───────────────────────────────────────────────────────────

class MetaProvider(ModelProvider):
    name = "meta"
    is_meta = True
    display_name = "Meta Model API"

    def __init__(self, api_key, model=None, base_url=None, **kw):
        super().__init__(model=model or os.environ.get("META_MODEL", "").strip() or META_DEFAULT_MODEL, **kw)
        self._api_key = api_key
        self.base_url = (base_url or os.environ.get("META_BASE_URL", META_BASE_URL)).rstrip("/")

    def _chat(self, messages, schema, task, max_tokens):
        body = {
            "model": self.model,
            "messages": messages,
            "max_completion_tokens": max_tokens,
            "temperature": 0.3,
            "response_format": {"type": "json_schema", "json_schema": {"name": task, "schema": schema}},
        }
        effort = os.environ.get("META_REASONING_EFFORT", "low")
        if effort:
            body["reasoning_effort"] = effort
        try:
            res = requests.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                json=body, timeout=self.timeout,
            )
        except requests.Timeout as exc:
            raise RetryableError("timeout") from exc
        except requests.ConnectionError as exc:
            raise RetryableError("connection error") from exc
        if res.status_code in (429, 500, 502, 503):
            retry_after = res.headers.get("Retry-After")
            raise RetryableError(f"HTTP {res.status_code}", float(retry_after) if retry_after and retry_after.isdigit() else None)
        if res.status_code >= 400:
            try:
                msg = res.json().get("error", {})
                msg = msg.get("message") if isinstance(msg, dict) else msg
            except ValueError:
                msg = ""
            raise ProviderError(f"Meta Model API HTTP {res.status_code}: {str(msg)[:200]}")
        payload = res.json()
        choice = (payload.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content")
        if not content:
            raise RetryableError(f"empty content (finish_reason={choice.get('finish_reason')})")
        return content


# ── Groq (existing app client) ───────────────────────────────────────────────

class GroqProvider(ModelProvider):
    name = "groq"
    display_name = "Groq (Llama fallback)"

    def __init__(self, client, model_resolver, **kw):
        super().__init__(model=None, **kw)
        self._client = client
        self._resolve = model_resolver

    @property
    def label(self):
        return f"{self.display_name} · {self.model or 'auto'}"

    def _chat(self, messages, schema, task, max_tokens):
        if not self.model:
            self.model = self._resolve()
        schema_hint = {"role": "system", "content": "Return ONLY a JSON object matching this JSON schema: "
                       + json.dumps(schema)}
        try:
            res = self._client.chat.completions.create(
                model=self.model,
                messages=[schema_hint] + list(messages),
                temperature=0.3,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
                timeout=self.timeout,
            )
        except Exception as exc:
            text = str(exc).lower()
            if "429" in text or "rate" in text or "timeout" in text or "timed out" in text or "503" in text:
                raise RetryableError(type(exc).__name__) from exc
            raise ProviderError(f"Groq error: {type(exc).__name__}") from exc
        return res.choices[0].message.content


# ── Offline heuristics ───────────────────────────────────────────────────────

class OfflineProvider(ModelProvider):
    """No LLM: each task is answered by a deterministic heuristic.

    The heuristics live next to the component that owns the task and are passed
    in through `context["heuristic"]`, so this class only dispatches.
    """
    name = "offline"
    is_llm = False
    display_name = "Offline heuristics (no LLM)"

    def __init__(self, reason="no model credentials configured"):
        super().__init__(model=None, max_retries=0)
        self.reason = reason

    def describe(self):
        info = super().describe()
        info["reason"] = self.reason
        return info

    def complete_json(self, task, messages, schema, context=None, max_tokens=1500):
        heuristic = (context or {}).get("heuristic")
        if heuristic is None:
            raise ProviderError(f"{task}: no offline heuristic available")
        data = heuristic()
        errors = validate(schema, data)
        if errors:
            raise ProviderError(f"{task}: heuristic produced invalid output: {errors[:3]}")
        return data


def run_task(provider, task, messages, schema, heuristic, max_tokens=1500):
    """Call the provider; on failure fall back to the heuristic.

    Returns (data, used) where `used` describes what actually produced the data,
    so the UI and stored logs never claim a model that wasn't used.
    """
    if not provider.is_llm:
        data = provider.complete_json(task, messages, schema, {"heuristic": heuristic}, max_tokens)
        return data, {"task": task, "provider": "offline", "model": None, "fallback": False}
    try:
        data = provider.complete_json(task, messages, schema, None, max_tokens)
        return data, {"task": task, "provider": provider.name, "model": provider.model, "fallback": False}
    except ProviderError as exc:
        log.warning("task=%s provider=%s failed, using offline heuristic: %s", task, provider.name, exc)
        data = heuristic()
        return data, {"task": task, "provider": "offline", "model": None, "fallback": True,
                      "failed_provider": provider.name, "error": str(exc)[:200]}


_provider_override = None


def set_provider(provider):
    """Test hook / explicit injection."""
    global _provider_override
    _provider_override = provider


def get_provider(groq_client=None, groq_model_resolver=None):
    if _provider_override is not None:
        return _provider_override
    forced = os.environ.get("CAREER_AGENT_PROVIDER", "").strip().lower()
    meta_key = os.environ.get("MODEL_API_KEY", "").strip() or os.environ.get("META_MODEL_API_KEY", "").strip()
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if forced == "offline":
        return OfflineProvider(reason="CAREER_AGENT_PROVIDER=offline")
    if meta_key and forced in ("", "meta"):
        return MetaProvider(meta_key)
    if groq_key and groq_client is not None and forced in ("", "groq"):
        return GroqProvider(groq_client, groq_model_resolver)
    return OfflineProvider()
