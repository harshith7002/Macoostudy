"""SessionManager (persistence), InterviewOrchestrator and AssessmentService.

All reads and writes are scoped by (assessment_id, user_id): a user can never
load or change another user's assessment.
"""
import json
import os
from datetime import datetime, timezone

from . import claim_extractor, interview, remediation, rubric
from .interview import UNCERTAIN
from .provider import run_task
from .schema import SCHEMA_SQL
from .text_utils import stable_id

INTERVIEW_CLAIMS = int(os.environ.get("CAREER_AGENT_INTERVIEW_CLAIMS", "4"))
MAX_PER_CLAIM = int(os.environ.get("CAREER_AGENT_MAX_PER_CLAIM", "3"))
MIN_PER_CLAIM = 2
MAX_ANSWER_CHARS = 4000


class AgentError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.status = status
        self.extra = extra


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _j(value):
    return json.dumps(value, ensure_ascii=False)


def _l(value, default):
    if value in (None, ""):
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


class CareerAgent:
    def __init__(self, get_db, new_id, provider_factory):
        self.get_db = get_db
        self.new_id = new_id
        self.provider_factory = provider_factory

    # ── schema ───────────────────────────────────────────────────────────────
    def init_db(self):
        conn = self.get_db()
        try:
            conn.cursor().executescript(SCHEMA_SQL)
            conn.commit()
        finally:
            conn.close()

    # ── persistence helpers (SessionManager) ────────────────────────────────
    def _assessment_row(self, conn, assessment_id, user_id):
        row = conn.execute("SELECT * FROM assessments WHERE id=? AND user_id=?", (assessment_id, user_id)).fetchone()
        if not row:
            raise AgentError("Assessment not found.", 404)
        return dict(row)

    def _claims(self, conn, assessment_id):
        rows = conn.execute("SELECT * FROM resume_claims WHERE assessment_id=? ORDER BY order_idx", (assessment_id,)).fetchall()
        out = []
        for r in rows:
            r = dict(r)
            out.append({"id": r["claim_key"], "row_id": r["id"], "source_text": r["source_text"], "summary": r["summary"],
                        "start": r["start_offset"], "end": r["end_offset"], "line_index": r["line_index"],
                        "section": r["section"], "skills": _l(r["skills_json"], []), "competency": r["competency"],
                        "competency_name": rubric.COMPETENCY_NAMES.get(r["competency"], r["competency"]),
                        "relevance": r["relevance"] or 0, "interviewed": bool(r["interviewed"]), "status": r["status"],
                        "score": r["score"], "explanation": r["explanation"], "recommendation": r["recommendation"],
                        "order": r["order_idx"]})
        return out

    def _session(self, conn, assessment_id):
        row = conn.execute("SELECT * FROM interview_sessions WHERE assessment_id=?", (assessment_id,)).fetchone()
        if not row:
            return None
        s = dict(row)
        s["claim_order"] = _l(s.pop("claim_order_json"), [])
        return s

    def _messages(self, conn, assessment_id):
        rows = conn.execute("SELECT * FROM interview_messages WHERE assessment_id=? ORDER BY seq", (assessment_id,)).fetchall()
        return [dict(r) for r in rows]

    def _evidence(self, conn, assessment_id):
        rows = conn.execute("SELECT * FROM evidence_records WHERE assessment_id=? ORDER BY created_at, id", (assessment_id,)).fetchall()
        out = []
        for r in rows:
            r = dict(r)
            out.append({"id": r["id"], "claim_id": r["claim_key"], "message_id": r["message_id"], "quote": r["quote"],
                        "start": r["start_offset"], "end": r["end_offset"],
                        "criterion_ids": _l(r["criterion_ids_json"], []), "signal": r["signal"], "note": r["note"]})
        return out

    def _rubric(self, conn, assessment_id):
        rows = conn.execute("SELECT * FROM rubric_results WHERE assessment_id=? ORDER BY claim_key, points_possible DESC", (assessment_id,)).fetchall()
        by_claim = {}
        for r in rows:
            r = dict(r)
            by_claim.setdefault(r["claim_key"], []).append({
                "criterion_id": r["criterion_id"], "criterion_name": r["criterion_name"], "description": r["description"],
                "label": r["label"], "points_possible": r["points_possible"], "points_awarded": r["points_awarded"],
                "evidence_ids": _l(r["evidence_ids_json"], []), "rationale": r["rationale"], "gap_type": r["gap_type"]})
        return by_claim

    def _remediation(self, conn, assessment_id):
        rows = conn.execute("SELECT * FROM remediation_tasks WHERE assessment_id=? ORDER BY created_at, id", (assessment_id,)).fetchall()
        return [{"id": r["id"], "claim_id": r["claim_key"], "criterion_id": r["criterion_id"], "gap_type": r["gap_type"],
                 "title": r["title"], "status": r["status"], **_l(r["task_json"], {})} for r in map(dict, rows)]

    def _log_provider(self, conn, assessment_id, used_items):
        row = conn.execute("SELECT provider_log_json FROM assessments WHERE id=?", (assessment_id,)).fetchone()
        log = _l(row["provider_log_json"] if row else None, [])
        for u in used_items:
            log.append({**u, "at": _now()})
        conn.execute("UPDATE assessments SET provider_log_json=?, updated_at=? WHERE id=?", (_j(log[-300:]), _now(), assessment_id))

    def _next_seq(self, conn, assessment_id):
        row = conn.execute("SELECT MAX(seq) FROM interview_messages WHERE assessment_id=?", (assessment_id,)).fetchone()
        return (row[0] or 0) + 1

    # ── create ───────────────────────────────────────────────────────────────
    def create_assessment(self, user_id, parsed, filename, jd_text, target_role, experience_level):
        provider = self.provider_factory()
        jd = claim_extractor.analyze_job_description(jd_text, target_role)
        claims, used = claim_extractor.extract_claims(provider, parsed, jd, target_role, experience_level)
        if not claims:
            raise AgentError("We couldn't find any concrete work claims in this resume (bullets describing what you built or did).", 422)
        assessment_id = self.new_id()
        conn = self.get_db()
        try:
            conn.execute(
                "INSERT INTO assessments (id, user_id, filename, target_role, experience_level, jd_text, resume_text, "
                "resume_lines_json, jd_json, status, provider_json, provider_log_json, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (assessment_id, user_id, filename, target_role, experience_level, jd_text, parsed["text"],
                 _j(parsed["lines"]), _j(jd), "ready", _j(provider.describe()), _j([{**used, "at": _now()}]), _now(), _now()))
            for i, c in enumerate(claims):
                conn.execute(
                    "INSERT INTO resume_claims (id, assessment_id, user_id, claim_key, order_idx, source_text, summary, "
                    "start_offset, end_offset, line_index, section, skills_json, competency, relevance, interviewed) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (self.new_id(), assessment_id, user_id, c["id"], i, c["source_text"], c["summary"], c["start"], c["end"],
                     c["line_index"], c["section"], _j(c["skills"]), c["competency"], c["relevance"], 0))
            conn.commit()
        finally:
            conn.close()
        return self.get_assessment(assessment_id, user_id)

    def list_assessments(self, user_id):
        conn = self.get_db()
        try:
            rows = conn.execute(
                "SELECT id, filename, target_role, status, readiness_score, provider_json, created_at, updated_at "
                "FROM assessments WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (user_id,)).fetchall()
            out = []
            for r in rows:
                r = dict(r)
                counts = conn.execute("SELECT status, COUNT(*) FROM resume_claims WHERE assessment_id=? GROUP BY status", (r["id"],)).fetchall()
                total = sum(c[1] for c in counts)
                out.append({**r, "provider": _l(r.pop("provider_json"), {}), "claim_count": total,
                            "status_counts": {c[0]: c[1] for c in counts if c[0]}})
            return out
        finally:
            conn.close()

    # ── read ─────────────────────────────────────────────────────────────────
    def get_assessment(self, assessment_id, user_id):
        conn = self.get_db()
        try:
            a = self._assessment_row(conn, assessment_id, user_id)
            claims = self._claims(conn, assessment_id)
            session = self._session(conn, assessment_id)
            messages = self._messages(conn, assessment_id)
            evidence = self._evidence(conn, assessment_id)
            rubric_by_claim = self._rubric(conn, assessment_id)
            tasks = self._remediation(conn, assessment_id)
        finally:
            conn.close()
        live = self._live_status(claims, messages, evidence) if a["status"] != "completed" else {}
        log = _l(a.get("provider_log_json"), [])
        return {
            "id": a["id"], "filename": a["filename"], "target_role": a["target_role"],
            "experience_level": a["experience_level"], "jd_text": a["jd_text"], "status": a["status"],
            "resume_text": a["resume_text"], "jd": _l(a["jd_json"], {}), "created_at": a["created_at"],
            "provider": _l(a["provider_json"], {}), "provider_usage": self._usage_summary(log),
            "claims": [{**c, "live": live.get(c["id"])} for c in claims],
            "session": self._public_session(session, messages, claims),
            "interview_plan": session["claim_order"] if session else [c["id"] for c in claims[:INTERVIEW_CLAIMS]],
            "messages": [self._public_message(m) for m in messages],
            "evidence": evidence, "rubric": rubric_by_claim, "remediation": tasks,
            "report": _l(a["report_json"], None), "readiness_score": a["readiness_score"],
            "competencies": {k: v["name"] for k, v in rubric.all_competencies().items()},
        }

    @staticmethod
    def _usage_summary(log):
        summary = {}
        for u in log:
            key = u.get("provider", "offline") + (":" + u["model"] if u.get("model") else "")
            entry = summary.setdefault(key, {"provider": u.get("provider"), "model": u.get("model"), "calls": 0, "fallbacks": 0})
            entry["calls"] += 1
            entry["fallbacks"] += 1 if u.get("fallback") else 0
        return list(summary.values())

    @staticmethod
    def _public_message(m):
        return {"id": m["id"], "claim_id": m["claim_key"], "role": m["role"], "content": m["content"],
                "criterion_id": m["criterion_id"], "seq": m["seq"], "reply_to": m["reply_to"],
                "provider": m["provider"], "created_at": m["created_at"]}

    def _public_session(self, session, messages, claims):
        if not session:
            return None
        order = session["claim_order"]
        idx = session["current_claim_idx"]
        current = order[idx] if idx < len(order) else None
        claim = next((c for c in claims if c["id"] == current), None)
        pending = next((m for m in messages if m["id"] == session["pending_question_id"]), None)
        criterion = None
        if pending and claim:
            criterion = next((c for c in rubric.criteria_for(claim["competency"]) if c["id"] == pending["criterion_id"]), None)
        answered = sum(1 for m in messages if m["role"] == "answer")
        per_claim = sum(1 for m in messages if m["role"] == "answer" and m["claim_key"] == current)
        return {"id": session["id"], "status": session["status"], "claim_order": order, "current_claim_idx": idx,
                "current_claim_id": current, "pending_question": self._public_message(pending) if pending else None,
                "current_criterion": {"id": criterion["id"], "name": criterion["name"], "focus": criterion["focus"]} if criterion else None,
                "current_competency": claim["competency_name"] if claim else None,
                "answers_total": answered, "answers_this_claim": per_claim, "max_per_claim": session["max_per_claim"],
                "estimated_total": len(order) * MIN_PER_CLAIM + max(0, len(order) - 1),
                "started_at": session["started_at"], "ended_at": session["ended_at"]}

    def _live_status(self, claims, messages, evidence):
        """Provisional per-claim score from evidence so far (deterministic, shown during the interview)."""
        live = {}
        for c in claims:
            answers = [m for m in messages if m["claim_key"] == c["id"] and m["role"] == "answer"]
            if not answers:
                continue
            ev = [e for e in evidence if e["claim_id"] == c["id"]]
            probed = {m["criterion_id"]: True for m in messages if m["claim_key"] == c["id"] and m["role"] == "question"}
            results = rubric.sanitize_labels(c["competency"], rubric.provisional_labels(c["competency"], ev, probed),
                                             {e["id"] for e in ev}, probed, answered=True)
            score = rubric.score_results(results)
            live[c["id"]] = {"score": score, "status": rubric.status_for(score, True), "answers": len(answers),
                             "provisional": True}
        return live

    # ── interview (InterviewOrchestrator) ────────────────────────────────────
    def start_interview(self, assessment_id, user_id):
        conn = self.get_db()
        try:
            a = self._assessment_row(conn, assessment_id, user_id)
            if a["status"] == "completed":
                raise AgentError("This assessment is already complete.", 409)
            session = self._session(conn, assessment_id)
            if not session:
                claims = self._claims(conn, assessment_id)
                order = [c["id"] for c in claims[:INTERVIEW_CLAIMS]]
                try:
                    conn.execute(
                        "INSERT INTO interview_sessions (id, assessment_id, user_id, status, claim_order_json, current_claim_idx, "
                        "max_per_claim, started_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                        (self.new_id(), assessment_id, user_id, "active", _j(order), 0, MAX_PER_CLAIM, _now(), _now()))
                    conn.execute("UPDATE assessments SET status='interviewing', updated_at=? WHERE id=?", (_now(), assessment_id))
                    conn.commit()
                except Exception as exc:  # a concurrent start created it first (UNIQUE assessment_id)
                    conn.rollback()
                    if "unique" not in str(exc).lower() and "duplicate" not in str(exc).lower():
                        raise
            self._ensure_pending(conn, assessment_id)
            conn.commit()
        finally:
            conn.close()
        return self.get_assessment(assessment_id, user_id)

    def _ensure_pending(self, conn, assessment_id):
        """Make sure an active session has a question waiting (also recovers interrupted sessions)."""
        session = self._session(conn, assessment_id)
        if not session or session["status"] != "active" or session["pending_question_id"]:
            return
        order, idx = session["claim_order"], session["current_claim_idx"]
        if idx >= len(order):
            return
        claims = {c["id"]: c for c in self._claims(conn, assessment_id)}
        claim = claims[order[idx]]
        messages = self._messages(conn, assessment_id)
        evidence = [e for e in self._evidence(conn, assessment_id) if e["claim_id"] == claim["id"]]
        a = dict(conn.execute("SELECT experience_level FROM assessments WHERE id=?", (assessment_id,)).fetchone())
        criterion = self._pick_criterion(claim, messages, evidence)
        history = [m for m in messages if m["claim_key"] == claim["id"]]
        previous = [m["content"] for m in messages if m["role"] == "question"]
        question, used = interview.generate_question(self.provider_factory(), claim, criterion, history, previous,
                                                     a.get("experience_level") or "")
        qid = self.new_id()
        conn.execute(
            "INSERT INTO interview_messages (id, session_id, assessment_id, user_id, claim_key, role, content, criterion_id, seq, provider, created_at) "
            "SELECT ?, s.id, s.assessment_id, s.user_id, ?, 'question', ?, ?, ?, ?, ? FROM interview_sessions s WHERE s.assessment_id=?",
            (qid, claim["id"], question, criterion["id"], self._next_seq(conn, assessment_id), used["provider"], _now(), assessment_id))
        cur = conn.execute("UPDATE interview_sessions SET pending_question_id=?, updated_at=? "
                           "WHERE assessment_id=? AND pending_question_id IS NULL AND status='active'",
                           (qid, _now(), assessment_id))
        if cur.cur.rowcount == 0:
            # A concurrent request already set a pending question; drop ours so there's exactly one.
            conn.execute("DELETE FROM interview_messages WHERE id=?", (qid,))
            return
        conn.execute("UPDATE resume_claims SET interviewed=1 WHERE assessment_id=? AND claim_key=?", (assessment_id, claim["id"]))
        self._log_provider(conn, assessment_id, [used])

    @staticmethod
    def _pick_criterion(claim, messages, evidence):
        crits = rubric.criteria_for(claim["competency"])
        asked = [m["criterion_id"] for m in messages if m["claim_key"] == claim["id"] and m["role"] == "question"]
        if not asked:
            return crits[0]  # always open with implementation / ownership
        covered = {cid for e in evidence if e["signal"] == "positive" for cid in e["criterion_ids"]}
        options = [c for c in crits if c["id"] not in covered] or crits
        # Fewest probes first, then highest points: spreads questions across the rubric.
        return min(options, key=lambda c: (asked.count(c["id"]), -c["points"]))

    def submit_answer(self, assessment_id, user_id, question_id, answer):
        answer = (answer or "").strip()
        if not answer:
            raise AgentError("Please type an answer before submitting (or end the interview).", 400)
        if len(answer) > MAX_ANSWER_CHARS:
            raise AgentError(f"Answers are limited to {MAX_ANSWER_CHARS} characters.", 400)
        if not question_id:
            raise AgentError("question_id is required.", 400)
        conn = self.get_db()
        try:
            a = self._assessment_row(conn, assessment_id, user_id)
            session = self._session(conn, assessment_id)
            if not session:
                raise AgentError("Start the interview first.", 409)
            # Atomic claim of the pending question: a duplicate submit can't record two answers.
            cur = conn.execute("UPDATE interview_sessions SET pending_question_id=NULL, updated_at=? "
                               "WHERE assessment_id=? AND pending_question_id=? AND status='active'",
                               (_now(), assessment_id, question_id))
            conn.commit()
            if cur.cur.rowcount == 0:
                already = conn.execute("SELECT id FROM interview_messages WHERE assessment_id=? AND reply_to=?",
                                       (assessment_id, question_id)).fetchone()
                if already:  # duplicate submit: return current state, record nothing
                    conn.close()
                    conn = None
                    state = self.get_assessment(assessment_id, user_id)
                    state["duplicate"] = True
                    return state
                if session["status"] != "active":
                    raise AgentError("This interview has ended.", 409)
                raise AgentError("That question is no longer the current one. Refresh to continue.", 409)
            try:
                self._record_answer(conn, a, session, question_id, answer)
                conn.commit()
            except Exception:
                conn.rollback()
                conn.execute("UPDATE interview_sessions SET pending_question_id=? WHERE assessment_id=?", (question_id, assessment_id))
                conn.commit()
                raise
            try:
                self._ensure_pending(conn, assessment_id)
                conn.commit()
            except Exception as exc:  # answer is saved; start_interview() regenerates the question later
                conn.rollback()
                print(f"[CareerAgent] could not generate next question: {type(exc).__name__}: {exc}")
        finally:
            if conn is not None:
                conn.close()
        state = self.get_assessment(assessment_id, user_id)
        if state["session"] and state["session"]["status"] == "active" and state["session"]["current_claim_idx"] >= len(state["session"]["claim_order"]):
            return self.finish(assessment_id, user_id, reason="completed")
        return state

    def _record_answer(self, conn, a, session, question_id, answer):
        assessment_id = a["id"]
        question = dict(conn.execute("SELECT * FROM interview_messages WHERE id=? AND assessment_id=?",
                                     (question_id, assessment_id)).fetchone())
        claims = {c["id"]: c for c in self._claims(conn, assessment_id)}
        claim = claims[question["claim_key"]]
        aid = self.new_id()
        answer_msg = {"id": aid, "content": answer}
        # Model call happens before any write so no DB write lock is held while waiting on it.
        records, used = interview.extract_evidence(self.provider_factory(), claim, question, answer_msg)
        conn.execute(
            "INSERT INTO interview_messages (id, session_id, assessment_id, user_id, claim_key, role, content, criterion_id, seq, reply_to, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (aid, session["id"], assessment_id, a["user_id"], claim["id"], "answer", answer, question["criterion_id"],
             self._next_seq(conn, assessment_id), question_id, _now()))
        for r in records:
            conn.execute(
                "INSERT INTO evidence_records (id, assessment_id, user_id, claim_key, message_id, quote, start_offset, end_offset, "
                "criterion_ids_json, signal, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (r["id"], assessment_id, a["user_id"], claim["id"], aid, r["quote"], r["start"], r["end"],
                 _j(r["criterion_ids"]), r["signal"], r["note"], _now()))
        self._log_provider(conn, assessment_id, [used])

        # Decide: follow up on this claim or move on.
        messages = self._messages(conn, assessment_id)
        answers = [m for m in messages if m["claim_key"] == claim["id"] and m["role"] == "answer"]
        evidence = [e for e in self._evidence(conn, assessment_id) if e["claim_id"] == claim["id"]]
        probed = {m["criterion_id"]: True for m in messages if m["claim_key"] == claim["id"] and m["role"] == "question"}
        results = rubric.sanitize_labels(claim["competency"], rubric.provisional_labels(claim["competency"], evidence, probed),
                                         {e["id"] for e in evidence}, probed)
        score = rubric.score_results(results)
        unsure = sum(1 for m in answers[-2:] if any(u in m["content"].lower() for u in UNCERTAIN))
        if len(answers) >= session["max_per_claim"] or (len(answers) >= MIN_PER_CLAIM and (score >= 75 or unsure >= 2)):
            conn.execute("UPDATE interview_sessions SET current_claim_idx=current_claim_idx+1, updated_at=? WHERE assessment_id=?",
                         (_now(), assessment_id))

    def end_interview(self, assessment_id, user_id):
        conn = self.get_db()
        try:
            a = self._assessment_row(conn, assessment_id, user_id)
            if a["status"] == "completed":
                conn.close()
                conn = None
                return self.get_assessment(assessment_id, user_id)
            if not self._session(conn, assessment_id):
                raise AgentError("Start the interview before ending it.", 409)
        finally:
            if conn is not None:
                conn.close()
        return self.finish(assessment_id, user_id, reason="ended_early")

    # ── evaluation (AssessmentService) ───────────────────────────────────────
    LABEL_SCHEMA = {
        "type": "object", "required": ["labels"],
        "properties": {"labels": {"type": "array", "items": {
            "type": "object", "required": ["criterion_id", "label", "evidence_ids"],
            "properties": {"criterion_id": {"type": "string"},
                           "label": {"type": "string", "enum": list(rubric.LABELS)},
                           "evidence_ids": {"type": "array", "items": {"type": "string"}},
                           "gap_type": {"type": "string", "enum": list(rubric.GAP_TYPES)},
                           "rationale": {"type": "string"}}}}},
    }

    def _label_claim(self, provider, claim, messages, evidence, probed):
        crits = rubric.criteria_for(claim["competency"])
        transcript = "\n".join(f"[{m['id']}] {'Interviewer' if m['role'] == 'question' else 'Candidate'}: {m['content']}"
                               for m in messages if m["claim_key"] == claim["id"])
        ev_list = [{"id": e["id"], "quote": e["quote"], "signal": e["signal"], "criterion_ids": e["criterion_ids"]} for e in evidence]
        msgs = [
            {"role": "system", "content": (
                "You grade a technical interview against a fixed rubric. For EACH criterion output label "
                "demonstrated / partial / not_demonstrated and cite evidence_ids from the evidence list only "
                "(demonstrated or partial REQUIRE at least one cited id). For non-demonstrated criteria set gap_type: "
                "knowledge_gap (answers show the concept isn't understood), weak_articulation (some understanding but "
                "vague or unstructured), insufficient_evidence (not enough was asked or said). Do not compute scores. "
                "Judge only what was explained; never suggest dishonesty.")},
            {"role": "user", "content": (
                f"Resume claim: {claim['source_text']}\nCriteria: {_j([{'id': c['id'], 'name': c['name'], 'description': c['description']} for c in crits])}\n"
                f"Transcript:\n{transcript}\nEvidence: {_j(ev_list)}")},
        ]
        return run_task(provider, "label_rubric", msgs, self.LABEL_SCHEMA,
                        lambda: {"labels": rubric.provisional_labels(claim["competency"], evidence, probed)}, max_tokens=1500)

    def finish(self, assessment_id, user_id, reason="completed"):
        provider = self.provider_factory()
        conn = self.get_db()
        try:
            a = self._assessment_row(conn, assessment_id, user_id)
            claims = self._claims(conn, assessment_id)
            messages = self._messages(conn, assessment_id)
            evidence = self._evidence(conn, assessment_id)
        finally:
            conn.close()
        if a["status"] == "completed":
            return self.get_assessment(assessment_id, user_id)

        # Model calls first (no DB lock held), then one write transaction.
        used_log, rubric_by_claim = [], {}
        for claim in claims:
            answered = any(m["claim_key"] == claim["id"] and m["role"] == "answer" for m in messages)
            ev = [e for e in evidence if e["claim_id"] == claim["id"]]
            probed = {m["criterion_id"]: True for m in messages if m["claim_key"] == claim["id"] and m["role"] == "question"}
            raw = []
            if answered:
                data, used = self._label_claim(provider, claim, messages, ev, probed)
                used_log.append(used)
                raw = data.get("labels", [])
            results = rubric.sanitize_labels(claim["competency"], raw, {e["id"] for e in ev}, probed, answered)
            score = rubric.score_results(results) if answered else 0.0
            status = rubric.status_for(score, answered)
            if answered:
                explanation, recommendation = rubric.explain(results, status), rubric.recommend(results)
            else:
                explanation = "This claim was not covered in the interview, so there is no evidence either way yet."
                recommendation = "Run another assessment focused on this claim, or prepare a walkthrough of how you did it."
            claim.update(interviewed=answered, score=score, status=status, explanation=explanation,
                         recommendation=recommendation)
            rubric_by_claim[claim["id"]] = results

        gaps = remediation.select_gaps(claims, rubric_by_claim)
        tasks, task_used = remediation.generate_tasks(provider, gaps, a["target_role"])
        used_log.extend(task_used)
        report = build_report(claims, rubric_by_claim, evidence, messages, reason)

        conn = self.get_db()
        try:
            # Re-check inside the write: a concurrent finish may have won the race.
            row = conn.execute("SELECT status FROM assessments WHERE id=? AND user_id=?", (assessment_id, user_id)).fetchone()
            if row and row["status"] == "completed":
                return self.get_assessment(assessment_id, user_id)
            conn.execute("DELETE FROM rubric_results WHERE assessment_id=?", (assessment_id,))
            conn.execute("DELETE FROM remediation_tasks WHERE assessment_id=?", (assessment_id,))
            for claim in claims:
                conn.execute("UPDATE resume_claims SET interviewed=?, score=?, status=?, explanation=?, recommendation=? "
                             "WHERE assessment_id=? AND claim_key=?",
                             (1 if claim["interviewed"] else 0, claim["score"], claim["status"], claim["explanation"],
                              claim["recommendation"], assessment_id, claim["id"]))
                for r in rubric_by_claim[claim["id"]]:
                    conn.execute(
                        "INSERT INTO rubric_results (id, assessment_id, user_id, claim_key, competency, criterion_id, criterion_name, "
                        "description, label, points_possible, points_awarded, evidence_ids_json, rationale, gap_type) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (self.new_id(), assessment_id, user_id, claim["id"], claim["competency"], r["criterion_id"],
                         r["criterion_name"], r["description"], r["label"], r["points_possible"], r["points_awarded"],
                         _j(r["evidence_ids"]), r["rationale"], r["gap_type"]))
            for t in tasks:
                conn.execute(
                    "INSERT INTO remediation_tasks (id, assessment_id, user_id, claim_key, criterion_id, gap_type, title, task_json, status, created_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (stable_id("rem", assessment_id, t["claim_id"], t["criterion_id"]), assessment_id, user_id, t["claim_id"],
                     t["criterion_id"], t["gap_type"], t["task"]["title"], _j(t["task"]), "todo", _now()))
            conn.execute("UPDATE interview_sessions SET status=?, pending_question_id=NULL, ended_at=?, updated_at=? WHERE assessment_id=?",
                         ("completed" if reason == "completed" else "ended", _now(), _now(), assessment_id))
            conn.execute("UPDATE assessments SET status='completed', readiness_score=?, report_json=?, updated_at=? WHERE id=?",
                         (report["readiness_score"], _j(report), _now(), assessment_id))
            self._log_provider(conn, assessment_id, used_log)
            conn.commit()
        finally:
            conn.close()
        return self.get_assessment(assessment_id, user_id)

    def set_task_status(self, assessment_id, user_id, task_id, status):
        if status not in ("todo", "done"):
            raise AgentError("status must be 'todo' or 'done'.", 400)
        conn = self.get_db()
        try:
            self._assessment_row(conn, assessment_id, user_id)
            cur = conn.execute("UPDATE remediation_tasks SET status=? WHERE id=? AND assessment_id=? AND user_id=?",
                               (status, task_id, assessment_id, user_id))
            if cur.cur.rowcount == 0:
                raise AgentError("Task not found.", 404)
            conn.commit()
        finally:
            conn.close()
        return {"id": task_id, "status": status}


