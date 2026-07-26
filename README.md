# Roast My Resume — For Indian CS Freshers

Brutally honest AI resume feedback built for Indian CS students.

## Project Structure
```
roast-my-resume/
├── frontend/     ← React app (deploy to Netlify)
└── backend/      ← Flask API (deploy to Render)
```

---

## 🚀 Deployment Guide

### Step 1: Deploy Backend to Render (Free)

1. Push the `backend/` folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app`
   - **Environment:** Python 3
5. Add environment variable:
   - `GEMINI_API_KEY` = your Gemini API key from [aistudio.google.com](https://aistudio.google.com)
6. Deploy → copy your Render URL (e.g. `https://roast-resume.onrender.com`)

---

### Step 2: Deploy Frontend to Netlify

1. Create a `.env` file in `frontend/`:
   ```
   REACT_APP_BACKEND_URL=https://your-render-url.onrender.com
   ```
2. Push `frontend/` to GitHub
3. Go to [netlify.com](https://netlify.com) → Import from GitHub
4. Settings:
   - **Build Command:** `npm run build`
   - **Publish Directory:** `build`
5. Add environment variable in Netlify dashboard:
   - `REACT_APP_BACKEND_URL` = your Render backend URL
6. Deploy → connect your `macoostudy.info` custom domain

---

### Step 3: Fix SSL on Netlify
Before connecting your domain:
1. Go to your domain registrar (GoDaddy etc.)
2. Delete the A record pointing to `99.83.190.102`
3. Keep only: `A @ 75.2.60.5`
4. Wait 5 minutes → Netlify → Renew certificate

---

## 🔑 Getting Your Gemini API Key (Free)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click "Get API Key" → Create API Key
3. Copy it → paste in Render environment variables
4. Free tier = 15 requests/minute, 1M tokens/day (plenty!)

---

## 💰 Monetization (after launch)

1. **Google AdSense** — apply once you have traffic
2. **Affiliate links** — Coursera, Udemy courses in the results page
3. **Pro features** — PDF export, save results, detailed feedback

---

## 🛠️ Local Development

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # add your Gemini key
python app.py
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env   # add your backend URL
npm start
```

---

## 🧪 Testing Suites

Prove your code quality! Run the automated test suites:
- **Backend Testing**: Run `cd backend && python -m unittest test_app.py`
- **Frontend Testing**: Run `cd frontend && npm test`

