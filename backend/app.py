from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from groq import Groq
from pypdf import PdfReader
import io
import os

# Load environment variables from .env files if present
for env_path in [".env", "../.env", "backend/.env"]:
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip()
import re
import json
import sqlite3
try:
    import psycopg2
    import psycopg2.extras
    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False
import hashlib
import hmac
import time
from datetime import datetime
from functools import wraps
from concurrent.futures import ThreadPoolExecutor
import tempfile
import difflib

executor = ThreadPoolExecutor(max_workers=4)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
CORS(app, resources={r"/api/*": {"origins": os.environ.get("ALLOWED_ORIGINS", "*").split(",")}})

client = Groq(api_key=os.environ.get("GROQ_API_KEY", "YOUR_GROQ_API_KEY_HERE"))

_cached_working_model = None

def get_best_model(groq_client=None):
    global _cached_working_model
    if _cached_working_model:
        return _cached_working_model

    c = groq_client or client
    preferred = os.environ.get("GROQ_MODEL", "").strip()
    candidates = [preferred] if preferred else []
    candidates.extend([
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "llama-3.1-70b-versatile",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
    ])

    try:
        models_data = c.models.list().data
        available_ids = [m.id for m in models_data]
        print(f"[Groq] Models available to this key: {available_ids}")
        for cand in candidates:
            if cand in available_ids:
                _cached_working_model = cand
                print(f"[Groq] Selected candidate model: {_cached_working_model}")
                return _cached_working_model
        # If none of the candidates match, probe each model to find a working chat model
        NON_CHAT = ["whisper", "embed", "tts", "guard", "orpheus",
                    "canopy", "vision", "audio", "speech", "voice"]
        for m_id in available_ids:
            if any(skip in m_id.lower() for skip in NON_CHAT):
                continue
            print(f"[Groq] Probing fallback model: {m_id}")
            try:
                c.chat.completions.create(
                    model=m_id,
                    messages=[{"role": "user", "content": "hi"}],
                    max_tokens=1,
                )
                _cached_working_model = m_id
                print(f"[Groq] Fallback to available chat model: {_cached_working_model}")
                return _cached_working_model
            except Exception as probe_err:
                print(f"[Groq] Skipping {m_id}: {probe_err}")
                continue
    except Exception as e:
        print(f"[Groq] Could not list models: {e}")

    _cached_working_model = candidates[0] if candidates else "llama-3.3-70b-versatile"
    return _cached_working_model

DB_PATH = os.environ.get("DB_PATH", "macoostudy.db")

# ── Database ──────────────────────────────────────────────────────────────────

class DictRow(dict):
    """
    A dictionary class that allows both row['column'] and row[index] access
    to mimic sqlite3.Row behavior exactly!
    """
    def __init__(self, data, description):
        super().__init__(data)
        self._keys = [col.name for col in description]
        self._values = list(data.values())

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)

    def keys(self):
        return self._keys


class DBConnectionWrapper:
    def __init__(self, conn, is_postgres=False):
        self.conn = conn
        self.is_postgres = is_postgres
        self.cur = None

    def cursor(self):
        return self

    def executescript(self, script_text):
        if self.is_postgres:
            # PostgreSQL can execute multiple statements in one execute() call
            script_text = script_text.replace("datetime('now')", "CURRENT_TIMESTAMP")
            self.execute(script_text)
        else:
            self.cur = self.conn.cursor()
            self.cur.executescript(script_text)

    def execute(self, query, params=None):
        if self.is_postgres:
            # 1. Translate ? placeholders to %s
            query = query.replace('?', '%s')
            # 2. Translate SQLite datetime('now') to PostgreSQL CURRENT_TIMESTAMP
            query = query.replace("datetime('now')", "CURRENT_TIMESTAMP")
            # 3. Translate PRAGMA table_info to PostgreSQL schema query
            if "PRAGMA table_info(" in query:
                table_name = re.findall(r'PRAGMA table_info\((\w+)\)', query)[0]
                query = f"SELECT 1, column_name FROM information_schema.columns WHERE table_name = '{table_name}'"
            # 4. Translate SQLite INSERT OR IGNORE syntax
            if "INSERT OR IGNORE INTO email_captures" in query:
                query = query.replace("INSERT OR IGNORE", "INSERT")
                query += " ON CONFLICT (email) DO NOTHING"
            elif "INSERT OR IGNORE INTO users" in query:
                query = query.replace("INSERT OR IGNORE", "INSERT")
                if "provider, credits, tier" in query:
                    query += " ON CONFLICT (id) DO NOTHING"
                else:
                    query += " ON CONFLICT (email) DO NOTHING"
                    
        self.cur = self.conn.cursor()
        if params is None:
            self.cur.execute(query)
        else:
            self.cur.execute(query, params)
        return self

    def fetchone(self):
        if not self.cur:
            return None
        row = self.cur.fetchone()
        if row is None:
            return None
        if self.is_postgres:
            desc = self.cur.description
            colnames = [col.name for col in desc]
            row_dict = dict(zip(colnames, row))
            return DictRow(row_dict, desc)
        return row

    def fetchall(self):
        if not self.cur:
            return []
        rows = self.cur.fetchall()
        if self.is_postgres:
            desc = self.cur.description
            colnames = [col.name for col in desc]
            return [DictRow(dict(zip(colnames, r)), desc) for r in rows]
        return rows

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


