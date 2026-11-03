"""EvidenceExtractor and AdaptiveQuestionEngine.

Evidence is always a verbatim quote from a real candidate answer; anything the
model returns that isn't in the transcript is dropped. Questions target one
rubric criterion chosen by the backend's coverage logic and are rejected if
they repeat an earlier question.
"""
import json
import re

from .provider import run_task
from .rubric import criteria_for
from .text_utils import find_skills, find_span, is_repeat, normalize_ws, split_sentences, stable_id, truncate

UNCERTAIN = ("don't know", "dont know", "do not know", "not sure", "no idea", "can't remember", "cannot remember",
             "don't remember", "dont remember", "never did", "wasn't me", "someone else handled", "i forget",
             "not really sure", "i guess", "no clue")

EVIDENCE_SCHEMA = {
    "type": "object",
    "required": ["evidence"],
    "properties": {"evidence": {"type": "array", "items": {
        "type": "object",
        "required": ["quote", "criterion_ids", "signal"],
        "properties": {
            "quote": {"type": "string"},
            "criterion_ids": {"type": "array", "items": {"type": "string"}},
            "signal": {"type": "string", "enum": ["positive", "negative", "neutral"]},
            "note": {"type": "string"},
        }}}},
}

QUESTION_SCHEMA = {
    "type": "object",
    "required": ["question"],
    "properties": {"question": {"type": "string"}, "rationale": {"type": "string"}},
}


# ── Evidence ─────────────────────────────────────────────────────────────────

def heuristic_evidence(answer, competency, target_criterion=None):
    crits = criteria_for(competency)
    items = []
    for sentence in split_sentences(answer):
        lowered = " " + sentence.lower() + " "
        if any(u in lowered for u in UNCERTAIN):
            items.append({"quote": sentence, "criterion_ids": [target_criterion] if target_criterion else [],
                          "signal": "negative", "note": "Candidate expressed uncertainty."})
            continue
        if len(sentence.split()) < 6:
            continue
        matched = [c["id"] for c in crits if any(k in lowered for k in c["keywords"])]
        # Concrete technical vocabulary counts as implementation detail.
        if find_skills(sentence) and "implementation" in [c["id"] for c in crits] and "implementation" not in matched:
            matched.append("implementation")
        if re.search(r"\d", sentence) and "validation" in [c["id"] for c in crits] and "validation" not in matched:
            matched.append("validation")
        if matched:
            items.append({"quote": sentence, "criterion_ids": matched, "signal": "positive",
                          "note": "Mentions " + ", ".join(c["name"].lower() for c in crits if c["id"] in matched) + "."})
    return {"evidence": items}


def extract_evidence(provider, claim, question, answer_msg):
    """Return (evidence_records, used). Each record quotes `answer_msg` verbatim."""
    competency = claim["competency"]
    crits = criteria_for(competency)
    answer = answer_msg["content"]
    target = question.get("criterion_id")
    messages = [
        {"role": "system", "content": (
            "You map a candidate's interview answer to rubric criteria. Return excerpts that are copied "
            "VERBATIM from the answer (no paraphrase, no added words). Mark signal=positive when the excerpt "
            "demonstrates the criterion, negative when it shows the candidate does not know, neutral otherwise. "
            "Only use the criterion ids given. If nothing in the answer is relevant, return an empty list. "
            "Judge understanding, never honesty.")},
        {"role": "user", "content": (
            f"Resume claim: {claim['source_text']}\nQuestion: {question['content']}\n"
            f"Criteria: {json.dumps([{'id': c['id'], 'description': c['description']} for c in crits])}\n"
            f"Answer:\n\"\"\"{answer}\"\"\"")},
    ]
    data, used = run_task(provider, "extract_evidence", messages, EVIDENCE_SCHEMA,
                          lambda: heuristic_evidence(answer, competency, target), max_tokens=1200)
    valid_ids = {c["id"] for c in crits}
    records, seen = [], set()
    for item in data.get("evidence", []):
        quote = normalize_ws(item.get("quote", ""))
        span = find_span(answer, quote) if quote else None
        if not span:
            continue  # never keep text the candidate didn't say
        exact = answer[span[0]:span[1]]
        crit_ids = [c for c in item.get("criterion_ids", []) if c in valid_ids]
        if not crit_ids and item.get("signal") != "negative":
            continue
        rid = stable_id("ev", answer_msg["id"], exact)
        if rid in seen:
            continue
        seen.add(rid)
        records.append({"id": rid, "claim_id": claim["id"], "message_id": answer_msg["id"], "quote": exact,
                        "start": span[0], "end": span[1], "criterion_ids": crit_ids,
                        "signal": item.get("signal", "neutral"), "note": truncate(item.get("note", ""), 200)})
    return records, used


