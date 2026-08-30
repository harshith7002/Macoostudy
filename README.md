# Roast My Resume

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

### Tests
```bash
cd backend && python -m unittest test_app.py
cd frontend && npm test
```

## Deployment

Backend on Render (`gunicorn app:app`), frontend on Netlify. Set the same environment variables listed above in each platform's dashboard; point `REACT_APP_BACKEND_URL` at the deployed Render URL.
