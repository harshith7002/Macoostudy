"""RemediationGenerator: one practice task per identified gap.

Tasks are written exercises and scenarios. Nothing here executes user code.
"""
import json

from .provider import run_task
from .text_utils import truncate

MAX_TASKS = 6

TASK_SCHEMA = {
    "type": "object",
    "required": ["title", "explanation", "exercise", "scenario", "solution_criteria", "follow_up_question"],
    "properties": {
        "title": {"type": "string"}, "explanation": {"type": "string"}, "exercise": {"type": "string"},
        "scenario": {"type": "string"},
        "solution_criteria": {"type": "array", "items": {"type": "string"}},
        "follow_up_question": {"type": "string"},
    },
}

_GAP_INTRO = {
    "knowledge_gap": "Your answers suggested this concept is not solid yet, so start with the fundamentals.",
    "weak_articulation": "You touched on this, but the explanation was hard to follow or lacked specifics. Practise saying it clearly.",
    "insufficient_evidence": "The interview didn't get far enough to show this. Prepare a concrete example so it's ready next time.",
}

_TEMPLATES = {
    "implementation": ("Explain the build, component by component",
                       "Interviewers trust a claim when you can name the components, how data flows between them, and which part you wrote.",
                       "Draw (on paper) the 3–5 components behind this claim and write one sentence per arrow describing the data that moves.",
                       ["Names each component and its responsibility", "Describes the data flow in order",
                        "Says clearly which part you personally built"]),
    "design_rationale": ("Justify one key decision",
                         "A good rationale links a decision to a requirement (latency, cost, team skill, deadline).",
                         "Write a 5-sentence decision record: context, options, decision, why, and what would make you revisit it.",
                         ["States the requirement that drove the decision", "Mentions at least one option not chosen",
                          "Explains when the decision should be revisited"]),
    "tradeoffs": ("Compare two alternatives",
                  "Trade-offs show judgment: every choice costs something (complexity, latency, money, flexibility).",
                  "Make a two-column comparison of your choice versus one realistic alternative across performance, complexity, cost and failure modes.",
                  ["Picks a realistic alternative", "Names a concrete cost of your own choice",
                   "Explains when the alternative would win"]),
    "failure_handling": ("Walk through a failure scenario",
                         "Senior answers cover how things break: detection, blast radius, mitigation and prevention.",
                         "Pick the most likely failure (timeout, bad input, dependency down) and write the incident timeline: detect → diagnose → mitigate → prevent.",
                         ["Names a specific failure mode", "Explains how it would be detected",
                          "Gives a mitigation and a prevention step"]),
    "validation": ("Prove it with a measurement",
                   "Numbers are only convincing with a method: what was measured, how, and against what baseline.",
                   "Write down the metric behind this claim, how you would measure it, the baseline, and one source of measurement error.",
                   ["Defines the metric precisely", "States the baseline and the method",
                    "Mentions a limitation of the measurement"]),
}

_DOMAIN_TEMPLATE = ("Deepen the domain detail",
                    "This criterion is specific to the competency behind the claim.",
                    "Write a one-page note answering the criterion below for this claim, using concrete names from your project.",
                    ["Uses concrete names from the project", "Addresses the criterion directly", "Mentions one limitation"])


def heuristic_task(gap):
    title, why, exercise, criteria = _TEMPLATES.get(gap["criterion_id"], _DOMAIN_TEMPLATE)
    claim = truncate(gap["claim_text"], 120)
    return {
        "title": f"{title}: {gap['criterion_name']}",
        "explanation": f"{_GAP_INTRO.get(gap['gap_type'], '')} {why} Criterion: {gap['description']}",
        "exercise": exercise,
        "scenario": f"An interviewer reads “{claim}” and asks you to go deeper on {gap['criterion_name'].lower()}. "
                    f"Answer out loud in under two minutes.",
        "solution_criteria": criteria,
        "follow_up_question": f"For “{claim}”: {gap['description']} Walk me through it.",
    }


def select_gaps(claims, rubric_by_claim):
    gaps = []
    order = {"knowledge_gap": 0, "weak_articulation": 1, "insufficient_evidence": 2}
    for claim in claims:
        if not claim.get("interviewed"):
            continue
        for r in rubric_by_claim.get(claim["id"], []):
            if r["label"] == "demonstrated":
                continue
            gaps.append({"claim_id": claim["id"], "claim_text": claim["source_text"], "competency": claim["competency"],
                         "criterion_id": r["criterion_id"], "criterion_name": r["criterion_name"],
                         "description": r["description"], "gap_type": r["gap_type"] or "insufficient_evidence",
                         "points_lost": r["points_possible"] - r["points_awarded"]})
    gaps.sort(key=lambda g: (order.get(g["gap_type"], 3), -g["points_lost"]))
    # Prefer breadth: at most two tasks per claim.
    picked, per_claim = [], {}
    for g in gaps:
        if per_claim.get(g["claim_id"], 0) >= 2:
            continue
        per_claim[g["claim_id"]] = per_claim.get(g["claim_id"], 0) + 1
        picked.append(g)
        if len(picked) >= MAX_TASKS:
            break
    return picked


def generate_tasks(provider, gaps, target_role=""):
    tasks, used_log = [], []
    for gap in gaps:
        messages = [
            {"role": "system", "content": (
                "You write one focused remediation exercise for a candidate preparing for technical interviews. "
                "It must be a written/verbal exercise; never ask them to run code on a server. Be encouraging and "
                "specific to the resume claim. Never suggest the candidate was dishonest.")},
            {"role": "user", "content": (
                f"Target role: {target_role or 'not specified'}\nResume claim: {gap['claim_text']}\n"
                f"Gap type: {gap['gap_type']}\nCriterion: {gap['criterion_name']} — {gap['description']}\n"
                f"Return JSON with keys: {json.dumps(list(TASK_SCHEMA['properties']))}")},
        ]
        data, used = run_task(provider, "remediation", messages, TASK_SCHEMA, lambda g=gap: heuristic_task(g), max_tokens=900)
        used_log.append(used)
        tasks.append({**gap, "task": data})
    return tasks, used_log
