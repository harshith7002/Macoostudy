"""Tests for the Career Agent (Claim-to-Evidence Engine). The model is always mocked.

Run: python -m unittest test_career_agent.py
"""
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import requests
from flask import Flask

from career_agent import claim_extractor, interview, rubric
from career_agent.pdf_fixture import SAMPLE_JD, SAMPLE_RESUME, make_pdf
from career_agent.provider import (MetaProvider, ModelProvider, OfflineProvider, ProviderError, RetryableError,
                                   get_provider, parse_json, run_task, validate)
from career_agent.resume_parser import ResumeParseError, parse_pdf, parse_text
from career_agent.routes import create_blueprint
from career_agent.service import CareerAgent

STRONG = ("I implemented the refund endpoint in Flask with a PostgreSQL table because we needed transactions. "
          "I chose Postgres instead of Mongo since refunds need ACID guarantees, at the cost of a stricter schema. "
          "When the provider timed out we retried with an idempotency key, and I found the bug from the logs. "
          "We measured p95 latency with a load test: 420 ms down to 250 ms.")


class ScriptedProvider(ModelProvider):
    """Returns queued raw outputs / raises queued exceptions from _chat."""
    name = "scripted"
    display_name = "Scripted"

    def __init__(self, outputs):
        super().__init__(model="test-model", max_retries=2)
        self.outputs = list(outputs)
        self.calls = 0

    def _chat(self, messages, schema, task, max_tokens):
        self.calls += 1
        out = self.outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


class AlwaysFailProvider(ModelProvider):
    name = "meta"
    is_meta = True
    display_name = "Meta Model API"

    def __init__(self):
        super().__init__(model="muse-spark-1.3", max_retries=0)

    def _chat(self, messages, schema, task, max_tokens):
        raise RetryableError("timeout")


def sqlite_factory(path):
    """Minimal stand-in for app.get_db()'s SQLite wrapper, so tests never touch macoostudy.db."""
    class Wrapper:
        def __init__(self, conn):
            self.conn, self.cur = conn, None

        def cursor(self):
            return self

        def executescript(self, sql):
            self.conn.executescript(sql)

        def execute(self, q, p=None):
            self.cur = self.conn.cursor()
            self.cur.execute(q, p or ())
            return self

        def fetchone(self):
            return self.cur.fetchone() if self.cur else None

        def fetchall(self):
            return self.cur.fetchall() if self.cur else []

        def commit(self):
            self.conn.commit()

        def rollback(self):
            self.conn.rollback()

        def close(self):
            self.conn.close()

    def get_db():
        conn = sqlite3.connect(path, timeout=30)
        conn.row_factory = sqlite3.Row
        return Wrapper(conn)
    return get_db


_counter = [0]


def new_id():
    _counter[0] += 1
    return f"id{_counter[0]:06d}"


# ── Provider layer ───────────────────────────────────────────────────────────

