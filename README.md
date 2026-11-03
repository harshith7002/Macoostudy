# Macoostudy

Upload a resume, get an ATS-style score breakdown and specific, opinionated feedback instead of generic "add more keywords" advice.

## Why I built it

Most resume feedback is either a vague "looks good!" from a friend or a black-box ATS score with no explanation of what's actually wrong. I wanted something that scores a resume the way an ATS + a blunt reviewer actually would, and shows *why* — category by category, with concrete before/after rewrites instead of just a number.

## What it does

- Scores a resume across 5 categories (ATS formatting, skills, projects, experience, impact), each 0-100, computed deterministically in `calculate_category_scores()` rather than left entirely to the LLM
- Matches a resume against a pasted job description and highlights gaps
- Generates before → after rewrite examples for weak bullet points
- Tracks history/dashboard of past roasts per user, with a comparison view between resumes
- Exports a vector-drawn PDF report (not a screenshot) via jsPDF
- Has a paid tier (Razorpay checkout) for extra roast styles and unlimited history

## Macoostudy Career Agent (Claim-to-Evidence Engine)

A technical skill auditor at `/agent`. It finds the gap between what a resume claims and what the candidate can explain:

```
resume claim → targeted question → candidate answer → evidence extraction → rubric evaluation → claim status → remediation
```

- **Claims.** The resume PDF is parsed into addressable lines (with sections). Each claim is a verbatim span of the resume with a stable ID (`clm_<sha1>`), character offsets, section, linked skills and a competency. Claims the model returns that can't be found in the resume text are dropped.
- **Adaptive interview.** The backend picks the target rubric criterion for each question (implementation, design rationale, trade-offs, failure handling, validation, plus one domain criterion). The question is generated from the claim and the transcript so far and is rejected if it is a near-repeat (similarity ≥ 0.82) of any earlier question. Each claim gets 2–3 questions. It moves on early when the evidence already covers the claim or after two "I don't know" answers.
- **Evidence.** After every answer, excerpts are mapped to criteria and must be verbatim substrings of that answer (stored with offsets and the message ID). Anything else is discarded.
- **Deterministic rubric.** Every competency has criteria worth 100 points in total (`career_agent/rubric.py`). The model (or the offline heuristic) only labels each criterion `demonstrated` / `partial` / `not_demonstrated` and cites evidence IDs. The backend downgrades any label that cites no valid evidence, then computes the points (full / half / zero), the claim score and the status: **SUPPORTED** ≥ 70, **PARTIALLY SUPPORTED** ≥ 35, otherwise **INSUFFICIENT EVIDENCE**. Explanations are deterministic and neutral. They describe what was explained and never imply dishonesty.
- **Gap types.** Every non-demonstrated criterion is labelled one of `knowledge_gap`, `weak_articulation` or `insufficient_evidence`. A criterion that was never asked about and has no evidence is always `insufficient_evidence`.
- **Heatmap, report, remediation.** The resume text is shown with every claim highlighted by status (live, provisional statuses during the interview). Clicking a claim opens its questions, highlighted answers, rubric table and recommendation. The report has a readiness score (the JD-relevance-weighted mean of interviewed claims), status counts, a competency chart, strengths quoting your answers, and gaps that link back to the exact exchange. Remediation gives each top gap a written exercise, scenario, solution criteria and follow-up question. User code is never executed.
- **Live updates.** Every answer response returns the updated state, including provisional claim scores, so updates are request/response. SSE was skipped on purpose: gunicorn sync workers on Render would be held open per client.

### Model providers

`career_agent/provider.py` defines `ModelProvider.complete_json()`: structured JSON output, schema validation, a repair re-prompt on malformed JSON, retries with backoff (honouring `Retry-After`) on 429/5xx/timeouts, and logs that never include keys. Providers are chosen in this order:

1. **Meta Model API** when `MODEL_API_KEY` is set: `POST https://api.meta.ai/v1/chat/completions` with `response_format: json_schema`, model `META_MODEL` (default `muse-spark-1.3`).
2. **Groq** when `GROQ_API_KEY` is set. It reuses the app's client and `get_best_model()`.
3. **Offline heuristics (no LLM)**: deterministic keyword and template logic, so the full flow works without credentials.

If a live call still fails after retries, that step falls back to the offline heuristic. The fallback is recorded per step (`provider_usage` in the API, a badge in the UI), so the app never claims a model that wasn't used. `GET /api/agent/provider` reports the active provider.