# ── Questions ────────────────────────────────────────────────────────────────

_FIRST = {
    "implementation": "Walk me through how you implemented this: “{snippet}”. What were the main pieces{skills}, and which part did you build yourself?",
    "design_rationale": "Why did you choose {approach} for “{snippet}”? What requirement drove that decision?",
    "tradeoffs": "What alternative to {approach} did you consider for “{snippet}”, and what did you give up by not choosing it?",
    "failure_handling": "Tell me about a time “{snippet}” broke or behaved unexpectedly. How did you find out, and what did you change?",
    "validation": "How did you verify that “{snippet}” actually worked?{metric}",
    "api_contracts": "How did you design the API contract for this — input validation, error responses, and what happens if the same request arrives twice?",
    "state_rendering": "Where did the UI state live in this project, and how did you keep re-renders and loading states under control?",
    "evaluation_method": "How did you evaluate this — what data did you test on, and what baseline did you compare against?",
    "data_modeling": "Walk me through the data model behind this. Which queries mattered most, and did you add indexes or caching for them?",
    "operations": "How was this deployed and configured, and how would you roll back a bad release?",
    "platform_constraints": "What platform constraints shaped this (lifecycle, offline use, permissions, performance), and how did you handle them?",
    "problem_framing": "What problem was “{snippet}” solving, for whom, and what constraints did you have?",
    "scope_ownership": "For “{snippet}”: how big was the team, and which decisions were yours specifically?",
    "decision_making": "What was the hardest decision you made while doing this, and why did you make it that way?",
    "conflict_tradeoffs": "Was there a disagreement or competing priority during this? How was it resolved?",
    "setbacks": "What went wrong along the way, and how did you respond?",
    "outcome": "What measurable result came out of this, and how was it measured?{metric}",
}

_FOLLOW = {
    "implementation": "You mentioned {term}. Concretely, how did {term} fit into the implementation — what called it and what did it hand back?",
    "design_rationale": "You brought up {term}. What made that the right choice at the time rather than something simpler?",
    "tradeoffs": "If this had ten times the traffic or data, would {term} still hold up? What trade-off would change?",
    "failure_handling": "You mentioned {term}. What's the most likely way that part fails in production, and how would you or a user notice?",
    "validation": "How would you prove that {term} actually improved things — what would you measure and compare against?",
    "api_contracts": "Around {term}: how do clients know a request failed, and is retrying it safe?",
    "state_rendering": "With {term} in the picture, what triggered re-renders, and how did you avoid unnecessary ones?",
    "evaluation_method": "How did you check that the results from {term} weren't just fitting your test data?",
    "data_modeling": "For {term}, what did the schema look like, and which query would get slow first as data grows?",
    "operations": "If the deployment involving {term} failed at 2am, what would you look at first?",
    "platform_constraints": "How does {term} behave when the app is backgrounded or offline?",
    "problem_framing": "You mentioned {term}. Who was affected by that problem, and how did you know it mattered?",
    "scope_ownership": "You mentioned {term}. Which part of that did you own end to end?",
    "decision_making": "Regarding {term}: what options did you weigh before deciding?",
    "conflict_tradeoffs": "When {term} came up, who disagreed, and what was their argument?",
    "setbacks": "What did {term} teach you that you'd do differently next time?",
    "outcome": "You mentioned {term}. What was the before/after number, and over what period?",
}

_FOLLOW_ALT = {
    "implementation": "Let's zoom in on {term}: what data went in, what came out, and where did it live in the codebase?",
    "design_rationale": "Why {term} specifically? What would have pushed you towards a different option?",
    "tradeoffs": "What did {term} cost you — in complexity, latency, money or flexibility — and was it worth it?",
    "failure_handling": "Suppose {term} misbehaves under load. Walk me through how you'd detect it and what you'd do in the first ten minutes.",
    "validation": "How did you confirm {term} was working as intended — tests, metrics, or something else?",
}

_GENERIC_FOLLOW = {
    "implementation": "Let's go one level deeper on how this was built. Pick one component and walk me through its inputs, outputs and the trickiest line of logic.",
    "design_rationale": "Looking back, which design choice in this work are you most confident about, and what made you confident?",
    "tradeoffs": "Name one thing you deliberately did not optimise in this work. Why was that acceptable?",
    "failure_handling": "What is the most likely way this breaks in production, and what is your plan when it does?",
    "validation": "If a reviewer doubted that this worked, what test or measurement would you show them?",
}

_STOP = {"the", "and", "that", "this", "with", "then", "into", "from", "they", "were", "have", "which", "what",
         "when", "where", "there", "about", "because", "would", "could", "should", "using", "used", "just", "also",
         "really", "some", "very", "like", "make", "made", "able", "data", "thing", "things", "work", "worked"}


