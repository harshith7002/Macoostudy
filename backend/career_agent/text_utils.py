"""Shared text helpers: normalisation, span lookup, skill lexicon, similarity."""
import difflib
import hashlib
import re

# Skill lexicon -> competency. Matching is case-insensitive on word boundaries.
SKILL_COMPETENCY = {
    # backend
    "python": "backend_engineering", "java": "backend_engineering", "go": "backend_engineering",
    "golang": "backend_engineering", "node.js": "backend_engineering", "nodejs": "backend_engineering",
    "express": "backend_engineering", "flask": "backend_engineering", "django": "backend_engineering",
    "fastapi": "backend_engineering", "spring": "backend_engineering", "spring boot": "backend_engineering",
    "rest": "backend_engineering", "rest api": "backend_engineering", "graphql": "backend_engineering",
    "grpc": "backend_engineering", "microservices": "backend_engineering", "kafka": "backend_engineering",
    "rabbitmq": "backend_engineering", "celery": "backend_engineering", "websocket": "backend_engineering",
    "websockets": "backend_engineering", "oauth": "backend_engineering", "jwt": "backend_engineering",
    "c++": "backend_engineering", "rust": "backend_engineering", "c#": "backend_engineering",
    ".net": "backend_engineering", "php": "backend_engineering", "ruby": "backend_engineering",
    "api": "backend_engineering", "razorpay": "backend_engineering",
    "stripe": "backend_engineering", "gunicorn": "backend_engineering", "webhook": "backend_engineering",
    "caching": "databases",
    # frontend
    "react": "frontend_engineering", "react.js": "frontend_engineering", "reactjs": "frontend_engineering",
    "next.js": "frontend_engineering", "nextjs": "frontend_engineering", "vue": "frontend_engineering",
    "angular": "frontend_engineering", "javascript": "frontend_engineering", "typescript": "frontend_engineering",
    "html": "frontend_engineering", "css": "frontend_engineering", "tailwind": "frontend_engineering",
    "redux": "frontend_engineering", "svelte": "frontend_engineering", "figma": "frontend_engineering",
    "jspdf": "frontend_engineering", "framer motion": "frontend_engineering",
    # data / ml
    "machine learning": "data_ml", "deep learning": "data_ml", "pytorch": "data_ml", "tensorflow": "data_ml",
    "keras": "data_ml", "scikit-learn": "data_ml", "sklearn": "data_ml", "pandas": "data_ml", "numpy": "data_ml",
    "nlp": "data_ml", "llm": "data_ml", "llms": "data_ml", "rag": "data_ml", "langchain": "data_ml",
    "computer vision": "data_ml", "opencv": "data_ml", "spark": "data_ml", "pyspark": "data_ml",
    "airflow": "data_ml", "hugging face": "data_ml", "transformers": "data_ml", "xgboost": "data_ml",
    "llama": "data_ml", "groq": "data_ml", "openai": "data_ml", "embeddings": "data_ml",
    "data analysis": "data_ml", "tableau": "data_ml", "power bi": "data_ml", "matplotlib": "data_ml",
    # databases
    "sql": "databases", "postgresql": "databases", "postgres": "databases", "mysql": "databases",
    "sqlite": "databases", "mongodb": "databases", "redis": "databases", "elasticsearch": "databases",
    "supabase": "databases", "firebase": "databases", "dynamodb": "databases", "cassandra": "databases",
    "vector database": "databases", "faiss": "databases", "pinecone": "databases",
    # devops / cloud
    "docker": "devops_cloud", "kubernetes": "devops_cloud", "k8s": "devops_cloud", "aws": "devops_cloud",
    "gcp": "devops_cloud", "azure": "devops_cloud", "terraform": "devops_cloud", "ci/cd": "devops_cloud",
    "github actions": "devops_cloud", "jenkins": "devops_cloud", "linux": "devops_cloud", "nginx": "devops_cloud",
    "vercel": "devops_cloud", "render": "devops_cloud", "netlify": "devops_cloud", "heroku": "devops_cloud",
    "ec2": "devops_cloud", "s3": "devops_cloud", "lambda": "devops_cloud", "git": "devops_cloud",
    # mobile
    "android": "mobile", "kotlin": "mobile", "swift": "mobile", "ios": "mobile", "flutter": "mobile",
    "react native": "mobile",
}

LEADERSHIP_VERBS = ("led", "managed", "mentored", "coordinated", "organized", "organised", "headed", "spearheaded")
ACTION_VERBS = (
    "built", "developed", "designed", "implemented", "created", "engineered", "architected", "deployed",
    "optimized", "optimised", "improved", "reduced", "increased", "automated", "integrated", "migrated",
    "launched", "shipped", "trained", "wrote", "refactored", "scaled", "led", "managed", "mentored",
    "analyzed", "analysed", "researched", "established", "delivered", "maintained", "contributed",
)

_SKILL_PATTERNS = sorted(SKILL_COMPETENCY.keys(), key=len, reverse=True)
# Skills that are also ordinary English words only count in their proper-noun / acronym form.
_CASE_SENSITIVE = {"render": "Render", "go": "Go", "spark": "Spark", "rest": "REST", "lambda": "Lambda",
                   "swift": "Swift", "express": "Express", "spring": "Spring", "git": "Git", "api": "API"}


def normalize_ws(text):
    return re.sub(r"\s+", " ", text or "").strip()


def stable_id(prefix, *parts):
    digest = hashlib.sha1("||".join(normalize_ws(p).lower() for p in parts).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:10]}"


def find_skills(text):
    """Return lexicon skills mentioned in text, longest match first, de-duplicated."""
    found = []
    lowered = (text or "").lower()
    for skill in _SKILL_PATTERNS:
        pattern = r"(?<![\w.+#-])" + re.escape(skill) + r"s?(?![\w+#])"
        if skill in _CASE_SENSITIVE:
            hit = re.search(r"(?<![\w.+#-])" + re.escape(_CASE_SENSITIVE[skill]) + r"s?(?![\w+#])", text or "")
        else:
            hit = re.search(pattern, lowered)
        if hit:
            # Skip sub-matches of an already found longer skill ("react" inside "react native")
            if any(skill != f and skill in f for f in found):
                continue
            found.append(skill)
    return found


def find_span(haystack, needle):
    """Locate needle in haystack, tolerating whitespace/case differences.

    Returns (start, end) offsets into haystack or None. Used to guarantee that
    claims and evidence quotes are real substrings of what was actually written.
    """
    if not needle or not haystack:
        return None
    idx = haystack.find(needle)
    if idx >= 0:
        return idx, idx + len(needle)
    words = [re.escape(w) for w in normalize_ws(needle).split(" ") if w]
    if not words:
        return None
    match = re.search(r"\s+".join(words), haystack, flags=re.IGNORECASE)
    if match:
        return match.start(), match.end()
    return None


def split_sentences(text):
    parts = re.split(r"(?<=[.!?])\s+|\n+", text or "")
    return [p.strip() for p in parts if p and p.strip()]


def similarity(a, b):
    return difflib.SequenceMatcher(None, normalize_ws(a).lower(), normalize_ws(b).lower()).ratio()


def is_repeat(question, previous_questions, threshold=0.82):
    return any(similarity(question, prev) >= threshold for prev in previous_questions)


def truncate(text, limit):
    text = normalize_ws(text)
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