### Career Agent API (`/api/agent`, every call needs `user_id`; data is isolated per user)

| Method | Path | Purpose |
|---|---|---|
| GET | `/provider` | Active model provider |
| POST | `/assessments` | multipart: `resume` (PDF), `job_description`, `target_role`, `experience_level?` → claims |
| GET | `/assessments` | History for the user |
| GET | `/assessments/<id>` | Full state: claims, session, messages, evidence, rubric, report, remediation |
| POST | `/assessments/<id>/interview/start` | Start or resume (idempotent; recovers an interrupted session) |
| POST | `/assessments/<id>/interview/answer` | `{question_id, answer}`. Duplicate submits return `duplicate: true` and record nothing |
| POST | `/assessments/<id>/interview/end` | End early and evaluate (unasked claims → INSUFFICIENT EVIDENCE) |
| PATCH | `/assessments/<id>/remediation/<task_id>` | `{status: "todo" | "done"}` |

Tables: `assessments`, `resume_claims`, `interview_sessions`, `interview_messages`, `evidence_records`, `rubric_results`, `remediation_tasks`. They are created on startup on both SQLite and Postgres and are also listed in `backend/supabase_schema.sql`.

Known limitation: like the rest of the app, the backend trusts the `user_id` the client sends (a Supabase user ID, or a per-browser visitor ID for guests). It doesn't verify a Supabase JWT yet.

## Architecture

React SPA (`frontend/`) talking to a single Flask API (`backend/app.py`) over REST. The backend calls Groq (`llama-3.1-8b-instant`) for the actual resume analysis, and persists users/results/history to Supabase Postgres in production — SQLite locally, through a small compatibility shim so the same query code runs against both.

```
frontend/  React SPA (score gauge, category bars, JD matcher, dashboard, PDF export)
backend/   Flask API — resume parsing, Groq calls, Supabase/SQLite persistence, Razorpay
```

## Tech stack

React, Flask, Groq (Llama 3.1), Supabase/PostgreSQL (SQLite for local dev), Razorpay, jsPDF, Framer Motion.

## Interesting engineering problems

- **Deterministic scoring on top of an LLM.** The roast text comes from Groq, but the 5 category scores are computed by rule-based `calculate_category_scores()` so the same resume gets a stable, explainable score instead of the LLM's number drifting between runs.
- **Payment webhook idempotency.** Razorpay can retry webhook delivery; `/api/payments/webhook` has to safely handle the same event arriving twice without double-crediting an account.
- **One query layer, two databases.** Local dev runs on SQLite, production runs on Supabase Postgres. A thin adapter translates the SQL differences (placeholders, upserts) so the app code doesn't need a `if sqlite else postgres` branch scattered everywhere.
- **PDF export without a headless browser.** The report PDF is drawn directly with jsPDF (gauge, bars, text) instead of screenshotting the DOM, so it stays crisp and small.

## Running locally

### Backend (Flask)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Environment variables (`backend/.env`):
```ini
GROQ_API_KEY=your_groq_api_key
DATABASE_URL=postgresql://...        # omit locally to fall back to SQLite
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

### Frontend (React)
```bash
cd frontend
npm install
npm start
```

```ini
# frontend/.env
REACT_APP_BACKEND_URL=http://localhost:5000
REACT_APP_RAZORPAY_KEY_ID=your_razorpay_id
```

Career Agent provider keys (optional; without them it runs on labelled offline heuristics). See `backend/.env.example`:
```ini
MODEL_API_KEY=your_meta_model_api_key   # Meta Model API
META_MODEL=muse-spark-1.3
CAREER_AGENT_PROVIDER=                  # meta | groq | offline (optional override)
```

Open http://localhost:3000/agent for the Career Agent.

### Tests
```bash
cd backend && python -m unittest test_app.py test_career_agent.py
cd frontend && npm test
```
`test_career_agent.py` mocks every model call and uses a throwaway SQLite file. It covers claim grounding, malformed JSON and retries, the Meta request shape, timeouts and fallback, missing credentials, evidence grounding, non-repeating follow-ups, deterministic scoring and status thresholds, the report, duplicate and empty answers, interrupted and concurrent sessions, ending early, and user isolation.

## Deployment

Backend on Render (`gunicorn app:app`), frontend on Vercel. In Vercel, set the **Root Directory** to `frontend` and add your environment variables (`REACT_APP_BACKEND_URL` pointing to Render, `REACT_APP_RAZORPAY_KEY_ID`).

