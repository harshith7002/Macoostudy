"""RubricEngine: per-competency criteria with point values + deterministic scoring.

The model (or heuristic) only labels each criterion `demonstrated`, `partial`
or `not_demonstrated` and cites evidence IDs. Everything numeric - points,
claim scores, statuses, readiness - is computed here.
"""

LABEL_WEIGHT = {"demonstrated": 1.0, "partial": 0.5, "not_demonstrated": 0.0}
LABELS = tuple(LABEL_WEIGHT)
GAP_TYPES = ("knowledge_gap", "weak_articulation", "insufficient_evidence")

STATUS_SUPPORTED = "SUPPORTED"
STATUS_PARTIAL = "PARTIALLY SUPPORTED"
STATUS_INSUFFICIENT = "INSUFFICIENT EVIDENCE"
SUPPORTED_THRESHOLD = 70
PARTIAL_THRESHOLD = 35

# Keywords double as heuristic signals for offline evidence mapping.
_CORE = [
    {"id": "implementation", "name": "Implementation detail", "points": 25,
     "description": "Explains concretely what they personally built and how: components, data flow, tools actually used.",
     "focus": "implementation",
     "keywords": ["implemented", "built", "wrote", "used", "endpoint", "function", "module", "component", "class",
                  "pipeline", "schema", "query", "service", "library", "configured", "integrated", "called"]},
    {"id": "design_rationale", "name": "Design rationale", "points": 15,
     "description": "Explains why a design, tool or approach was chosen for this problem.",
     "focus": "decision",
     "keywords": ["because", "so that", "decided", "chose", "picked", "reason", "goal", "requirement", "needed to"]},
    {"id": "tradeoffs", "name": "Trade-off awareness", "points": 20,
     "description": "Names realistic alternatives and the costs/benefits of the chosen option.",
     "focus": "trade-off",
     "keywords": ["trade-off", "tradeoff", "instead of", "rather than", "alternative", "downside", "cost",
                  "slower", "faster", "simpler", "complexity", "versus", " vs ", "compared to", "at the expense"]},
    {"id": "failure_handling", "name": "Failure handling & debugging", "points": 20,
     "description": "Describes a concrete failure mode, how it was detected, and how it was handled or prevented.",
     "focus": "failure",
     "keywords": ["fail", "failure", "error", "bug", "crash", "retry", "fallback", "timeout", "outage", "debug",
                  "edge case", "race condition", "rollback", "broke", "exception", "logs", "alert"]},
    {"id": "validation", "name": "Validation & measurement", "points": 10,
     "description": "Explains how results were tested or measured, ideally with concrete numbers.",
     "focus": "measurement",
     "keywords": ["measured", "metric", "benchmark", "test", "tested", "unit test", "latency", "p95", "accuracy",
                  "%", "percent", "ms", "seconds", "users", "monitor", "a/b"]},
]

_DOMAIN = {
    "backend_engineering": {"id": "api_contracts", "name": "API & data contracts", "points": 10,
                            "description": "Discusses API design, validation, idempotency, auth or versioning.",
                            "focus": "implementation",
                            "keywords": ["api", "endpoint", "idempot", "validation", "auth", "status code", "versioning",
                                         "pagination", "webhook", "contract", "payload"]},
    "frontend_engineering": {"id": "state_rendering", "name": "State & rendering", "points": 10,
                             "description": "Discusses state management, rendering performance or accessibility.",
                             "focus": "implementation",
                             "keywords": ["state", "render", "re-render", "hook", "memo", "props", "context", "bundle",
                                          "lazy", "accessibility", "responsive", "component"]},
    "data_ml": {"id": "evaluation_method", "name": "Data & evaluation method", "points": 10,
                "description": "Discusses data quality, evaluation methodology, baselines or leakage.",
                "focus": "measurement",
                "keywords": ["dataset", "train", "validation set", "test set", "baseline", "overfit", "leakage", "eval",
                             "precision", "recall", "f1", "prompt", "hallucinat", "label"]},
    "databases": {"id": "data_modeling", "name": "Data modelling & queries", "points": 10,
                  "description": "Discusses schema design, indexing, transactions or query performance.",
                  "focus": "implementation",
                  "keywords": ["index", "schema", "table", "join", "transaction", "normaliz", "query plan", "migration",
                               "foreign key", "constraint", "cache", "ttl"]},
    "devops_cloud": {"id": "operations", "name": "Deployment & operations", "points": 10,
                     "description": "Discusses deployment, configuration, observability or rollback.",
                     "focus": "failure",
                     "keywords": ["deploy", "container", "environment variable", "env var", "pipeline", "monitor", "logs",
                                  "rollback", "scaling", "health check", "cold start", "config"]},
    "mobile": {"id": "platform_constraints", "name": "Platform constraints", "points": 10,
               "description": "Discusses app lifecycle, offline behaviour, performance or platform APIs.",
               "focus": "trade-off",
               "keywords": ["lifecycle", "offline", "battery", "permission", "background", "frame", "store", "device"]},
    "general_engineering": {"id": "problem_framing", "name": "Problem framing", "points": 10,
                            "description": "Explains the problem, constraints and who it was for.",
                            "focus": "decision",
                            "keywords": ["problem", "constraint", "users", "requirement", "scope", "deadline", "goal"]},
}