class ProviderTests(unittest.TestCase):
    SCHEMA = {"type": "object", "required": ["question"], "properties": {"question": {"type": "string"}}}

    def test_parse_json_variants(self):
        self.assertEqual(parse_json('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(parse_json('Sure! {"a": 2} hope that helps'), {"a": 2})
        with self.assertRaises(ValueError):
            parse_json("")

    def test_validate_reports_errors(self):
        self.assertEqual(validate(self.SCHEMA, {"question": "x"}), [])
        self.assertTrue(validate(self.SCHEMA, {}))
        self.assertTrue(validate(self.SCHEMA, {"question": 3}))
        self.assertTrue(validate({"type": "string", "enum": ["a"]}, "b"))

    def test_malformed_then_valid_retries(self):
        p = ScriptedProvider(["not json at all", '{"wrong": 1}', '{"question": "ok?"}'])
        self.assertEqual(p.complete_json("t", [{"role": "user", "content": "hi"}], self.SCHEMA), {"question": "ok?"})
        self.assertEqual(p.calls, 3)

    def test_retryable_errors_then_success(self):
        p = ScriptedProvider([RetryableError("429", retry_after=0), '{"question": "q"}'])
        self.assertEqual(p.complete_json("t", [], self.SCHEMA)["question"], "q")

    def test_exhausted_retries_raise(self):
        p = ScriptedProvider(["{}", "{}", "{}"])
        with self.assertRaises(ProviderError):
            p.complete_json("t", [], self.SCHEMA)

    def test_run_task_falls_back_and_labels_it(self):
        data, used = run_task(AlwaysFailProvider(), "t", [], self.SCHEMA, lambda: {"question": "heuristic"})
        self.assertEqual(data["question"], "heuristic")
        self.assertTrue(used["fallback"])
        self.assertEqual(used["provider"], "offline")
        self.assertEqual(used["failed_provider"], "meta")

    def test_missing_credentials_uses_offline(self):
        with patch.dict(os.environ, {"MODEL_API_KEY": "", "META_MODEL_API_KEY": "", "GROQ_API_KEY": "",
                                     "CAREER_AGENT_PROVIDER": ""}):
            p = get_provider(MagicMock(), lambda: "m")
        self.assertIsInstance(p, OfflineProvider)
        self.assertFalse(p.describe()["is_meta"])
        self.assertFalse(p.describe()["is_llm"])

    def test_meta_key_selects_meta_with_documented_model(self):
        with patch.dict(os.environ, {"MODEL_API_KEY": "sk-test-123", "CAREER_AGENT_PROVIDER": "", "META_MODEL": ""}):
            p = get_provider(None, None)
        self.assertIsInstance(p, MetaProvider)
        self.assertEqual(p.model, "muse-spark-1.3")
        self.assertTrue(p.describe()["is_meta"])
        self.assertNotIn("sk-test-123", json.dumps(p.describe()))

    def test_meta_request_shape_and_no_secret_in_logs(self):
        p = MetaProvider("sk-secret-xyz", model="muse-spark-1.3", max_retries=0)
        resp = MagicMock(status_code=200, headers={})
        resp.json.return_value = {"choices": [{"message": {"content": '{"question": "Why?"}'}, "finish_reason": "stop"}]}
        with patch("career_agent.provider.requests.post", return_value=resp) as post, \
                self.assertLogs("career_agent.provider", level="INFO") as logs:
            out = p.complete_json("generate_question", [{"role": "user", "content": "x"}], self.SCHEMA)
        self.assertEqual(out["question"], "Why?")
        url = post.call_args[0][0]
        body = post.call_args[1]["json"]
        self.assertEqual(url, "https://api.meta.ai/v1/chat/completions")
        self.assertEqual(body["model"], "muse-spark-1.3")
        self.assertEqual(body["response_format"]["type"], "json_schema")
        self.assertIn("max_completion_tokens", body)
        self.assertNotIn("sk-secret-xyz", "\n".join(logs.output))

    def test_meta_timeout_is_retryable_and_401_is_fatal(self):
        p = MetaProvider("k", max_retries=0)
        with patch("career_agent.provider.requests.post", side_effect=requests.Timeout()):
            with self.assertRaises(ProviderError):
                p.complete_json("t", [], self.SCHEMA)
        resp = MagicMock(status_code=401, headers={})
        resp.json.return_value = {"error": {"message": "invalid_api_key"}}
        with patch("career_agent.provider.requests.post", return_value=resp) as post:
            with self.assertRaises(ProviderError):
                MetaProvider("k", max_retries=3).complete_json("t", [], self.SCHEMA)
            self.assertEqual(post.call_count, 1)  # 401 is not retried


# ── Parsing + claims ─────────────────────────────────────────────────────────

class ParsingTests(unittest.TestCase):
    def test_invalid_and_empty_pdf(self):
        with self.assertRaises(ResumeParseError):
            parse_pdf(b"")
        with self.assertRaises(ResumeParseError):
            parse_pdf(b"hello this is not a pdf")
        with self.assertRaises(ResumeParseError):
            parse_pdf(make_pdf(["Hi"]))  # valid PDF, but nearly no text

    def test_lines_have_sections_and_exact_offsets(self):
        parsed = parse_pdf(make_pdf(SAMPLE_RESUME))
        for line in parsed["lines"]:
            self.assertEqual(parsed["text"][line["start"]:line["end"]], line["text"])
        sections = {l["section"] for l in parsed["lines"]}
        self.assertIn("experience", sections)
        self.assertIn("projects", sections)


class ClaimExtractionTests(unittest.TestCase):
    def setUp(self):
        self.parsed = parse_pdf(make_pdf(SAMPLE_RESUME))
        self.jd = claim_extractor.analyze_job_description(SAMPLE_JD, "Backend Engineer")

    def test_jd_analysis(self):
        self.assertIn("flask", self.jd["skills"])
        self.assertIn("backend_engineering", self.jd["competencies"])

    def test_heuristic_claims_are_grounded_with_stable_ids(self):
        claims, used = claim_extractor.extract_claims(OfflineProvider(), self.parsed, self.jd)
        self.assertGreaterEqual(len(claims), 4)
        self.assertEqual(used["provider"], "offline")
        for c in claims:
            self.assertEqual(self.parsed["text"][c["start"]:c["end"]], c["source_text"])
            self.assertTrue(c["id"].startswith("clm_"))
        again, _ = claim_extractor.extract_claims(OfflineProvider(), self.parsed, self.jd)
        self.assertEqual([c["id"] for c in claims], [c["id"] for c in again])
        # Skills / education lines are not claims
        self.assertFalse(any(c["source_text"].startswith("Python, Flask") for c in claims))
        # JD-relevant claims come first
        self.assertIn("flask", claims[0]["skills"])

    def test_fabricated_model_claims_are_dropped(self):
        line = next(l for l in self.parsed["lines"] if "Redis" in l["text"])
        out = json.dumps({"claims": [
            {"source_text": "Architected a Kubernetes platform serving 10M users", "line_index": 0,
             "skills": ["kubernetes"], "competency": "devops_cloud"},
            {"source_text": "reduced p95 latency of the order lookup endpoint by 40%", "line_index": line["index"],
             "skills": ["redis"], "competency": "databases"},
        ]})
        claims, used = claim_extractor.extract_claims(ScriptedProvider([out]), self.parsed, self.jd)
        self.assertEqual(len(claims), 1)
        self.assertIn("p95 latency", claims[0]["source_text"])
        self.assertEqual(self.parsed["text"][claims[0]["start"]:claims[0]["end"]], claims[0]["source_text"])
        self.assertFalse(used["fallback"])

    def test_malformed_model_output_falls_back(self):
        claims, used = claim_extractor.extract_claims(ScriptedProvider(["oops", "{]", "nope"]), self.parsed, self.jd)
        self.assertTrue(claims)
        self.assertTrue(used["fallback"])


# ── Evidence + questions ─────────────────────────────────────────────────────

class InterviewEngineTests(unittest.TestCase):
    claim = {"id": "clm_x", "source_text": "Built a Flask REST API with PostgreSQL for refunds", "skills": ["flask", "postgresql"],
             "competency": "backend_engineering"}
    question = {"content": "How did you build it?", "criterion_id": "implementation"}

    def test_evidence_must_quote_the_answer(self):
        answer = {"id": "m1", "content": STRONG}
        out = json.dumps({"evidence": [
            {"quote": "I chose Postgres instead of Mongo", "criterion_ids": ["tradeoffs", "bogus"], "signal": "positive"},
            {"quote": "I benchmarked it on 50 servers with Kafka", "criterion_ids": ["validation"], "signal": "positive"},
        ]})
        records, _ = interview.extract_evidence(ScriptedProvider([out]), self.claim, self.question, answer)
        self.assertEqual(len(records), 1)
        r = records[0]
        self.assertEqual(STRONG[r["start"]:r["end"]], r["quote"])
        self.assertEqual(r["criterion_ids"], ["tradeoffs"])
        self.assertEqual(r["message_id"], "m1")

    def test_heuristic_evidence_maps_criteria_and_uncertainty(self):
        records, _ = interview.extract_evidence(OfflineProvider(), self.claim, self.question, {"id": "m1", "content": STRONG})
        crits = {c for r in records for c in r["criterion_ids"]}
        self.assertTrue({"implementation", "tradeoffs", "failure_handling", "validation"} <= crits)
        unsure, _ = interview.extract_evidence(OfflineProvider(), self.claim, self.question,
                                               {"id": "m2", "content": "I'm not sure, I don't remember."})
        self.assertEqual(unsure[0]["signal"], "negative")

    def test_follow_up_uses_candidate_answer_and_never_repeats(self):
        crit = next(c for c in rubric.criteria_for("backend_engineering") if c["id"] == "failure_handling")
        history = [{"role": "question", "content": "How did you build it?"},
                   {"role": "answer", "content": "We put a retry with an idempotency key in front of the webhook."}]
        q, _ = interview.generate_question(OfflineProvider(), self.claim, crit, history, ["How did you build it?"])
        self.assertIn("idempotency key", q)
        q2, _ = interview.generate_question(OfflineProvider(), self.claim, crit, history, ["How did you build it?", q])
        self.assertNotEqual(q, q2)

    def test_repeated_model_question_is_replaced(self):
        prev = "Why did you choose flask for this API?"
        crit = rubric.criteria_for("backend_engineering")[1]
        q, used = interview.generate_question(ScriptedProvider([json.dumps({"question": prev})]), self.claim, crit, [], [prev])
        self.assertNotEqual(q, prev)
        self.assertTrue(used["fallback"])


# ── Rubric ───────────────────────────────────────────────────────────────────

class RubricTests(unittest.TestCase):
    def test_points_total_100_for_every_competency(self):
        for comp, info in rubric.all_competencies().items():
            self.assertEqual(sum(c["points"] for c in info["criteria"]), 100, comp)

    def test_scoring_is_deterministic_and_requires_evidence(self):
        labels = [{"criterion_id": "implementation", "label": "demonstrated", "evidence_ids": ["e1"]},
                  {"criterion_id": "tradeoffs", "label": "partial", "evidence_ids": ["e2"]},
                  {"criterion_id": "failure_handling", "label": "demonstrated", "evidence_ids": []},  # no evidence
                  {"criterion_id": "validation", "label": "demonstrated", "evidence_ids": ["made-up"]}]
        res = rubric.sanitize_labels("backend_engineering", labels, {"e1", "e2"}, {"implementation": True})
        by = {r["criterion_id"]: r for r in res}
        self.assertEqual(by["implementation"]["points_awarded"], 25)
        self.assertEqual(by["tradeoffs"]["points_awarded"], 10)
        self.assertEqual(by["failure_handling"]["label"], "not_demonstrated")
        self.assertEqual(by["validation"]["label"], "not_demonstrated")
        self.assertEqual(rubric.score_results(res), 35.0)
        self.assertEqual(by["tradeoffs"]["gap_type"], "weak_articulation")
        self.assertEqual(by["validation"]["gap_type"], "insufficient_evidence")  # never probed, no evidence

    def test_status_transitions(self):
        self.assertEqual(rubric.status_for(90, True), rubric.STATUS_SUPPORTED)
        self.assertEqual(rubric.status_for(70, True), rubric.STATUS_SUPPORTED)
        self.assertEqual(rubric.status_for(50, True), rubric.STATUS_PARTIAL)
        self.assertEqual(rubric.status_for(10, True), rubric.STATUS_INSUFFICIENT)
        self.assertEqual(rubric.status_for(100, False), rubric.STATUS_INSUFFICIENT)

    def test_explanations_are_neutral(self):
        res = rubric.sanitize_labels("backend_engineering", [], set(), {}, answered=True)
        text = (rubric.explain(res, rubric.STATUS_INSUFFICIENT) + rubric.recommend(res)).lower()
        for word in ("lie", "lying", "dishonest", "fabricat", "fake", "exaggerat"):
            self.assertNotIn(word, text)

    def test_readiness_weights_relevance(self):
        claims = [{"interviewed": True, "score": 100, "relevance": 3}, {"interviewed": True, "score": 0, "relevance": 0},
                  {"interviewed": False, "score": 0, "relevance": 3}]
        self.assertEqual(rubric.readiness(claims), 71.4)


# ── Service + API ────────────────────────────────────────────────────────────

class ApiTests(unittest.TestCase):
    U = "user_test_1"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp.name, "agent.db")
        self.provider = OfflineProvider()
        self.agent = CareerAgent(sqlite_factory(self.db_path), new_id, lambda: self.provider)
        self.agent.init_db()
        flask_app = Flask(__name__)
        flask_app.register_blueprint(create_blueprint(self.agent, lambda: self.provider.describe()))
        self.client = flask_app.test_client()

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, **over):
        data = {"user_id": self.U, "job_description": SAMPLE_JD, "target_role": "Backend Engineer",
                "experience_level": "entry", "resume": (io.BytesIO(make_pdf(SAMPLE_RESUME)), "resume.pdf")}
        data.update(over)
        return self.client.post("/api/agent/assessments", data=data, content_type="multipart/form-data")

    def start(self, aid):
        return self.client.post(f"/api/agent/assessments/{aid}/interview/start", json={"user_id": self.U}).json

    def answer(self, aid, qid, text):
        return self.client.post(f"/api/agent/assessments/{aid}/interview/answer",
                                json={"user_id": self.U, "question_id": qid, "answer": text})

    def test_validation_errors(self):
        self.assertEqual(self.create(job_description="").status_code, 400)
        self.assertEqual(self.create(target_role="").status_code, 400)
        self.assertEqual(self.create(user_id="").status_code, 400)
        self.assertEqual(self.create(resume=(io.BytesIO(b"not a pdf"), "resume.pdf")).status_code, 400)
        self.assertEqual(self.create(resume=(io.BytesIO(b""), "resume.pdf")).status_code, 400)
        self.assertEqual(self.create(resume=(io.BytesIO(b"x"), "resume.txt")).status_code, 400)
        r = self.client.post("/api/agent/assessments", data={"user_id": self.U, "job_description": SAMPLE_JD,
                                                              "target_role": "x"}, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)

    def test_full_flow_report_and_remediation(self):
        r = self.create()
        self.assertEqual(r.status_code, 201)
        aid = r.json["id"]
        self.assertTrue(r.json["claims"])
        # Rubric definitions are exposed for the UI (names/points only, no heuristic keywords)
        crits = r.json["criteria"]["backend_engineering"]
        self.assertEqual(sum(c["points"] for c in crits), 100)
        self.assertNotIn("keywords", crits[0])
        state = self.start(aid)
        seen_questions = []
        answers = [STRONG, "I don't know.", "Not sure, I don't remember."]
        i = 0
        while state["status"] != "completed":
            q = state["session"]["pending_question"]
            self.assertIsNotNone(q)
            self.assertNotIn(q["content"], seen_questions)
            seen_questions.append(q["content"])
            res = self.answer(aid, q["id"], answers[i % 3])
            self.assertEqual(res.status_code, 200)
            state = res.json
            i += 1
            self.assertLess(i, 30)
        report = state["report"]
        self.assertIsNotNone(report)
        self.assertGreater(report["readiness_score"], 0)
        self.assertEqual(sum(report["status_counts"].values()), len(state["claims"]))
        self.assertTrue(report["competencies"])
        # Strengths link back to real answer messages and quote them verbatim
        msgs = {m["id"]: m for m in state["messages"]}
        for s in report["strengths"]:
            self.assertIn(s["quote"], msgs[s["message_id"]]["content"])
        # Every non-zero rubric criterion cites real evidence
        ev_ids = {e["id"] for e in state["evidence"]}
        for results in state["rubric"].values():
            for r_ in results:
                if r_["points_awarded"] > 0:
                    self.assertTrue(set(r_["evidence_ids"]) <= ev_ids and r_["evidence_ids"])
        self.assertTrue(state["remediation"])
        task = state["remediation"][0]
        for key in ("explanation", "exercise", "scenario", "solution_criteria", "follow_up_question"):
            self.assertIn(key, task)
        upd = self.client.patch(f"/api/agent/assessments/{aid}/remediation/{task['id']}", json={"user_id": self.U, "status": "done"})
        self.assertEqual(upd.status_code, 200)
        # History lists it
        listing = self.client.get(f"/api/agent/assessments?user_id={self.U}").json["assessments"]
        self.assertEqual(listing[0]["id"], aid)
        self.assertEqual(listing[0]["status"], "completed")

    def test_empty_answer_and_duplicate_submit(self):
        aid = self.create().json["id"]
        q = self.start(aid)["session"]["pending_question"]
        self.assertEqual(self.answer(aid, q["id"], "   ").status_code, 400)
        first = self.answer(aid, q["id"], STRONG)
        self.assertEqual(first.status_code, 200)
        dup = self.answer(aid, q["id"], STRONG)
        self.assertEqual(dup.status_code, 200)
        self.assertTrue(dup.json["duplicate"])
        answers = [m for m in dup.json["messages"] if m["role"] == "answer"]
        self.assertEqual(len(answers), 1)
        self.assertEqual(self.answer(aid, "not-a-question", STRONG).status_code, 409)

    def test_interrupted_interview_resumes(self):
        aid = self.create().json["id"]
        q = self.start(aid)["session"]["pending_question"]
        self.answer(aid, q["id"], STRONG)
        # Simulate a crash after the answer was saved but before the next question was written
        conn = sqlite3.connect(self.db_path)
        conn.execute("UPDATE interview_sessions SET pending_question_id=NULL WHERE assessment_id=?", (aid,))
        conn.commit()
        conn.close()
        # A fresh service instance (e.g. after restart) recovers state from the DB
        agent2 = CareerAgent(sqlite_factory(self.db_path), new_id, lambda: self.provider)
        state = agent2.start_interview(aid, self.U)
        self.assertIsNotNone(state["session"]["pending_question"])
        self.assertEqual(sum(1 for m in state["messages"] if m["role"] == "answer"), 1)

    def test_concurrent_start_is_idempotent(self):
        aid = self.create().json["id"]
        # Two starts in a row (React StrictMode double-fires effects) and a parallel pair from threads.
        import threading
        results = []
        threads = [threading.Thread(target=lambda: results.append(self.agent.start_interview(aid, self.U))) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        state = self.start(aid)
        questions = [m for m in state["messages"] if m["role"] == "question"]
        self.assertEqual(len(questions), 1)
        self.assertEqual(state["session"]["pending_question"]["id"], questions[0]["id"])
        self.assertEqual(len(results), 3)

    def test_end_early_marks_unasked_claims_insufficient(self):
        aid = self.create().json["id"]
        q = self.start(aid)["session"]["pending_question"]
        self.answer(aid, q["id"], STRONG)
        state = self.client.post(f"/api/agent/assessments/{aid}/interview/end", json={"user_id": self.U}).json
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["report"]["ended"], "ended_early")
        untouched = [c for c in state["claims"] if not c["interviewed"]]
        self.assertTrue(untouched)
        self.assertTrue(all(c["status"] == rubric.STATUS_INSUFFICIENT for c in untouched))
        again = self.client.post(f"/api/agent/assessments/{aid}/interview/end", json={"user_id": self.U})
        self.assertEqual(again.status_code, 200)  # idempotent

    def test_user_isolation(self):
        aid = self.create().json["id"]
        self.assertEqual(self.client.get(f"/api/agent/assessments/{aid}?user_id=intruder_1").status_code, 404)
        self.assertEqual(self.client.post(f"/api/agent/assessments/{aid}/interview/start",
                                          json={"user_id": "intruder_1"}).status_code, 404)
        self.assertEqual(self.client.get("/api/agent/assessments?user_id=intruder_1").json["assessments"], [])

    def test_model_timeout_during_interview_falls_back_and_is_labelled(self):
        self.provider = AlwaysFailProvider()
        aid = self.create().json["id"]
        state = self.start(aid)
        q = state["session"]["pending_question"]
        state = self.answer(aid, q["id"], STRONG).json
        usage = state["provider_usage"]
        self.assertTrue(all(u["provider"] == "offline" for u in usage))
        self.assertTrue(all(u["fallbacks"] == u["calls"] for u in usage))
        self.assertTrue(state["evidence"])

    def _wait(self, aid, done, timeout=15):
        import time as _t
        end = _t.time() + timeout
        while _t.time() < end:
            state = self.agent.get_assessment(aid, self.U)
            if done(state):
                return state
            _t.sleep(0.05)
        self.fail("background job did not finish")

    def test_background_mode_answers_return_immediately_and_complete(self):
        import time as _t

        class SlowOffline(OfflineProvider):
            def complete_json(self, *a, **kw):
                _t.sleep(0.3)  # stands in for a slow live model call
                return super().complete_json(*a, **kw)

        self.provider = SlowOffline()
        self.agent.run_async = True
        aid = self.create().json["id"]
        q = self.start(aid)["session"]["pending_question"]
        t0 = _t.time()
        res = self.answer(aid, q["id"], STRONG)
        self.assertEqual(res.status_code, 200)
        self.assertLess(_t.time() - t0, 0.25)  # returned before the model call finished
        self.assertTrue(res.json["session"]["processing"])
        self.assertIsNone(res.json["session"]["pending_question"])
        # A duplicate submit while it is still processing records nothing new
        dup = self.answer(aid, q["id"], STRONG)
        self.assertTrue(dup.json["duplicate"])
        state = self._wait(aid, lambda s: s["session"]["pending_question"] is not None)
        self.assertFalse(state["session"]["processing"])
        self.assertTrue(state["evidence"])
        self.assertEqual(sum(1 for m in state["messages"] if m["role"] == "answer"), 1)

        # Ending the interview evaluates in the background exactly once
        ended = self.client.post(f"/api/agent/assessments/{aid}/interview/end", json={"user_id": self.U}).json
        self.assertEqual(ended["status"], "evaluating")
        self.assertTrue(ended["evaluating"])
        again = self.client.post(f"/api/agent/assessments/{aid}/interview/end", json={"user_id": self.U})
        self.assertEqual(again.status_code, 200)
        final = self._wait(aid, lambda s: s["status"] == "completed", timeout=30)
        self.assertIsNotNone(final["report"])
        self.assertFalse(final["evaluating"])

    def test_lost_evaluation_can_be_retried(self):
        aid = self.create().json["id"]
        q = self.start(aid)["session"]["pending_question"]
        self.answer(aid, q["id"], STRONG)
        # Simulate a worker restart that killed the evaluation long ago
        conn = sqlite3.connect(self.db_path)
        conn.execute("UPDATE assessments SET status='evaluating', updated_at='2000-01-01 00:00:00' WHERE id=?", (aid,))
        conn.commit()
        conn.close()
        state = self.client.post(f"/api/agent/assessments/{aid}/interview/end", json={"user_id": self.U}).json
        self.assertEqual(state["status"], "completed")

    def test_provider_endpoint(self):
        info = self.client.get("/api/agent/provider").json
        self.assertEqual(info["provider"], "offline")
        self.assertFalse(info["is_meta"])


if __name__ == "__main__":
    unittest.main()
