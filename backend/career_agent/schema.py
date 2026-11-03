"""Career Agent tables. Plain TEXT/INTEGER/REAL so the same DDL runs on SQLite and Postgres.

Keep in sync with backend/supabase_schema.sql.
"""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS assessments (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    filename           TEXT,
    target_role        TEXT,
    experience_level   TEXT,
    jd_text            TEXT,
    resume_text        TEXT NOT NULL,
    resume_lines_json  TEXT,
    jd_json            TEXT,
    status             TEXT NOT NULL DEFAULT 'ready',
    provider_json      TEXT,
    provider_log_json  TEXT,
    readiness_score    REAL,
    report_json        TEXT,
    created_at         TEXT DEFAULT (datetime('now')),
    updated_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments (user_id, created_at);

CREATE TABLE IF NOT EXISTS resume_claims (
    id              TEXT PRIMARY KEY,
    assessment_id   TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    claim_key       TEXT NOT NULL,
    order_idx       INTEGER NOT NULL,
    source_text     TEXT NOT NULL,
    summary         TEXT,
    start_offset    INTEGER,
    end_offset      INTEGER,
    line_index      INTEGER,
    section         TEXT,
    skills_json     TEXT,
    competency      TEXT,
    relevance       INTEGER DEFAULT 0,
    interviewed     INTEGER DEFAULT 0,
    status          TEXT,
    score           REAL,
    explanation     TEXT,
    recommendation  TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_assessment ON resume_claims (assessment_id);

CREATE TABLE IF NOT EXISTS interview_sessions (
    id                   TEXT PRIMARY KEY,
    assessment_id        TEXT NOT NULL UNIQUE,
    user_id              TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'active',
    claim_order_json     TEXT NOT NULL,
    current_claim_idx    INTEGER NOT NULL DEFAULT 0,
    max_per_claim        INTEGER NOT NULL DEFAULT 3,
    pending_question_id  TEXT,
    started_at           TEXT DEFAULT (datetime('now')),
    ended_at             TEXT,
    updated_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interview_messages (
    id             TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL,
    assessment_id  TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    claim_key      TEXT,
    role           TEXT NOT NULL,
    content        TEXT NOT NULL,
    criterion_id   TEXT,
    seq            INTEGER NOT NULL,
    reply_to       TEXT,
    provider       TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_assessment ON interview_messages (assessment_id, seq);

CREATE TABLE IF NOT EXISTS evidence_records (
    id                  TEXT PRIMARY KEY,
    assessment_id       TEXT NOT NULL,
    user_id             TEXT NOT NULL,
    claim_key           TEXT NOT NULL,
    message_id          TEXT NOT NULL,
    quote               TEXT NOT NULL,
    start_offset        INTEGER,
    end_offset          INTEGER,
    criterion_ids_json  TEXT,
    signal              TEXT,
    note                TEXT,
    created_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_assessment ON evidence_records (assessment_id);

CREATE TABLE IF NOT EXISTS rubric_results (
    id                 TEXT PRIMARY KEY,
    assessment_id      TEXT NOT NULL,
    user_id            TEXT NOT NULL,
    claim_key          TEXT NOT NULL,
    competency         TEXT,
    criterion_id       TEXT NOT NULL,
    criterion_name     TEXT,
    description        TEXT,
    label              TEXT NOT NULL,
    points_possible    REAL NOT NULL,
    points_awarded     REAL NOT NULL,
    evidence_ids_json  TEXT,
    rationale          TEXT,
    gap_type           TEXT
);
CREATE INDEX IF NOT EXISTS idx_rubric_assessment ON rubric_results (assessment_id);

CREATE TABLE IF NOT EXISTS remediation_tasks (
    id             TEXT PRIMARY KEY,
    assessment_id  TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    claim_key      TEXT,
    criterion_id   TEXT,
    gap_type       TEXT,
    title          TEXT,
    task_json      TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'todo',
    created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_remediation_assessment ON remediation_tasks (assessment_id);
"""