_LEADERSHIP = [
    {"id": "scope_ownership", "name": "Scope & ownership", "points": 25,
     "description": "Explains team size, their own responsibilities and what they personally decided.",
     "focus": "implementation",
     "keywords": ["team", "i was responsible", "my role", "owned", "people", "members", "assigned", "i led"]},
    {"id": "decision_making", "name": "Decision making", "points": 20,
     "description": "Explains a concrete decision they made and why.",
     "focus": "decision", "keywords": ["decided", "because", "prioriti", "chose", "plan", "reason"]},
    {"id": "conflict_tradeoffs", "name": "Conflict & trade-offs", "points": 20,
     "description": "Describes disagreement or competing priorities and how they were resolved.",
     "focus": "trade-off", "keywords": ["disagree", "conflict", "trade-off", "compromise", "pushback", "instead"]},
    {"id": "setbacks", "name": "Handling setbacks", "points": 20,
     "description": "Describes something that went wrong and how they responded.",
     "focus": "failure", "keywords": ["missed", "late", "fail", "problem", "issue", "went wrong", "recover", "learned"]},
    {"id": "outcome", "name": "Measurable outcome", "points": 15,
     "description": "States a measurable result and how it was measured.",
     "focus": "measurement", "keywords": ["%", "result", "outcome", "metric", "delivered", "improved", "measured"]},
]

COMPETENCY_NAMES = {
    "backend_engineering": "Backend engineering",
    "frontend_engineering": "Frontend engineering",
    "data_ml": "Data & ML",
    "databases": "Databases",
    "devops_cloud": "DevOps & cloud",
    "mobile": "Mobile",
    "leadership_impact": "Leadership & impact",
    "general_engineering": "General engineering",
}


def criteria_for(competency):
    """Return the criteria list (copies) for a competency; total points = 100."""
    if competency == "leadership_impact":
        return [dict(c) for c in _LEADERSHIP]
    domain = _DOMAIN.get(competency, _DOMAIN["general_engineering"])
    return [dict(c) for c in _CORE] + [dict(domain)]


def all_competencies():
    return {key: {"name": name, "criteria": criteria_for(key)} for key, name in COMPETENCY_NAMES.items()}


def sanitize_labels(competency, raw_labels, valid_evidence_ids, criterion_was_probed=None, answered=True):
    """Clamp model/heuristic labels into a trustworthy rubric result.

    - unknown criteria are ignored, missing ones default to not_demonstrated
    - demonstrated/partial without any *valid* cited evidence is downgraded
    - gap types are restricted to the allowed set; a criterion with no evidence
      that was never probed (or with no answers at all) is insufficient_evidence
    """
    criterion_was_probed = criterion_was_probed or {}
    by_id = {r.get("criterion_id"): r for r in (raw_labels or []) if isinstance(r, dict)}
    results = []
    for crit in criteria_for(competency):
        raw = by_id.get(crit["id"], {})
        label = raw.get("label") if raw.get("label") in LABEL_WEIGHT else "not_demonstrated"
        cited = [e for e in (raw.get("evidence_ids") or []) if e in valid_evidence_ids]
        if label != "not_demonstrated" and not cited:
            label = "not_demonstrated"
        gap_type = None
        if label != "demonstrated":
            gap_type = raw.get("gap_type") if raw.get("gap_type") in GAP_TYPES else None
            if not answered or (not cited and not criterion_was_probed.get(crit["id"])):
                gap_type = "insufficient_evidence"
            elif gap_type is None:
                gap_type = "weak_articulation" if label == "partial" else "knowledge_gap"
        awarded = round(crit["points"] * LABEL_WEIGHT[label], 2)
        results.append({
            "criterion_id": crit["id"], "criterion_name": crit["name"], "description": crit["description"],
            "label": label, "points_possible": crit["points"], "points_awarded": awarded,
            "evidence_ids": cited if label != "not_demonstrated" else [],
            "rationale": str(raw.get("rationale") or "")[:400],
            "gap_type": gap_type,
        })
    return results