def get_db():
    db_url = os.environ.get("DATABASE_URL")
    if db_url and HAS_POSTGRES:
        conn = psycopg2.connect(db_url)
        return DBConnectionWrapper(conn, is_postgres=True)
    else:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        return DBConnectionWrapper(conn, is_postgres=False)

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          TEXT PRIMARY KEY,
            email       TEXT UNIQUE NOT NULL,
            name        TEXT,
            avatar      TEXT,
            provider    TEXT DEFAULT 'email',
            credits     INTEGER DEFAULT 5,
            tier        TEXT DEFAULT 'free',
            created_at  TEXT DEFAULT (datetime('now')),
            last_login  TEXT
        );

        CREATE TABLE IF NOT EXISTS analyses (
            id          TEXT PRIMARY KEY,
            user_id     TEXT,
            type        TEXT NOT NULL,
            filename    TEXT,
            ats_score   INTEGER,
            verdict     TEXT,
            result_json TEXT,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS jd_matches (
            id            TEXT PRIMARY KEY,
            user_id       TEXT,
            analysis_id   TEXT,
            jd_snippet    TEXT,
            match_score   INTEGER,
            created_at    TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS email_captures (
            id         TEXT PRIMARY KEY,
            email      TEXT UNIQUE NOT NULL,
            source     TEXT DEFAULT 'pre_analysis',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS analytics_events (
            id         TEXT PRIMARY KEY,
            user_id    TEXT,
            event      TEXT NOT NULL,
            meta       TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id                 TEXT PRIMARY KEY,
            user_id            TEXT,
            razorpay_order_id  TEXT UNIQUE NOT NULL,
            razorpay_payment_id TEXT,
            amount             INTEGER NOT NULL,
            status             TEXT NOT NULL,
            tier_purchased     TEXT NOT NULL,
            created_at         TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id          TEXT PRIMARY KEY,
            user_id     TEXT,
            analysis_id TEXT,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (analysis_id) REFERENCES analyses(id)
        );
    """)
    conn.commit()

    # Get active columns for users and transactions tables to avoid race condition silent failures
    c.execute("PRAGMA table_info(users)")
    user_cols = [row[1] for row in c.fetchall()]
    
    c.execute("PRAGMA table_info(transactions)")
    tx_cols = [row[1] for row in c.fetchall()]

    # Migrate users columns if missing
    if "credits" not in user_cols:
        try:
            c.execute("ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 5")
            conn.commit()
            print("[Migration] Added credits column to users table.")
        except Exception as e:
            if "duplicate column" not in str(e).lower():
                raise e
                
    if "tier" not in user_cols:
        try:
            c.execute("ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free'")
            conn.commit()
            print("[Migration] Added tier column to users table.")
        except Exception as e:
            if "duplicate column" not in str(e).lower():
                raise e

    # Migrate transactions processed_event_id column if missing
    if "processed_event_id" not in tx_cols:
        try:
            c.execute("ALTER TABLE transactions ADD COLUMN processed_event_id TEXT")
            conn.commit()
            print("[Migration] Added processed_event_id column to transactions table.")
        except Exception as e:
            if "duplicate column" not in str(e).lower():
                raise e

    # Create unique index for idempotency (fully supported by SQLite & PostgreSQL)
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_event_id ON transactions (processed_event_id)")
        conn.commit()
    except Exception as e:
        if "already exists" not in str(e).lower():
            raise e

    conn.close()

init_db()

def uid():
    return hashlib.sha256(os.urandom(16)).hexdigest()[:16]

def track(event, user_id=None, meta=None):
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO analytics_events (id, user_id, event, meta) VALUES (?,?,?,?)",
            (uid(), user_id, event, json.dumps(meta) if meta else None)
        )
        conn.commit()
        conn.close()
    except Exception:
        pass

def valid_pdf_upload(file):
    if not file or not file.filename:
        return "Choose a PDF file."
    if not file.filename.lower().endswith(".pdf"):
        return "Only PDF files are supported."
    return None

def public_error(error):
    print(f"[API ERROR TRACE]: {type(error).__name__}: {str(error)}")
    message = str(error).lower()
    if "429" in message or "rate_limit" in message:
        return "The analysis service is busy. Please try again in a minute.", 429
    if "api key" in message or "authentication" in message or "invalid_api_key" in message:
        return "The AI analysis service has an API key issue. Please check GROQ_API_KEY in Render.", 503
    return "We could not complete the analysis. Please try again.", 500

@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": "The PDF must be smaller than 10 MB."}), 413

@app.route("/api/events", methods=["POST"])
def analytics_event():
    data = request.get_json(silent=True) or {}
    event = re.sub(r"[^a-z0-9_\-]", "", str(data.get("event", "")).lower())[:64]
    if not event:
        return jsonify({"error": "event required"}), 400
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    track(event, data.get("user_id"), meta)
    return jsonify({"success": True}), 201

# ── Language / Personality config (unchanged) ────────────────────────────────

LANG_INSTRUCTIONS = {
    "english":    "IMPORTANT: Write ONLY in English.",
    "hinglish":   "Write in Hinglish — a fun natural mix of Hindi and English.",
    "tanglish":   "Write in Tanglish — a fun natural mix of Tamil and English.",
    "tenglish":   "Write in Tenglish — a fun natural mix of Telugu and English.",
    "spanish":    "Write entirely in Spanish.",
    "french":     "Write entirely in French.",
    "german":     "Write entirely in German.",
    "portuguese": "Write entirely in Portuguese.",
    "arabic":     "Write entirely in Arabic.",
    "japanese":   "Write entirely in Japanese.",
    "korean":     "Write entirely in Korean.",
}

PERSONALITY_PROMPTS = {
    "default": "You are a brutally honest but hilarious senior software engineer who has seen thousands of fresher resumes.",
    "gordon":  "You are Gordon Ramsay reviewing a resume. Be ABSOLUTELY SAVAGE. Use phrases like 'THIS IS RAW!', 'YOU DONKEY!'",
    "parent":  "You are a stereotypically disappointed parent reviewing their child's resume.",
    "techbro": "You are a passive-aggressive Silicon Valley Tech Bro recruiter. Use excessive corporate jargon.",
    "senior":  "You are a toxic burnt-out senior developer with 15 years of experience and zero patience.",
}

# ── Resume scoring (unchanged logic) ─────────────────────────────────────────

def evaluate_resume_with_ai(resume_text):
    text_lower = resume_text.lower()
    score = 0
    cgpa_match = re.search(r'(\d+\.?\d*)\s*(?:cgpa|gpa)', text_lower)
    if cgpa_match:
        cgpa = float(cgpa_match.group(1))
        if cgpa >= 9.0: score += 30
        elif cgpa >= 8.5: score += 22
        elif cgpa >= 8.0: score += 15
        elif cgpa >= 7.0: score += 8
        elif cgpa >= 6.0: score += 3
    top = ['google','microsoft','amazon','meta','flipkart','uber','swiggy','zomato','razorpay','adobe','samsung','oracle','ibm']
    if any(c in text_lower for c in top) and 'intern' in text_lower:
        score += 35
    elif 'internship' in text_lower or 'intern ' in text_lower:
        score += 15
    proj = text_lower.count('project')
    deployed = any(x in text_lower for x in ['deployed','live','netlify','vercel','heroku','render'])
    if proj >= 4 and deployed: score += 20
    elif proj >= 2 and deployed: score += 14
    elif proj >= 2: score += 8
    else: score += 2
    if 'leetcode' in text_lower or 'codeforces' in text_lower: score += 12
    elif 'hackerrank' in text_lower or 'codechef' in text_lower: score += 5
    if 'open source' in text_lower: score += 8
    if any(x in text_lower for x in ['winner','won','first place','rank 1']): score += 10
    elif 'hackathon' in text_lower: score += 4
    if 'github' in text_lower: score += 3
    if any(x in text_lower for x in ['aws certified','google certified','azure certified']): score += 4
    if score >= 80: return "🌟 FAANG Possible"
    elif score >= 50: return "💰 Product Company Ready"
    elif score >= 25: return "🚀 Startup Ready"
    else: return "🏭 Entry Level"

def calculate_ats_score(resume_text):
    text_lower = resume_text.lower()
    score = 0
    tech_keywords = ['python','java','javascript','react','node','sql','aws','docker','git','api',
        'machine learning','deep learning','flask','django','mongodb','mysql','postgresql','typescript',
        'kubernetes','rest','graphql','redis','linux','c++','kotlin','swift','tensorflow','pytorch',
        'spring','express','nextjs','vue','angular','firebase','fastapi']
    keyword_count = sum(1 for k in tech_keywords if k in text_lower)
    if keyword_count >= 12: score += 20
    elif keyword_count >= 8: score += 15
    elif keyword_count >= 5: score += 10
    elif keyword_count >= 3: score += 5
    action_verbs = ['developed','built','designed','implemented','created','led','managed','optimized',
        'improved','deployed','architected','engineered','launched','delivered','reduced','increased',
        'automated','integrated','maintained','collaborated','spearheaded','streamlined']
    verb_count = sum(1 for v in action_verbs if v in text_lower)
    if verb_count >= 10: score += 15
    elif verb_count >= 7: score += 11
    elif verb_count >= 4: score += 7
    elif verb_count >= 2: score += 3
    metrics = re.findall(r'\d+%|\d+x|\d+\+|\$\d+|\d+\s*(?:users|requests|ms|seconds|lines|commits|stars|k\b|lakh|million)', text_lower)
    unique_metrics = len(set(metrics))
    if unique_metrics >= 8: score += 35
    elif unique_metrics >= 5: score += 25
    elif unique_metrics >= 3: score += 15
    elif unique_metrics >= 1: score += 8
    if '@' in text_lower: score += 4
    if 'linkedin' in text_lower: score += 3
    if 'github' in text_lower: score += 3
    if any(x in text_lower for x in ['b.tech','b.e','bachelor','computer science','engineering','bsc']): score += 5
    if 'experience' in text_lower or 'internship' in text_lower: score += 3
    if 'project' in text_lower: score += 2
    if 'objective' in text_lower: score -= 8
    if 'hobbies' in text_lower: score -= 8
    if 'reference' in text_lower: score -= 5
    if 'ms word' in text_lower: score -= 5
    if 'ms office' in text_lower: score -= 5
    return max(0, min(100, score))

def calculate_category_scores(resume_text):
    """Deterministic 0-100 sub-scores per category, derived from the same
    signals as the ATS/verdict heuristics so the interactive report shows
    real numbers (not AI-hallucinated ones)."""
    text_lower = resume_text.lower()
    clamp = lambda v: max(0, min(100, int(round(v))))

    # ── Skills: breadth of recognised tech keywords + profiles ──
    tech_keywords = ['python','java','javascript','react','node','sql','aws','docker','git','api',
        'machine learning','deep learning','flask','django','mongodb','mysql','postgresql','typescript',
        'kubernetes','rest','graphql','redis','linux','c++','kotlin','swift','tensorflow','pytorch',
        'spring','express','nextjs','vue','angular','firebase','fastapi']
    keyword_count = sum(1 for k in tech_keywords if k in text_lower)
    skills = keyword_count * 8
    if 'github' in text_lower: skills += 6
    if any(x in text_lower for x in ['aws certified','google certified','azure certified']): skills += 8
    skills = clamp(skills)

    # ── Projects: count + whether anything is actually shipped ──
    proj_count = text_lower.count('project')
    deployed = any(x in text_lower for x in ['deployed','live','netlify','vercel','heroku','render'])
    projects = proj_count * 14
    if deployed: projects += 30
    if 'open source' in text_lower: projects += 12
    projects = clamp(projects)

    # ── Experience: internships, brand names, education ──
    top = ['google','microsoft','amazon','meta','flipkart','uber','swiggy','zomato',
           'razorpay','adobe','samsung','oracle','ibm']
    experience = 0
    if any(c in text_lower for c in top) and 'intern' in text_lower:
        experience += 70
    elif 'internship' in text_lower or 'intern ' in text_lower:
        experience += 40
    cgpa_match = re.search(r'(\d+\.?\d*)\s*(?:cgpa|gpa)', text_lower)
    if cgpa_match:
        cgpa = float(cgpa_match.group(1))
        if cgpa >= 8.5: experience += 25
        elif cgpa >= 7.5: experience += 18
        elif cgpa >= 6.5: experience += 10
        else: experience += 4
    if any(x in text_lower for x in ['b.tech','b.e','bachelor','computer science','engineering','bsc']):
        experience += 10
    experience = clamp(experience)

    # ── Impact: quantified results, action verbs, achievements ──
    metrics = re.findall(r'\d+%|\d+x|\d+\+|\$\d+|\d+\s*(?:users|requests|ms|seconds|lines|commits|stars|k\b|lakh|million)', text_lower)
    unique_metrics = len(set(metrics))
    action_verbs = ['developed','built','designed','implemented','created','led','managed','optimized',
        'improved','deployed','architected','engineered','launched','delivered','reduced','increased',
        'automated','integrated','maintained','collaborated','spearheaded','streamlined']
    verb_count = sum(1 for v in action_verbs if v in text_lower)
    impact = unique_metrics * 16 + verb_count * 4
    if any(x in text_lower for x in ['winner','won','first place','rank 1']): impact += 15
    elif 'hackathon' in text_lower: impact += 6
    if 'leetcode' in text_lower or 'codeforces' in text_lower: impact += 8
    impact = clamp(impact)

    return {
        "ats":        calculate_ats_score(resume_text),
        "skills":     skills,
        "projects":   projects,
        "experience": experience,
        "impact":     impact,
    }

def extract_text_from_pdf(pdf_bytes):
    if len(pdf_bytes) > 10 * 1024 * 1024:
        raise ValueError("PDF is too large")
    if not pdf_bytes.startswith(b"%PDF"):
        raise ValueError("Invalid PDF")
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    return text.strip()

def fallback_resume_comparison(old_text, new_text, old_ats, new_ats):
    """Produce a useful comparison even when the AI provider is unavailable."""
    clean = lambda value: re.sub(r'\s+', ' ', value).strip()
    old_lines = {clean(line) for line in old_text.splitlines() if len(clean(line)) >= 24}
    new_lines = {clean(line) for line in new_text.splitlines() if len(clean(line)) >= 24}
    added = sorted(new_lines - old_lines, key=len, reverse=True)
    removed = sorted(old_lines - new_lines, key=len, reverse=True)

    improvements = []
    regressions = []
    if new_ats > old_ats:
        improvements.append(f"ATS readiness increased by {new_ats - old_ats} points.")
    elif new_ats < old_ats:
        regressions.append(f"ATS readiness decreased by {old_ats - new_ats} points.")

    metric_pattern = re.compile(r'\d+%|\d+x|\d+\+|\$\d+|\d+\s*(?:users|requests|customers|projects)', re.I)
    old_metrics = set(metric_pattern.findall(old_text))
    new_metrics = set(metric_pattern.findall(new_text))
    if len(new_metrics) > len(old_metrics):
        improvements.append(f"Added {len(new_metrics) - len(old_metrics)} measurable impact statement(s).")
    elif len(new_metrics) < len(old_metrics):
        regressions.append(f"Removed {len(old_metrics) - len(new_metrics)} measurable impact statement(s).")

    for line in added[:3]:
        improvements.append(f"Added: {line[:180]}")
    for line in removed[:2]:
        regressions.append(f"Removed: {line[:180]}")

    similarity = round(difflib.SequenceMatcher(None, old_text[:12000], new_text[:12000]).ratio() * 100)
    unchanged = [f"The versions are approximately {similarity}% textually similar."]
    if not improvements:
        improvements.append("The updated version preserves the previous resume's core content.")
    if not regressions:
        regressions = []

    if new_ats > old_ats:
        recommendation = "Use the updated version and keep strengthening bullets with outcomes, scope, and metrics."
    elif new_ats < old_ats:
        recommendation = "Restore the strongest removed details before using the updated version."
    else:
        recommendation = "The ATS score is unchanged; focus next on quantified impact and role-specific keywords."

    return {
        "improvements": improvements[:5],
        "regressions": regressions[:4],
        "unchanged": unchanged,
        "recommendation": recommendation,
    }

# ── JD Matcher ────────────────────────────────────────────────────────────────

JD_MATCH_PROMPT = """You are an expert ATS system and technical recruiter. Analyze the resume against the job description.

RESUME:
{resume_text}

JOB DESCRIPTION:
{jd_text}

Return ONLY valid JSON in this exact structure:
{{
  "match_score": <integer 0-100>,
  "strengths": [
    {{"point": "string", "detail": "string"}},
    {{"point": "string", "detail": "string"}},
    {{"point": "string", "detail": "string"}}
  ],
  "missing_skills": [
    {{"skill": "string", "importance": "critical|important|nice-to-have"}},
    {{"skill": "string", "importance": "critical|important|nice-to-have"}}
  ],
  "resume_keywords_missing_from_jd": ["string", "string", "string"],
  "improvements": [
    {{"action": "string", "why": "string"}},
    {{"action": "string", "why": "string"}},
    {{"action": "string", "why": "string"}}
  ],
  "summary": "2-sentence overall assessment"
}}

scoring guide:
- 85-100: Excellent match, apply now
- 70-84: Good match, minor gaps  
- 50-69: Decent match, notable gaps
- 30-49: Weak match, significant upskilling needed
- 0-29: Poor match

Return ONLY the JSON. No markdown, no preamble."""

@app.route("/api/jd-match", methods=["POST"])
def jd_match():
    if "resume" not in request.files:
        return jsonify({"error": "No resume uploaded"}), 400
    if not request.form.get("jd_text", "").strip():
        return jsonify({"error": "No job description provided"}), 400

    file = request.files["resume"]
    jd_text = request.form.get("jd_text", "").strip()
    user_id = request.form.get("user_id")

    validation_error = valid_pdf_upload(file)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    try:
        pdf_bytes = file.read()
        resume_text = extract_text_from_pdf(pdf_bytes)
        if len(resume_text) < 100:
            return jsonify({"error": "Could not extract text from PDF."}), 400

        prompt = JD_MATCH_PROMPT.format(
            resume_text=resume_text[:3500],
            jd_text=jd_text[:2000]
        )

        response = client.chat.completions.create(
            model=get_best_model(),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
            temperature=0.2,
        )

        raw = response.choices[0].message.content.strip()
        # strip markdown fences if present
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        result = json.loads(raw)

        analysis_id = uid()
        conn = get_db()
        conn.execute(
            "INSERT INTO analyses (id, user_id, type, filename, ats_score, verdict, result_json) VALUES (?,?,?,?,?,?,?)",
            (analysis_id, user_id, "jd_match", file.filename,
             result.get("match_score"), None, json.dumps(result))
        )
        conn.execute(
            "INSERT INTO jd_matches (id, user_id, analysis_id, jd_snippet, match_score) VALUES (?,?,?,?,?)",
            (uid(), user_id, analysis_id, jd_text[:200], result.get("match_score"))
        )
        conn.commit()
        conn.close()

        track("jd_match", user_id, {"score": result.get("match_score")})

        return jsonify({
            "success": True,
            "analysis_id": analysis_id,
            **result
        })

    except json.JSONDecodeError as e:
        return jsonify({"error": "AI returned invalid response, please retry."}), 500
    except Exception as e:
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── Roast (existing, now also saves to DB) ────────────────────────────────────

ROAST_PROMPT = """{personality_prompt}
LANGUAGE RULE: {lang_instruction}
VERDICT (DO NOT CHANGE THIS): {python_verdict}

Here is the resume:
{resume_text}

Give your roast in this EXACT format:

🔥 THE ROAST
[2-3 savage funny opening lines specific to THIS resume.]

💀 HALL OF SHAME (Top 3 Brutal Mistakes)
1. [Specific mistake]
2. [Specific mistake]
3. [Specific mistake]

✅ OKAY FINE, THIS IS DECENT
[2-3 genuinely good things]

📈 GLOW UP GUIDE (5 Specific Fixes)
1. [Actionable fix]
2. [Actionable fix]
3. [Actionable fix]
4. [Actionable fix]
5. [Actionable fix]

🎯 FINAL VERDICT
{python_verdict}
[2 sentences explaining why in character voice]"""

@app.route("/roast", methods=["POST"])
@app.route("/api/roast", methods=["POST"])
def roast_resume():
    if "resume" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    file = request.files["resume"]
    validation_error = valid_pdf_upload(file)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    language    = request.form.get("language", "english")
    personality = request.form.get("personality", "default")
    user_id     = request.form.get("user_id")

    try:
        pdf_bytes   = file.read()
        resume_text = extract_text_from_pdf(pdf_bytes)
        if len(resume_text) < 100:
            return jsonify({"error": "Could not extract text from PDF."}), 400

        lang_instruction  = LANG_INSTRUCTIONS.get(language, LANG_INSTRUCTIONS["english"])
        personality_prompt = PERSONALITY_PROMPTS.get(personality, PERSONALITY_PROMPTS["default"])
        python_verdict    = evaluate_resume_with_ai(resume_text)
        python_ats        = calculate_ats_score(resume_text)
        category_scores   = calculate_category_scores(resume_text)

        prompt = ROAST_PROMPT.format(
            personality_prompt=personality_prompt,
            lang_instruction=lang_instruction,
            python_verdict=python_verdict,
            resume_text=resume_text[:4000]
        )

        response = client.chat.completions.create(
            model=get_best_model(),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1200,
            temperature=0.7,
        )
        roast_text = response.choices[0].message.content

        analysis_id = uid()
        conn = get_db()
        conn.execute(
            "INSERT INTO analyses (id, user_id, type, filename, ats_score, verdict, result_json) VALUES (?,?,?,?,?,?,?)",
            (analysis_id, user_id, "roast", file.filename, python_ats, python_verdict,
             json.dumps({"roast": roast_text, "category_scores": category_scores}))
        )
        conn.commit()
        conn.close()

        track("resume_upload_completed", user_id, {"ats_score": python_ats, "personality": personality, "language": language})

        return jsonify({
            "roast": roast_text,
            "success": True,
            "verdict": python_verdict,
            "ats_score": python_ats,
            "category_scores": category_scores,
            "analysis_id": analysis_id,
            "resume_text": resume_text,
        })

    except Exception as e:
        track("resume_upload_failed", user_id, {"reason": type(e).__name__})
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── Resume History ────────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
def get_history():
    user_id = request.args.get("user_id")
    search  = request.args.get("search", "")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    conn = get_db()
    if search:
        rows = conn.execute(
            "SELECT * FROM analyses WHERE user_id=? AND (filename LIKE ? OR verdict LIKE ? OR result_json LIKE ?) ORDER BY created_at DESC LIMIT 50",
            (user_id, f"%{search}%", f"%{search}%", f"%{search}%")
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM analyses WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
            (user_id,)
        ).fetchall()
    conn.close()

    return jsonify({"analyses": [dict(r) for r in rows]})


# ── Dashboard Stats ───────────────────────────────────────────────────────────

@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    conn = get_db()

    total = conn.execute("SELECT COUNT(*) FROM analyses WHERE user_id=?", (user_id,)).fetchone()[0]
    avg_ats_row = conn.execute("SELECT AVG(ats_score) FROM analyses WHERE user_id=? AND ats_score IS NOT NULL", (user_id,)).fetchone()
    avg_ats = round(avg_ats_row[0] or 0, 1)

    recent = conn.execute(
        "SELECT ats_score, created_at FROM analyses WHERE user_id=? AND ats_score IS NOT NULL ORDER BY created_at ASC LIMIT 10",
        (user_id,)
    ).fetchall()

    jd_count = conn.execute("SELECT COUNT(*) FROM jd_matches WHERE user_id=?", (user_id,)).fetchone()[0]
    avg_jd_row = conn.execute("SELECT AVG(match_score) FROM jd_matches WHERE user_id=?", (user_id,)).fetchone()
    avg_jd = round(avg_jd_row[0] or 0, 1)

    conn.close()

    trend = [{"score": r["ats_score"], "date": r["created_at"][:10]} for r in recent]

    return jsonify({
        "total_analyses": total,
        "avg_ats_score": avg_ats,
        "jd_matches_count": jd_count,
        "avg_jd_match": avg_jd,
        "ats_trend": trend,
    })


# ── Email Capture ─────────────────────────────────────────────────────────────

@app.route("/api/email-capture", methods=["POST"])
def email_capture():
    data  = request.get_json(silent=True) or {}
    email = data.get("email", "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "Invalid email"}), 400

    conn = get_db()
    try:
        eid = uid()
        conn.execute(
            "INSERT OR IGNORE INTO email_captures (id, email, source) VALUES (?,?,?)",
            (eid, email, data.get("source", "pre_analysis"))
        )
        # Also upsert user
        conn.execute(
            "INSERT OR IGNORE INTO users (id, email, provider) VALUES (?,?,'email')",
            (eid, email)
        )
        conn.commit()
        user_row = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        user_id = user_row["id"] if user_row else eid
        conn.close()
        track("signup", user_id)
        return jsonify({"success": True, "user_id": user_id})
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500


@app.route("/api/auth/sync", methods=["POST"])
def auth_sync():
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    email = data.get("email", "").strip().lower()
    name = data.get("name", "")
    
    if not user_id or not email:
        return jsonify({"error": "user_id and email required"}), 400
        
    conn = get_db()
    try:
        # Check if user already exists
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            # Check if email is already captured/associated with another row
            existing_email = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if existing_email:
                # Update existing row to map to Supabase user_id
                conn.execute(
                    "UPDATE users SET id=?, name=? WHERE email=?",
                    (user_id, name, email)
                )
            else:
                # Insert brand new user row
                conn.execute(
                    "INSERT INTO users (id, email, name, provider) VALUES (?,?,?, 'google')",
                    (user_id, email, name)
                )
            conn.commit()
            row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            
        conn.close()
        return jsonify({
            "success": True,
            "user_id": row["id"],
            "email": row["email"],
            "tier": row["tier"],
            "credits": row["credits"]
        })
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500


# ── Version Comparison ────────────────────────────────────────────────────────

@app.route("/api/compare", methods=["POST"])
def compare_resumes():
    if "resume_old" not in request.files or "resume_new" not in request.files:
        return jsonify({"error": "Both resume_old and resume_new are required"}), 400

    old_file = request.files["resume_old"]
    new_file = request.files["resume_new"]
    for file in (old_file, new_file):
        validation_error = valid_pdf_upload(file)
        if validation_error:
            return jsonify({"error": validation_error}), 400

    user_id = request.form.get("user_id")
    app.logger.info("compare_started user_id=%s old=%s new=%s", user_id, old_file.filename, new_file.filename)
    try:
        old_bytes = old_file.read()
        new_bytes = new_file.read()
        old_text  = extract_text_from_pdf(old_bytes)
        new_text  = extract_text_from_pdf(new_bytes)
        if len(old_text) < 100 or len(new_text) < 100:
            return jsonify({"error": "We could not read enough text from one of the PDFs. Try text-based PDFs instead of scanned images."}), 400
        if hashlib.sha256(old_bytes).digest() == hashlib.sha256(new_bytes).digest():
            return jsonify({"error": "The two uploaded PDFs are identical."}), 400

        old_ats = calculate_ats_score(old_text)
        new_ats = calculate_ats_score(new_text)
        old_verdict = evaluate_resume_with_ai(old_text)
        new_verdict = evaluate_resume_with_ai(new_text)

        COMPARE_PROMPT = f"""Compare these two resume versions and identify concrete changes.

OLD RESUME:
{old_text[:2000]}

NEW RESUME:
{new_text[:2000]}

Return ONLY valid JSON:
{{
  "improvements": ["string", "string", "string"],
  "regressions": ["string", "string"],
  "unchanged": ["string", "string"],
  "recommendation": "string"
}}"""

        diff = fallback_resume_comparison(old_text, new_text, old_ats, new_ats)
        api_key = os.environ.get("GROQ_API_KEY", "")
        if api_key and api_key != "YOUR_GROQ_API_KEY_HERE":
            try:
                response = client.chat.completions.create(
                    model=get_best_model(),
                    messages=[{"role": "user", "content": COMPARE_PROMPT}],
                    max_tokens=800,
                    temperature=0.2,
                )
                raw = response.choices[0].message.content.strip()
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```$', '', raw)
                ai_diff = json.loads(raw)
                if isinstance(ai_diff, dict):
                    diff.update({key: ai_diff[key] for key in ("improvements", "regressions", "unchanged", "recommendation") if ai_diff.get(key)})
            except Exception as enrichment_error:
                app.logger.warning("compare_ai_enrichment_failed type=%s", type(enrichment_error).__name__)

        analysis_id = uid()
        result = {
            "success": True,
            "analysis_id": analysis_id,
            "old_ats": old_ats,
            "new_ats": new_ats,
            "ats_delta": new_ats - old_ats,
            "old_verdict": old_verdict,
            "new_verdict": new_verdict,
            **diff
        }
        conn = get_db()
        conn.execute(
            "INSERT INTO analyses (id, user_id, type, filename, ats_score, verdict, result_json) VALUES (?,?,?,?,?,?,?)",
            (analysis_id, user_id, "compare", f"{old_file.filename} -> {new_file.filename}", new_ats, new_verdict, json.dumps(result))
        )
        conn.commit()
        conn.close()
        track("compare_completed", user_id, {"ats_delta": new_ats - old_ats})
        app.logger.info("compare_completed analysis_id=%s ats_delta=%s", analysis_id, new_ats - old_ats)
        return jsonify(result)
    except Exception as e:
        app.logger.exception("compare_failed user_id=%s", user_id)
        track("compare_failed", user_id, {"reason": type(e).__name__})
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── Analytics (admin) ─────────────────────────────────────────────────────────

@app.route("/api/analytics/summary", methods=["GET"])
def analytics_summary():
    conn = get_db()
    total_users     = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    total_uploads   = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
    total_jd        = conn.execute("SELECT COUNT(*) FROM jd_matches").fetchone()[0]
    total_emails    = conn.execute("SELECT COUNT(*) FROM email_captures").fetchone()[0]
    events_by_type  = conn.execute(
        "SELECT event, COUNT(*) as cnt FROM analytics_events GROUP BY event ORDER BY cnt DESC"
    ).fetchall()
    conn.close()
    return jsonify({
        "total_users": total_users,
        "total_uploads": total_uploads,
        "total_jd_matches": total_jd,
        "email_captures": total_emails,
        "events": [dict(r) for r in events_by_type],
    })


# ── Payments (Razorpay) ───────────────────────────────────────────────────────

def get_razorpay_client():
    """Read env vars fresh on every call so Render env changes are picked up without restart."""
    key_id = os.environ.get("RAZORPAY_KEY_ID", "")
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "")

    # Debug print — visible in Render application logs
    print(f"[Razorpay] KEY_ID present: {bool(key_id)}, KEY_ID prefix: {key_id[:8] if len(key_id) >= 8 else 'too_short'}")
    print(f"[Razorpay] KEY_SECRET present: {bool(key_secret)}")

    if not key_id or not key_secret:
        print("[Razorpay] ERROR: Missing credentials — cannot create client.")
        return None, key_id, key_secret

    try:
        import razorpay
        client = razorpay.Client(auth=(key_id, key_secret))
        print("[Razorpay] Client initialized successfully.")
        return client, key_id, key_secret
    except Exception as e:
        print(f"[Razorpay] ERROR: Client init failed: {e}")
        return None, key_id, key_secret

@app.route("/api/payments/test-config")
def test_payments_config():
    client, key_id, key_secret = get_razorpay_client()
    return jsonify({
        "key_id_present": bool(key_id),
        "key_secret_present": bool(key_secret),
        "client_ok": client is not None,
        "razorpay_key_id_preview": key_id[:8] if len(key_id) >= 8 else "too_short"
    })

@app.route("/api/payments/create-order", methods=["POST"])
def create_payment_order():
    data = request.get_json(silent=True) or {}
    tier = data.get("tier", "pro")
    user_id = data.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    if tier == "pro":
        amount = 4900  # ₹49 in paise (Pro Lite)
    elif tier == "pro_plus":
        amount = 29900  # ₹299 in paise (Pro Lifetime)
    else:
        return jsonify({"error": "Invalid tier specified"}), 400

    client_rp, rzp_key_id, rzp_key_secret = get_razorpay_client()

    if not client_rp:
        msg = "Payment gateway not configured" if not rzp_key_id else "Razorpay client failed to initialize"
        print(f"[create-order] Aborting: {msg}")
        return jsonify({"error": f"{msg}. Please try again later or contact support."}), 503

    try:
        order_data = {
            "amount": amount,
            "currency": "INR",
            "receipt": f"receipt_{uid()}"
        }
        order = client_rp.order.create(data=order_data)
        order_id = order["id"]
    except Exception as e:
        app.logger.error("Razorpay order creation failed: %s", str(e))
        return jsonify({"error": f"Payment gateway error: {str(e)}"}), 500

    # Save transaction to database
    conn = get_db()
    conn.execute(
        "INSERT INTO transactions (id, user_id, razorpay_order_id, amount, status, tier_purchased) VALUES (?,?,?,?,?,?)",
        (uid(), user_id, order_id, amount, "created", tier)
    )
    conn.commit()
    conn.close()

    return jsonify({
        "order_id": order_id,
        "amount": amount,
        "currency": "INR",
        "key_id": rzp_key_id
    })

@app.route("/api/payments/verify", methods=["POST"])
def verify_payment():
    import hmac
    import hashlib
    data = request.get_json(silent=True) or {}
    order_id = data.get("razorpay_order_id")
    payment_id = data.get("razorpay_payment_id")
    signature = data.get("razorpay_signature")
    user_id = data.get("user_id")

    if not order_id or not payment_id:
        return jsonify({"error": "Missing order or payment ID"}), 400

    # Strict production security: bypass/mock modes are only allowed on localhost for local testing.
    # Production domains (e.g. macoostudy.info) must perform strict cryptographic signature verification.
    host = request.host.lower()
    is_localhost = ("localhost" in host or "127.0.0.1" in host)

    is_valid = False
    if signature and signature != "mock_signature_bypass":
        client_rp = get_razorpay_client()
        if client_rp:
            try:
                params = {
                    'razorpay_order_id': order_id,
                    'razorpay_payment_id': payment_id,
                    'razorpay_signature': signature
                }
                client_rp.utility.verify_payment_signature(params)
                is_valid = True
            except Exception:
                is_valid = False
        else:
            # Fallback signature verification using HMAC-SHA256
            msg = f"{order_id}|{payment_id}".encode("utf-8")
            sec = RAZORPAY_KEY_SECRET.encode("utf-8")
            generated = hmac.new(sec, msg, hashlib.sha256).hexdigest()
            is_valid = hmac.compare_digest(generated, signature)
    elif is_localhost:
        # Mock mode bypass is ONLY allowed during local testing
        is_valid = True
    else:
        is_valid = False

    if not is_valid:
        return jsonify({"error": "Payment signature verification failed"}), 400

    conn = get_db()
    tx = conn.execute("SELECT * FROM transactions WHERE razorpay_order_id=?", (order_id,)).fetchone()
    if tx:
        tier = tx["tier_purchased"]
        conn.execute(
            "UPDATE transactions SET status='completed', razorpay_payment_id=? WHERE razorpay_order_id=?",
            (payment_id, order_id)
        )
        # Update user's profile credits and tier
        credits = 99999  # Unlimited/Pro credits
        conn.execute(
            "UPDATE users SET credits=?, tier=? WHERE id=?",
            (credits, tier, user_id)
        )
        conn.commit()
        conn.close()

        track("payment_completed", user_id, {"tier": tier, "amount": tx["amount"]})
        return jsonify({"success": True, "tier": tier, "credits": credits})
    else:
        # If order wasn't pre-created locally, create user and grant tier directly (graceful fallback)
        tier = "pro"
        conn.execute(
            "INSERT OR IGNORE INTO users (id, email, name, provider, credits, tier) VALUES (?,?,'User',?,99999,?)",
            (user_id, f"{user_id}@mock.com", tier, tier)
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "tier": tier, "credits": 99999})



# ── Razorpay Webhook ──────────────────────────────────────────────────────────

def _process_webhook_upgrade(order_id, payment_id, event_id):
    """
    Runs in a background thread (ThreadPoolExecutor).
    Opens its own fresh SQLite connection — required for thread safety.
    Updates the transaction to 'completed' and upgrades the user's tier.
    """
    try:
        with sqlite3.connect(DB_PATH, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            tx = conn.execute(
                "SELECT * FROM transactions WHERE razorpay_order_id=?", (order_id,)
            ).fetchone()

            if not tx:
                print(f"[Webhook] No transaction found for order_id={order_id}")
                return

            tier = tx["tier_purchased"]
            user_id = tx["user_id"]
            credits = 99999  # Unlimited for paid tiers

            conn.execute(
                "UPDATE transactions SET status='completed', razorpay_payment_id=?, processed_event_id=? WHERE razorpay_order_id=?",
                (payment_id, event_id, order_id)
            )
            conn.execute(
                "UPDATE users SET credits=?, tier=? WHERE id=?",
                (credits, tier, user_id)
            )
            conn.commit()
            print(f"[Webhook] Successfully upgraded user={user_id} to tier={tier} via order={order_id}")
    except Exception as e:
        print(f"[Webhook] Background task error: {e}")


@app.route("/api/payments/webhook", methods=["POST"])
def razorpay_webhook():
    # Step 1: Read raw bytes BEFORE any JSON parsing (required for HMAC)
    raw_payload = request.data

    webhook_secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    received_signature = request.headers.get("X-Razorpay-Signature", "")
    event_id = request.headers.get("X-Razorpay-Event-Id", "")

    # Step 2: Verify HMAC-SHA256 signature
    if webhook_secret and received_signature:
        expected_signature = hmac.new(
            webhook_secret.encode("utf-8"),
            raw_payload,
            "sha256"
        ).hexdigest()

        if not hmac.compare_digest(expected_signature, received_signature):
            print("[Webhook] Signature mismatch — rejecting request")
            return jsonify({"error": "Signature verification failed"}), 400
    else:
        # In test mode without a webhook secret, log a warning but continue
        print("[Webhook] WARNING: No RAZORPAY_WEBHOOK_SECRET set — skipping signature check")

    # Step 3: Parse event
    event_data = request.get_json(silent=True) or {}
    event_type = event_data.get("event")

    if event_type == "order.paid":
        payload = event_data.get("payload", {})
        payment_entity = payload.get("payment", {}).get("entity", {})
        order_id = payment_entity.get("order_id")
        payment_id = payment_entity.get("id")

        if not order_id:
            return jsonify({"error": "Missing order_id in webhook payload"}), 400

        try:
            # Step 4: Idempotency check in main thread (fast read)
            with sqlite3.connect(DB_PATH, timeout=10) as conn:
                conn.row_factory = sqlite3.Row
                tx = conn.execute(
                    "SELECT status, processed_event_id FROM transactions WHERE razorpay_order_id=?",
                    (order_id,)
                ).fetchone()

                if not tx:
                    print(f"[Webhook] Unknown order_id={order_id} — not found in transactions")
                    return jsonify({"error": "Transaction not found"}), 404

                # Already processed — return 200 immediately (idempotency)
                if tx["status"] == "completed" or (event_id and tx["processed_event_id"] == event_id):
                    print(f"[Webhook] Already processed order_id={order_id} — skipping")
                    return jsonify({"status": "already_processed"}), 200

            # Step 5: Dispatch to background thread so we respond in < 5s
            executor.submit(_process_webhook_upgrade, order_id, payment_id, event_id)
            return jsonify({"status": "processing"}), 200

        except Exception as e:
            print(f"[Webhook] Database lookup error: {e}")
            return jsonify({"error": "Internal server error"}), 500

    # All other event types — acknowledge and ignore
    print(f"[Webhook] Ignored event type: {event_type}")
    return jsonify({"status": "ignored"}), 200








# ── Admin Upgrade User (Secure Permanent) ──────────────────────────────────────

@app.route("/api/admin/upgrade-user", methods=["GET", "POST"])
def admin_upgrade_user():
    secret = request.headers.get("X-Admin-Secret") or request.args.get("secret")
    expected_secret = os.environ.get("ADMIN_SECRET_KEY")
    
    # Strictly require env variable setup for security
    if not expected_secret or secret != expected_secret:
        return "Unauthorized", 401
        
    if request.method == "GET":
        email = request.args.get("email")
        user_id = request.args.get("user_id")
        tier = request.args.get("tier", "pro_plus")
    else:
        data = request.get_json(silent=True) or {}
        email = data.get("email") or request.args.get("email")
        user_id = data.get("user_id") or request.args.get("user_id")
        tier = data.get("tier", "pro_plus") or request.args.get("tier", "pro_plus")
    
    if not email and not user_id:
        return "email or user_id required", 400
        
    conn = get_db()
    if email:
        email = email.strip().lower()
        user = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not user:
            uid_val = user_id or f"usr_manual_{uid()}"
            conn.execute(
                "INSERT INTO users (id, email, name, provider, credits, tier) VALUES (?,?,?, 'google', 99999, ?)",
                (uid_val, email, email.split("@")[0], tier)
            )
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        else:
            conn.execute(
                "UPDATE users SET tier=?, credits=99999 WHERE email=?",
                (tier, email)
            )
            conn.commit()
        uid_val = user["id"]
    else:
        user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not user:
            conn.execute(
                "INSERT INTO users (id, email, name, provider, credits, tier) VALUES (?,?,'User', 'google', 99999, ?)",
                (user_id, f"{user_id}@supabase.com", tier)
            )
            conn.commit()
        else:
            conn.execute(
                "UPDATE users SET tier=?, credits=99999 WHERE id=?",
                (tier, user_id)
            )
            conn.commit()
        uid_val = user_id

    # Update transactions as well if present
    conn.execute(
        "UPDATE transactions SET status='completed' WHERE user_id=?",
        (uid_val,)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"Successfully upgraded user {uid_val} to {tier}!"})




# ── AI Resume Chat ────────────────────────────────────────────────────────────

CHAT_PROMPT = """You are a helpful and experienced career advisor. The user has uploaded their resume and got it evaluated.
Here is the text of their resume for context:
---
{resume_text}
---

Answer their question in a concise, highly actionable, and slightly witty manner. Keep formatting clean (use markdown highlights/bullets).
Question: {question}"""

@app.route("/api/resume/chat", methods=["POST"])
def resume_chat():
    data = request.get_json(silent=True) or {}
    analysis_id = data.get("analysis_id")
    resume_text = data.get("resume_text", "").strip()
    question = data.get("question", "").strip()
    user_id = data.get("user_id")

    if not resume_text or not question:
        return jsonify({"error": "resume_text and question are required"}), 400

    conn = get_db()
    # Get recent chat history (if analysis_id exists)
    history_rows = []
    if analysis_id:
        history_rows = conn.execute(
            "SELECT role, content FROM chat_messages WHERE analysis_id=? ORDER BY created_at ASC LIMIT 10",
            (analysis_id,)
        ).fetchall()
    
    conn.close()

    messages = []
    # Build chatbot messages structure
    messages.append({
        "role": "system",
        "content": f"The candidate resume context:\n{resume_text[:3000]}"
    })
    for r in history_rows:
        messages.append({"role": r["role"], "content": r["content"]})
    messages.append({
        "role": "user",
        "content": CHAT_PROMPT.format(resume_text=resume_text[:2000], question=question)
    })

    try:
        response = client.chat.completions.create(
            model=get_best_model(),
            messages=messages,
            max_tokens=600,
            temperature=0.7,
        )
        ai_reply = response.choices[0].message.content.strip()

        # Save to database
        conn = get_db()
        conn.execute(
            "INSERT INTO chat_messages (id, user_id, analysis_id, role, content) VALUES (?,?,?,?,?)",
            (uid(), user_id, analysis_id, "user", question)
        )
        conn.execute(
            "INSERT INTO chat_messages (id, user_id, analysis_id, role, content) VALUES (?,?,?,?,?)",
            (uid(), user_id, analysis_id, "assistant", ai_reply)
        )
        conn.commit()
        conn.close()

        return jsonify({"response": ai_reply, "success": True})
    except Exception as e:
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── Resume Bullet Rewriter ────────────────────────────────────────────────────

REWRITE_PROMPT = """You are an expert resume writer. Rewrite the following resume bullet point using the Google XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]" or the STAR method. Ensure high-impact action verbs and quantified metrics are included.

Original Bullet:
{bullet}

Return ONLY valid JSON in this exact structure:
{{
  "original": "original bullet",
  "rewritten": "polished high-impact XYZ/STAR bullet",
  "explanation": "Why this change was made and what was improved"
}}

Return ONLY raw JSON. No markdown, no preamble."""

@app.route("/api/resume/rewrite", methods=["POST"])
def resume_rewrite():
    data = request.get_json(silent=True) or {}
    bullet = data.get("bullet", "").strip()
    if not bullet:
        return jsonify({"error": "bullet text is required"}), 400

    try:
        prompt = REWRITE_PROMPT.format(bullet=bullet)
        response = client.chat.completions.create(
            model=get_best_model(),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
            temperature=0.3,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        result = json.loads(raw)
        return jsonify({"success": True, "rewrite": result})
    except Exception as e:
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── Resume vs Company Compare ─────────────────────────────────────────────────

COMPANY_PROFILES = {
    "google": "Google focuses heavily on computer science fundamentals, scalability, complex algorithms, systems design, and clean code principles.",
    "amazon": "Amazon prioritizes its 16 Leadership Principles (especially Customer Obsession, Ownership, Bias for Action, and Deliver Results), distributed systems, and cloud computing (AWS).",
    "microsoft": "Microsoft values collaborative software engineering, developer tooling, enterprise software integration, security, and AI/cloud-first developments (Azure).",
    "cisco": "Cisco emphasizes networking protocols (TCP/IP, BGP), systems programming, hardware-software integration, cybersecurity, and IoT infrastructure.",
    "bny": "BNY (Bank of New York Mellon) values fintech engineering, transaction processing speed, absolute security and compliance, databases, and financial systems stability.",
    "adobe": "Adobe values high-performance graphics engines, SaaS architectures (Creative Cloud), excellent user experience design, and robust cloud services.",
    "nvidia": "Nvidia focuses on high-performance computing, GPU architectures, CUDA development, parallel programming, and cutting-edge deep learning/AI algorithms.",
    "oracle": "Oracle emphasizes database engines (relational and NoSQL), enterprise cloud infrastructure (OCI), enterprise Java, systems reliability, and data security.",
    "salesforce": "Salesforce values CRM systems, multi-tenant cloud architectures, API-first integrations, enterprise SaaS scalability, and business logic automation."
}

COMPANY_COMPARE_PROMPT = """You are an expert technical interviewer and recruiter for {company_name}.
{company_culture}

Evaluate the candidate's resume text against the typical engineering and cultural requirements of {company_name}.
RESUME TEXT:
{resume_text}

Return ONLY valid JSON in this exact structure:
{{
  "match_score": <integer 0-100>,
  "missing_skills": ["string", "string", "string"],
  "missing_keywords": ["string", "string"],
  "projects_to_build": [
    {{
      "title": "string (innovative project idea)",
      "description": "string (specific guidelines on tech stack, features, and scale needed to impress {company_name} recruiters)"
    }},
    {{
      "title": "string",
      "description": "string"
    }}
  ],
  "certifications": ["string", "string"],
  "interview_prep": ["string", "string", "string"],
  "summary": "2-sentence overall assessment of their alignment with {company_name}"
}}

Scoring guide:
- 85-100: Top tier match, highly likely to pass screening.
- 70-84: Strong fit with clear skill match, some gaps.
- 50-69: Average fit, needs specific project/certification boost.
- 30-49: Weak fit, missing core platform requirements.
- 0-29: Poor fit.

Return ONLY raw JSON. No markdown, no preamble."""

@app.route("/api/company/compare", methods=["POST"])
def company_compare():
    if "resume" not in request.files:
        return jsonify({"error": "No resume uploaded"}), 400
    company = request.form.get("company", "").strip().lower()
    user_id = request.form.get("user_id")

    if company not in COMPANY_PROFILES:
        return jsonify({"error": "Invalid or unsupported company selected"}), 400

    file = request.files["resume"]
    validation_error = valid_pdf_upload(file)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    try:
        pdf_bytes = file.read()
        resume_text = extract_text_from_pdf(pdf_bytes)
        if len(resume_text) < 100:
            return jsonify({"error": "Could not extract text from PDF."}), 400

        culture = COMPANY_PROFILES[company]
        prompt = COMPANY_COMPARE_PROMPT.format(
            company_name=company.capitalize(),
            company_culture=culture,
            resume_text=resume_text[:3500]
        )

        response = client.chat.completions.create(
            model=get_best_model(),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
            temperature=0.2,
        )

        raw = response.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        result = json.loads(raw)

        # Save analysis (without raw_text for privacy)
        analysis_id = uid()
        conn = get_db()
        conn.execute(
            "INSERT INTO analyses (id, user_id, type, filename, ats_score, verdict, result_json) VALUES (?,?,?,?,?,?,?)",
            (analysis_id, user_id, "company_compare", f"{file.filename} vs {company.capitalize()}",
             result.get("match_score"), result.get("summary")[:100], json.dumps(result))
        )
        conn.commit()
        conn.close()

        track("company_compare", user_id, {"company": company, "score": result.get("match_score")})

        return jsonify({
            "success": True,
            "analysis_id": analysis_id,
            "company": company.capitalize(),
            **result
        })

    except Exception as e:
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── Interview Prep Questions ─────────────────────────────────────────────────

INTERVIEW_PROMPT = """You are an expert technical and behavioral interviewer. Generate a list of 5 tailored interview questions based on the candidate's resume and target role.
RESUME:
{resume_text}
ROLE: {role}
{company_context}

Return ONLY valid JSON in this exact structure:
{{
  "questions": [
    {{
      "id": "q1",
      "type": "technical|behavioral|resume",
      "question": "string",
      "difficulty": "easy|medium|hard",
      "round": "string (e.g. Round 1: Phone Screening, Round 2: Technical Deep-Dive, Round 3: System Design)",
      "rubric": "string (what to say, key buzzwords/frameworks to include in answer)"
    }},
    ...
  ]
}}

Return ONLY raw JSON. No markdown, no preamble."""

@app.route("/api/interview/generate", methods=["POST"])
def interview_generate():
    if "resume" not in request.files:
        return jsonify({"error": "No resume uploaded"}), 400
    role = request.form.get("role", "Software Engineer").strip()
    company = request.form.get("company", "").strip()
    user_id = request.form.get("user_id")

    file = request.files["resume"]
    validation_error = valid_pdf_upload(file)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    try:
        pdf_bytes = file.read()
        resume_text = extract_text_from_pdf(pdf_bytes)
        if len(resume_text) < 100:
            return jsonify({"error": "Could not extract text from PDF."}), 400

        company_context = f"COMPANY: {company}" if company else ""
        prompt = INTERVIEW_PROMPT.format(
            resume_text=resume_text[:3500],
            role=role,
            company_context=company_context
        )

        response = client.chat.completions.create(
            model=get_best_model(),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
            temperature=0.5,
        )

        raw = response.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        result = json.loads(raw)

        # Save analysis (without raw_text for privacy)
        analysis_id = uid()
        conn = get_db()
        conn.execute(
            "INSERT INTO analyses (id, user_id, type, filename, ats_score, verdict, result_json) VALUES (?,?,?,?,?,?,?)",
            (analysis_id, user_id, "interview_prep", f"{file.filename} - {role} Prep",
             85, "Ready", json.dumps(result))
        )
        conn.commit()
        conn.close()

        track("interview_generated", user_id, {"role": role, "company": company})

        return jsonify({
            "success": True,
            "analysis_id": analysis_id,
            **result
        })

    except Exception as e:
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── AI Cover Letter Generator ──────────────────────────────────────────────────

COVER_LETTER_PROMPT = """You are an expert career coach and copywriter. Generate a professional, compelling, and tailored cover letter based on the candidate's resume and job description/role.
RESUME:
{resume_text}
JOB DESCRIPTION / TARGET ROLE:
{jd_text}

Format the cover letter professionally with standard placeholder fields for date, contact information, and signature.
Write in a confident, professional, and matching tone.
Return the cover letter text directly."""

@app.route("/api/cover-letter/generate", methods=["POST"])
def cover_letter_generate():
    if "resume" not in request.files:
        return jsonify({"error": "No resume uploaded"}), 400
    jd_text = request.form.get("jd_text", "").strip()
    user_id = request.form.get("user_id")

    file = request.files["resume"]
    validation_error = valid_pdf_upload(file)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    try:
        pdf_bytes = file.read()
        resume_text = extract_text_from_pdf(pdf_bytes)
        if len(resume_text) < 100:
            return jsonify({"error": "Could not extract text from PDF."}), 400

        prompt = COVER_LETTER_PROMPT.format(
            resume_text=resume_text[:3500],
            jd_text=jd_text[:2000]
        )

        response = client.chat.completions.create(
            model=get_best_model(),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
            temperature=0.7,
        )
        cl_text = response.choices[0].message.content.strip()

        # Save analysis (without raw_text for privacy)
        analysis_id = uid()
        conn = get_db()
        conn.execute(
            "INSERT INTO analyses (id, user_id, type, filename, ats_score, verdict, result_json) VALUES (?,?,?,?,?,?,?)",
            (analysis_id, user_id, "rewrite", f"{file.filename} - Cover Letter",
             85, "Ready", json.dumps({"cover_letter": cl_text}))
        )
        conn.commit()
        conn.close()

        track("cover_letter_generated", user_id)

        return jsonify({
            "success": True,
            "analysis_id": analysis_id,
            "cover_letter": cl_text
        })
    except Exception as e:
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── AI Resume Timeline / Roadmap ──────────────────────────────────────────────

TIMELINE_PROMPT = """You are an expert career strategist. Create a highly customized, weekly roadmap (4 weeks) for the candidate to achieve interview readiness based on their resume.
RESUME:
{resume_text}

Return ONLY valid JSON in this exact structure:
{{
  "overall_readiness": <integer 0-100>,
  "estimated_ready_score": <integer 0-100>,
  "weeks": [
    {{
      "week": 1,
      "focus": "string (main theme for this week)",
      "items": [
        {{
          "title": "string (specific action item title)",
          "description": "string (detailed execution guide)",
          "difficulty": "Easy|Medium|Hard"
        }}
      ]
    }}
  ]
}}

Provide exactly 4 weeks, with 2-3 specific action items per week. Return ONLY raw JSON. No markdown, no preamble."""

@app.route("/api/resume/timeline", methods=["POST"])
def resume_timeline():
    data = request.get_json(silent=True) or {}
    resume_text = data.get("resume_text", "").strip()
    if not resume_text:
        return jsonify({"error": "resume_text is required"}), 400

    try:
        prompt = TIMELINE_PROMPT.format(resume_text=resume_text[:3500])
        response = client.chat.completions.create(
            model=get_best_model(),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
            temperature=0.3,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        result = json.loads(raw)
        return jsonify({"success": True, "timeline": result})
    except Exception as e:
        message, status = public_error(e)
        return jsonify({"error": message}), status


# ── Referral Code Validation ──────────────────────────────────────────────────

@app.route("/api/referrals/claim", methods=["POST"])
def referrals_claim():
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    ref_code = data.get("referral_code", "").strip()

    if not user_id or not ref_code:
        return jsonify({"error": "user_id and referral_code are required"}), 400

    if user_id == ref_code:
        return jsonify({"error": "You cannot refer yourself!"}), 400

    conn = get_db()
    try:
        # Verify referrer exists
        referrer = conn.execute("SELECT id FROM users WHERE id=?", (ref_code,)).fetchone()
        if not referrer:
            referrer = conn.execute("SELECT id FROM email_captures WHERE id=?", (ref_code,)).fetchone()

        if not referrer:
            conn.close()
            return jsonify({"error": "Invalid referral code."}), 400

        # Grant 3 bonus credits to user
        conn.execute("UPDATE users SET credits = credits + 3 WHERE id=?", (user_id,))
        # Grant 3 bonus credits to referrer
        conn.execute("UPDATE users SET credits = credits + 3 WHERE id=?", (ref_code,))
        conn.commit()
        conn.close()

        track("referral_claimed", user_id, {"referrer_id": ref_code})
        return jsonify({"success": True, "bonus_credits": 3})
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500


# ── Health ────────────────────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def root_health():
    return jsonify({"status": "ok", "version": "2.0.0"})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "version": "2.0.0"})


@app.route("/api/debug-groq", methods=["GET"])
def debug_groq():
    groq_key = os.environ.get("GROQ_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    key_preview = f"{groq_key[:6]}...{groq_key[-4:]}" if len(groq_key) > 10 else ("EMPTY" if not groq_key else f"short_len_{len(groq_key)}")
    
    status_info = {
        "groq_api_key_present": bool(groq_key),
        "groq_key_preview": key_preview,
        "gemini_api_key_present": bool(gemini_key),
    }
    
    if not groq_key:
        return jsonify({
            "status": "error",
            "message": "GROQ_API_KEY is missing from Render environment variables! Please add it in Render dashboard.",
            **status_info
        }), 500
        
    try:
        from groq import Groq
        c = Groq(api_key=groq_key)
        res = c.chat.completions.create(
            model=get_best_model(),
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        return jsonify({
            "status": "success",
            "message": "Groq LLM is working properly!",
            "reply": res.choices[0].message.content,
            **status_info
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "error_type": type(e).__name__,
            "error_message": str(e),
            **status_info
        }), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