CONCEPTS = ("idempotency key", "idempotency", "cache invalidation", "cache", "ttl", "transaction", "index",
            "retry", "retries", "queue", "webhook", "schema", "migration", "load test", "rate limit", "timeout",
            "connection pool", "background job", "worker", "pagination", "authentication", "token", "replica",
            "sharding", "batch", "pipeline", "container", "rollback", "feature flag", "unit test", "integration test",
            "state", "hook", "memoization", "lazy loading", "endpoint", "middleware", "logging", "alert", "baseline",
            "dataset", "embedding", "prompt", "fine-tuning", "sprint", "deadline", "stakeholder")


def _key_term(answer, avoid):
    """Pick a concrete thing the candidate actually said, to anchor a follow-up."""
    lowered = answer.lower()
    found = [s for s in find_skills(answer) if s not in avoid]
    found += [c for c in CONCEPTS if re.search(rf"\b{re.escape(c)}\b", lowered) and c not in avoid]
    if found:
        return max(found, key=len)  # the most specific phrase they used
    # Code-like identifiers: camelCase, snake_case, dotted names.
    for tok in re.findall(r"\b[A-Za-z][A-Za-z0-9]*(?:[_.][A-Za-z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]+\b", answer):
        if tok.lower() not in avoid:
            return tok
    return None


def heuristic_question(claim, criterion, claim_history, all_previous):
    snippet = truncate(claim["source_text"], 110)
    skills = claim.get("skills") or []
    approach = skills[0] if skills else "that approach"
    metric = ""
    number = re.search(r"\d[\d,.]*\s*(%|x|ms|k|users|seconds|s\b)?", claim["source_text"])
    if number:
        metric = f" The resume mentions “{number.group(0).strip()}” — how was that measured, and against what baseline?"
    skills_part = f" (you list {', '.join(skills[:3])})" if skills else ""
    asked_text = " ".join(normalize_ws(q).lower() for q in all_previous)
    candidates = []
    last_answer = next((m["content"] for m in reversed(claim_history) if m["role"] == "answer"), None)
    if last_answer:
        term = _key_term(last_answer, asked_text)
        if term:
            for table in (_FOLLOW, _FOLLOW_ALT):
                if criterion["id"] in table:
                    candidates.append(table[criterion["id"]].format(term=term))
        if criterion["id"] in _GENERIC_FOLLOW:
            candidates.append(_GENERIC_FOLLOW[criterion["id"]])
    candidates.append(_FIRST.get(criterion["id"], "Tell me more about {snippet}.").format(
        snippet=snippet, skills=skills_part, approach=approach, metric=metric))
    candidates.append(f"On “{snippet}”, focusing on {criterion['name'].lower()}: {criterion['description']} Can you give a specific example?")
    for q in candidates:
        if not is_repeat(q, all_previous):
            return {"question": q, "rationale": f"Targets {criterion['name']}."}
    return {"question": candidates[-1] + f" (Part {len(claim_history) // 2 + 1})", "rationale": "fallback"}


def generate_question(provider, claim, criterion, claim_history, all_previous, experience_level=""):
    """Return (question_text, used). The question is grounded in claim + transcript."""
    transcript = "\n".join(f"{'Interviewer' if m['role'] == 'question' else 'Candidate'}: {m['content']}"
                           for m in claim_history[-6:]) or "(no questions asked yet about this claim)"
    messages = [
        {"role": "system", "content": (
            "You are a senior technical interviewer running a skill audit. Ask ONE question (max 45 words) "
            "about the given resume claim that probes the target rubric criterion: implementation decisions, "
            "trade-offs or failure scenarios. If the candidate already answered about this claim, build on a "
            "specific thing they actually said. Do not repeat or rephrase earlier questions. Be neutral and "
            "respectful; never imply the candidate is lying.")},
        {"role": "user", "content": (
            f"Experience level: {experience_level or 'not specified'}\nResume claim: {claim['source_text']}\n"
            f"Skills: {', '.join(claim.get('skills') or []) or 'n/a'}\n"
            f"Target criterion: {criterion['name']} — {criterion['description']}\n"
            f"Transcript for this claim:\n{transcript}\n"
            f"Earlier questions (do not repeat): {json.dumps(all_previous[-12:])}\n"
            "Return JSON {\"question\": \"...\", \"rationale\": \"...\"}")},
    ]
    heuristic = lambda: heuristic_question(claim, criterion, claim_history, all_previous)
    data, used = run_task(provider, "generate_question", messages, QUESTION_SCHEMA, heuristic, max_tokens=400)
    question = normalize_ws(data.get("question", ""))
    if len(question) < 12 or is_repeat(question, all_previous):
        data = heuristic()
        question = data["question"]
        used = {**used, "provider": "offline", "model": None, "fallback": True, "error": "repeated or empty question"}
    return question, used
