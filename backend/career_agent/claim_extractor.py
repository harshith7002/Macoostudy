"""ClaimExtractor + JobDescriptionAnalyzer.

A claim is a verifiable statement in the resume (a bullet or sentence about
work done). Every claim must be a verbatim span of the resume text: model
output that can't be located in the resume is discarded, never invented.
"""
import json
import re

from .provider import run_task
from .rubric import COMPETENCY_NAMES
from .text_utils import (ACTION_VERBS, LEADERSHIP_VERBS, SKILL_COMPETENCY, find_skills, find_span,
                         normalize_ws, stable_id, truncate)

MAX_CLAIMS = 8
CLAIM_SECTIONS = ("experience", "projects", "leadership", "achievements", "summary")

CLAIMS_SCHEMA = {
    "type": "object",
    "required": ["claims"],
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["source_text", "line_index", "skills", "competency"],
                "properties": {
                    "source_text": {"type": "string"},
                    "line_index": {"type": "integer"},
                    "skills": {"type": "array", "items": {"type": "string"}},
                    "competency": {"type": "string", "enum": list(COMPETENCY_NAMES)},
                    "claim_summary": {"type": "string"},
                },
            },
        }
    },
}


# ── Job description ──────────────────────────────────────────────────────────

def analyze_job_description(jd_text, target_role=""):
    """Deterministic JD analysis: skills required and the competencies they imply."""
    skills = find_skills(f"{jd_text}\n{target_role}")
    competencies = {}
    for s in skills:
        comp = SKILL_COMPETENCY.get(s, "general_engineering")
        competencies[comp] = competencies.get(comp, 0) + 1
    if re.search(r"\b(lead|leadership|mentor|stakeholder|cross-functional)\b", jd_text or "", re.I):
        competencies["leadership_impact"] = competencies.get("leadership_impact", 0) + 1
    return {"skills": skills, "competencies": competencies}


# ── Claims ───────────────────────────────────────────────────────────────────

def _competency_for(text, skills):
    lowered = text.lower()
    if not skills and any(re.search(rf"\b{v}\b", lowered) for v in LEADERSHIP_VERBS):
        return "leadership_impact"
    counts = {}
    for s in skills:
        comp = SKILL_COMPETENCY.get(s, "general_engineering")
        counts[comp] = counts.get(comp, 0) + 1
    if not counts:
        return "general_engineering"
    return max(counts.items(), key=lambda kv: kv[1])[0]


def _relevance(skills, competency, jd):
    jd_skills = set(jd.get("skills", []))
    return len(jd_skills.intersection(skills)) + (1 if competency in jd.get("competencies", {}) else 0)


def heuristic_claims(parsed):
    """Pick bullet-like lines in work sections that state an action, ideally with tech or numbers."""
    candidates = []
    for line in parsed["lines"]:
        text = line["text"]
        if line["section"] not in CLAIM_SECTIONS or len(text) < 35 or len(text.split()) < 6:
            continue
        lowered = text.lower()
        verb = any(re.search(rf"\b{v}\b", lowered) for v in ACTION_VERBS)
        if not verb:
            continue
        skills = find_skills(text)
        number = bool(re.search(r"\d", text))
        strength = len(skills) * 2 + (2 if number else 0) + (1 if line["bullet"] else 0)
        candidates.append((strength, line, skills))
    candidates.sort(key=lambda c: c[0], reverse=True)
    claims = []
    for _, line, skills in candidates[: MAX_CLAIMS * 2]:
        claims.append({"source_text": line["text"], "line_index": line["index"], "skills": skills,
                       "competency": _competency_for(line["text"], skills),
                       "claim_summary": truncate(line["text"], 90)})
    return {"claims": claims}


def _llm_messages(parsed, jd, target_role, experience_level):
    numbered = "\n".join(f"[{l['index']}] ({l['section']}) {l['text']}" for l in parsed["lines"])[:12000]
    return [
        {"role": "system", "content": (
            "You extract verifiable technical claims from a resume for a skill audit. A claim is a statement "
            "of work the candidate did (built, designed, optimised, led...) that an interviewer could probe. "
            "Copy source_text VERBATIM from exactly one numbered line (it may be a sub-span of the line). "
            "Never paraphrase, merge lines, or invent claims. Skip contact info, education rows and bare "
            "skill lists. Prefer claims relevant to the target role. Return at most "
            f"{MAX_CLAIMS} claims. competency must be one of: {', '.join(COMPETENCY_NAMES)}.")},
        {"role": "user", "content": (
            f"Target role: {target_role or 'not specified'}\nExperience level: {experience_level or 'not specified'}\n"
            f"Skills the job description asks for: {', '.join(jd.get('skills', [])) or 'none detected'}\n\n"
            f"Resume lines:\n{numbered}\n\nReturn JSON: {json.dumps({'claims': [{'source_text': '...', 'line_index': 0, 'skills': ['...'], 'competency': 'backend_engineering', 'claim_summary': 'short neutral summary'}]})}")},
    ]


def ground_claims(raw_claims, parsed, jd):
    """Keep only claims that are real spans of the resume; attach offsets + stable IDs."""
    text, lines = parsed["text"], parsed["lines"]
    seen, out = set(), []
    for raw in raw_claims:
        source = normalize_ws(raw.get("source_text", ""))
        if len(source) < 20:
            continue
        span = None
        idx = raw.get("line_index")
        if isinstance(idx, int) and 0 <= idx < len(lines):
            line = lines[idx]
            local = find_span(line["text"], source)
            if local:
                span = (line["start"] + local[0], line["start"] + local[1])
        if span is None:
            span = find_span(text, source)
        if span is None:
            continue  # not in the resume -> never invent a claim
        exact = text[span[0]:span[1]]
        line = next((l for l in lines if l["start"] <= span[0] < l["end"] + 1), None)
        claim_id = stable_id("clm", exact)
        if claim_id in seen:
            continue
        seen.add(claim_id)
        lexicon_skills = find_skills(exact)
        skills = list(dict.fromkeys([s.lower() for s in (raw.get("skills") or []) if isinstance(s, str) and s.strip()]
                                    + lexicon_skills))[:8]
        competency = raw.get("competency") if raw.get("competency") in COMPETENCY_NAMES else _competency_for(exact, lexicon_skills)
        out.append({
            "id": claim_id,
            "source_text": exact,
            "start": span[0], "end": span[1],
            "line_index": line["index"] if line else None,
            "section": line["section"] if line else None,
            "skills": skills,
            "competency": competency,
            "summary": truncate(raw.get("claim_summary") or exact, 120),
            "relevance": _relevance(skills, competency, jd),
        })
        if len(out) >= MAX_CLAIMS:
            break
    # Most JD-relevant first, then resume order, so the interview probes what matters.
    out.sort(key=lambda c: (-c["relevance"], c["start"]))
    return out


def extract_claims(provider, parsed, jd, target_role="", experience_level=""):
    data, used = run_task(provider, "extract_claims", _llm_messages(parsed, jd, target_role, experience_level),
                          CLAIMS_SCHEMA, lambda: heuristic_claims(parsed), max_tokens=2500)
    claims = ground_claims(data.get("claims", []), parsed, jd)
    if not claims and used["provider"] != "offline":
        # The model returned nothing we could ground; fall back to the deterministic picker.
        claims = ground_claims(heuristic_claims(parsed)["claims"], parsed, jd)
        used = {**used, "provider": "offline", "model": None, "fallback": True, "error": "no grounded claims from model"}
    return claims, used
