# 🔥 Roast My Resume (Macoostudy 2.0)

> **Brutally honest AI resume roaster and ATS career optimization suite.** Build a standout professional profile with real-time feedback, deep ATS breakdown analytics, target company alignment, and custom 4-week preparation roadmaps.

---

## 🚀 Key Features

* **Cinematic Dark Mode Dashboard**: Immersive glassmorphism stats cards, visual ATS score charts, and real-time referral credits tracker.
* **Brutal AI Roast & Scorecard**: Instant grading with FAANG readiness index, core strengths, and critical resume weaknesses.
* **Before vs. After Interactive Rewrites**: Side-by-side template examples showing how to elevate weak experience bullet points into high-impact metrics.
* **Custom 4-Week Career Roadmap**: Dynamic weekly schedule with step-by-step preparation objectives, difficulty ratings, and round details.
* **AI Career Copilot Chat**: Interactive, context-aware AI assistant supporting multi-line queries for live resume revisions.
* **Integrated Razorpay Payments**: Secure automated checkouts supporting Pro Lite and Pro Lifetime passes with webhook idempotency.
* **Cloud Database Persistence**: Backed by a Supabase cloud database with a custom SQLite-to-PostgreSQL syntax compatibility wrapper.

---

## 🛠️ Project Structure

```
roast-my-resume/
├── frontend/     ← React Single Page Application (styled via App.css)
└── backend/      ← Python Flask API + Supabase PostgreSQL adapter
```

---

## 🔑 Environment Setup

Before starting, configure the following variables in your `.env` files:

### Backend Configuration (`backend/.env`)
```ini
GROQ_API_KEY=your_groq_api_key                # Llama-3 LLM provider
DATABASE_URL=postgresql://your_supabase_url   # Supabase cloud database
RAZORPAY_KEY_ID=your_razorpay_key_id          # Razorpay payment keys
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret   # Webhook validation secret
```

### Frontend Configuration (`frontend/.env`)
```ini
REACT_APP_BACKEND_URL=http://localhost:5000   # Flask backend service URL
REACT_APP_RAZORPAY_KEY_ID=your_razorpay_id    # Client Razorpay key
```

---

## 🛠️ Local Development

### 1. Backend Service (Flask)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

### 2. Frontend Application (React)
```bash
cd frontend
npm install
npm start
```

---

## 🧪 Testing Suites

Validate code quality and route mock integrity:
* **Backend Unit Tests**:
  ```bash
  cd backend
  python -m unittest test_app.py
  ```
* **Frontend DOM Tests**:
  ```bash
  cd frontend
  npm test
  ```

---

## 🚀 Deployment Guide

### Step 1: Deploy Backend to Render (Free Tier)
1. Go to [render.com](https://render.com) → **New Web Service**.
2. Connect your GitHub repository.
3. Configure the settings:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app`
   - **Environment:** `Python 3`
4. Add your environment variables (`GROQ_API_KEY`, `DATABASE_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`).

### Step 2: Deploy Frontend to Netlify
1. Go to [netlify.com](https://netlify.com) → **Import from GitHub**.
2. Configure build settings:
   - **Build Command:** `npm run build`
   - **Publish Directory:** `build`
3. Add environment variable `REACT_APP_BACKEND_URL` pointing to your deployed Render URL.
4. Renew your SSL/TLS certificates under Domain Settings after domain mapping.