def build_report(claims, rubric_by_claim, evidence, messages, reason):
    """Deterministic report from stored rubric results."""
    ev_by_id = {e["id"]: e for e in evidence}
    counts = {rubric.STATUS_SUPPORTED: 0, rubric.STATUS_PARTIAL: 0, rubric.STATUS_INSUFFICIENT: 0}
    for c in claims:
        counts[c["status"]] = counts.get(c["status"], 0) + 1
    comp = {}
    for c in claims:
        if not c["interviewed"]:
            continue
        entry = comp.setdefault(c["competency"], {"competency": c["competency"],
                                                  "name": rubric.COMPETENCY_NAMES.get(c["competency"], c["competency"]),
                                                  "awarded": 0.0, "possible": 0.0, "claims": []})
        for r in rubric_by_claim.get(c["id"], []):
            entry["awarded"] += r["points_awarded"]
            entry["possible"] += r["points_possible"]
        entry["claims"].append(c["id"])
    competencies = [{**v, "score": round(100 * v["awarded"] / v["possible"], 1) if v["possible"] else 0.0}
                    for v in comp.values()]
    competencies.sort(key=lambda v: -v["score"])

    strengths, gaps = [], []
    gap_counts = {g: 0 for g in rubric.GAP_TYPES}
    for c in claims:
        if not c["interviewed"]:
            continue
        for r in rubric_by_claim.get(c["id"], []):
            if r["label"] == "demonstrated":
                ev = [ev_by_id[e] for e in r["evidence_ids"] if e in ev_by_id]
                if ev:
                    strengths.append({"claim_id": c["id"], "criterion_id": r["criterion_id"],
                                      "criterion_name": r["criterion_name"], "evidence_id": ev[0]["id"],
                                      "message_id": ev[0]["message_id"], "quote": ev[0]["quote"]})
            else:
                gap_counts[r["gap_type"]] = gap_counts.get(r["gap_type"], 0) + 1
                related = [m["id"] for m in messages if m["claim_key"] == c["id"] and m["criterion_id"] == r["criterion_id"]]
                gaps.append({"claim_id": c["id"], "criterion_id": r["criterion_id"], "criterion_name": r["criterion_name"],
                             "gap_type": r["gap_type"], "label": r["label"],
                             "points_lost": r["points_possible"] - r["points_awarded"], "message_ids": related})
    gaps.sort(key=lambda g: -g["points_lost"])
    readiness = rubric.readiness(claims)
    interviewed = sum(1 for c in claims if c["interviewed"])
    return {
        "readiness_score": readiness,
        "readiness_band": "Interview-ready" if readiness >= 70 else "Getting there" if readiness >= 45 else "Needs preparation",
        "coverage": {"interviewed": interviewed, "total": len(claims),
                     "answers": sum(1 for m in messages if m["role"] == "answer")},
        "status_counts": counts, "competencies": competencies, "strengths": strengths[:8], "gaps": gaps[:10],
        "gap_type_counts": gap_counts, "ended": reason, "generated_at": _now(),
        "method": "Scores are computed by the backend from rubric labels: demonstrated = full points, partial = half, "
                  "not demonstrated = 0. Readiness is the JD-relevance-weighted mean of interviewed claims.",
    }