def score_results(results):
    possible = sum(r["points_possible"] for r in results) or 1
    awarded = sum(r["points_awarded"] for r in results)
    return round(100.0 * awarded / possible, 1)


def status_for(score, answered):
    if not answered:
        return STATUS_INSUFFICIENT
    if score >= SUPPORTED_THRESHOLD:
        return STATUS_SUPPORTED
    if score >= PARTIAL_THRESHOLD:
        return STATUS_PARTIAL
    return STATUS_INSUFFICIENT


def explain(results, status):
    """Deterministic, neutral explanation. Never implies dishonesty."""
    shown = [r["criterion_name"] for r in results if r["label"] == "demonstrated"]
    partial = [r["criterion_name"] for r in results if r["label"] == "partial"]
    missing = [r["criterion_name"] for r in results if r["label"] == "not_demonstrated"]
    parts = []
    if shown:
        parts.append("Clearly explained: " + ", ".join(shown) + ".")
    if partial:
        parts.append("Partly explained: " + ", ".join(partial) + ".")
    if missing:
        parts.append("Not yet shown in the interview: " + ", ".join(missing) + ".")
    if status == STATUS_INSUFFICIENT:
        parts.append("The interview did not produce enough evidence to support this claim yet. "
                     "That says nothing about whether the work happened, only about what was explained.")
    return " ".join(parts)


def recommend(results):
    gaps = sorted((r for r in results if r["label"] != "demonstrated"),
                  key=lambda r: r["points_possible"] - r["points_awarded"], reverse=True)
    if not gaps:
        return "Keep this claim as written and be ready to tell the same story with the same level of detail."
    top = gaps[0]
    advice = {
        "knowledge_gap": "Review the underlying concept before interviews",
        "weak_articulation": "Practise a structured answer (context, decision, alternative, result)",
        "insufficient_evidence": "Prepare a concrete example you can walk through",
    }[top["gap_type"] or "insufficient_evidence"]
    return f"{advice} for {top['criterion_name'].lower()}: {top['description']}"


def readiness(claim_rows):
    """Weighted mean of interviewed claim scores; JD-relevant claims weigh more."""
    assessed = [c for c in claim_rows if c.get("interviewed")]
    if not assessed:
        return 0.0
    total_w = sum(1.0 + min(c.get("relevance", 0), 3) * 0.5 for c in assessed)
    total = sum((c.get("score") or 0) * (1.0 + min(c.get("relevance", 0), 3) * 0.5) for c in assessed)
    return round(total / total_w, 1)


def provisional_labels(competency, evidence, probed):
    """Heuristic labeller from positive evidence (also used for live updates)."""
    labels = []
    for crit in criteria_for(competency):
        hits = [e for e in evidence if crit["id"] in e.get("criterion_ids", []) and e.get("signal") == "positive"]
        strong = [e for e in hits if len(e.get("quote", "")) >= 70]
        if len(hits) >= 2 or strong:
            label = "demonstrated"
        elif hits:
            label = "partial"
        else:
            label = "not_demonstrated"
        negatives = [e for e in evidence if crit["id"] in e.get("criterion_ids", []) and e.get("signal") == "negative"]
        gap = None
        if label != "demonstrated":
            if negatives:
                gap = "knowledge_gap"
            elif label == "partial":
                gap = "weak_articulation"
            elif probed.get(crit["id"]):
                gap = "weak_articulation"
            else:
                gap = "insufficient_evidence"
        item = {"criterion_id": crit["id"], "label": label, "evidence_ids": [e["id"] for e in hits][:4],
                "rationale": f"{len(hits)} supporting excerpt(s) mapped to this criterion."}
        if gap:
            item["gap_type"] = gap
        labels.append(item)
    return labels
