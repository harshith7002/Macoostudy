"""Flask blueprint: /api/agent/*"""
import re

from flask import Blueprint, jsonify, request

from .resume_parser import ResumeParseError, parse_pdf
from .service import AgentError

_USER_ID = re.compile(r"^[A-Za-z0-9_\-.:@]{3,128}$")
MAX_JD_CHARS = 20000
MIN_JD_CHARS = 40
LEVELS = ("", "intern", "entry", "mid", "senior", "staff")


def _user_id():
    data = request.get_json(silent=True) if request.is_json else None
    value = (request.args.get("user_id") or request.form.get("user_id") or (data or {}).get("user_id") or "").strip()
    if not _USER_ID.match(value):
        raise AgentError("A valid user_id is required.", 400)
    return value


def create_blueprint(agent, provider_info):
    bp = Blueprint("career_agent", __name__, url_prefix="/api/agent")

    @bp.errorhandler(AgentError)
    def _agent_error(err):
        return jsonify({"error": str(err), **err.extra}), err.status

    @bp.route("/provider", methods=["GET"])
    def provider():
        return jsonify(provider_info())

    @bp.route("/assessments", methods=["POST"])
    def create():
        user_id = _user_id()
        file = request.files.get("resume")
        if not file or not file.filename:
            raise AgentError("Upload your resume as a PDF.", 400)
        if not file.filename.lower().endswith(".pdf"):
            raise AgentError("Only PDF resumes are supported.", 400)
        jd_text = (request.form.get("job_description") or "").strip()
        target_role = (request.form.get("target_role") or "").strip()[:120]
        level = (request.form.get("experience_level") or "").strip().lower()
        if len(jd_text) < MIN_JD_CHARS:
            raise AgentError("Paste the job description (at least a few sentences).", 400)
        if len(jd_text) > MAX_JD_CHARS:
            raise AgentError("The job description is too long (max 20,000 characters).", 400)
        if not target_role:
            raise AgentError("Enter the target role.", 400)
        if level not in LEVELS:
            raise AgentError("Unknown experience level.", 400)
        try:
            parsed = parse_pdf(file.read())
        except ResumeParseError as exc:
            raise AgentError(str(exc), 400)
        result = agent.create_assessment(user_id, parsed, file.filename[:200], jd_text, target_role, level)
        return jsonify(result), 201

    @bp.route("/assessments", methods=["GET"])
    def list_():
        return jsonify({"assessments": agent.list_assessments(_user_id())})

    @bp.route("/assessments/<assessment_id>", methods=["GET"])
    def get(assessment_id):
        return jsonify(agent.get_assessment(assessment_id, _user_id()))

    @bp.route("/assessments/<assessment_id>/interview/start", methods=["POST"])
    def start(assessment_id):
        return jsonify(agent.start_interview(assessment_id, _user_id()))

    @bp.route("/assessments/<assessment_id>/interview/answer", methods=["POST"])
    def answer(assessment_id):
        data = request.get_json(silent=True) or {}
        return jsonify(agent.submit_answer(assessment_id, _user_id(), data.get("question_id"), data.get("answer")))

    @bp.route("/assessments/<assessment_id>/interview/end", methods=["POST"])
    def end(assessment_id):
        return jsonify(agent.end_interview(assessment_id, _user_id()))

    @bp.route("/assessments/<assessment_id>/remediation/<task_id>", methods=["PATCH", "POST"])
    def task_status(assessment_id, task_id):
        data = request.get_json(silent=True) or {}
        return jsonify(agent.set_task_status(assessment_id, _user_id(), task_id, data.get("status")))

    return bp
