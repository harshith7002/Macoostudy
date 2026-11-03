-- ── Macoostudy 2.0 Supabase Schema ──

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Profiles Table (Synced from auth.users)
create table public.profiles (
    id uuid references auth.users on delete cascade primary key,
    email text unique not null,
    full_name text,
    avatar_url text,
    credits integer default 5, -- 5 free starter credits
    tier text default 'free' check (tier in ('free', 'pro', 'pro_plus')),
    created_at timestamp with time zone default timezone('utc'::text, now()),
    last_active_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable RLS on Profiles
alter table public.profiles enable row level security;

create policy "Allow public read access to profiles"
    on public.profiles for select
    using (true);

create policy "Allow users to update their own profile"
    on public.profiles for update
    using (auth.uid() = id);

-- Trigger to automatically create a profile when a new user signs up in auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email, full_name, avatar_url, credits, tier)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'User'),
        new.raw_user_meta_data->>'avatar_url',
        5,
        'free'
    );
    return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();


-- 2. Analyses Table (Resume Roast, JD Matches, Company Compare)
-- NO raw_text or PDF files are stored in the database.
create table public.analyses (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references public.profiles(id) on delete set null,
    filename text not null,
    type text not null check (type in ('roast', 'jd_match', 'company_compare', 'rewrite', 'interview_prep')),
    ats_score integer,
    verdict text,
    result_json jsonb not null,
    created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable RLS on Analyses
alter table public.analyses enable row level security;

create policy "Allow users to read their own analyses"
    on public.analyses for select
    using (auth.uid() = user_id);

create policy "Allow users to insert their own analyses"
    on public.analyses for insert
    with check (auth.uid() = user_id);

create policy "Allow users to delete their own analyses"
    on public.analyses for delete
    using (auth.uid() = user_id);


-- 3. Resume Chat Messages Table (AI Chat sessions)
create table public.chat_messages (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references public.profiles(id) on delete cascade,
    analysis_id uuid references public.analyses(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable RLS on Chat Messages
alter table public.chat_messages enable row level security;

create policy "Allow users to read their own chat messages"
    on public.chat_messages for select
    using (auth.uid() = user_id);

create policy "Allow users to insert their own chat messages"
    on public.chat_messages for insert
    with check (auth.uid() = user_id);


-- 4. Transactions Table (Razorpay billing tracking)
create table public.transactions (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references public.profiles(id) on delete cascade,
    razorpay_order_id text unique not null,
    razorpay_payment_id text,
    amount integer not null, -- in paise
    status text not null check (status in ('created', 'paid', 'failed')),
    tier_purchased text not null check (tier_purchased in ('pro', 'pro_plus')),
    created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable RLS on Transactions
alter table public.transactions enable row level security;

create policy "Allow users to view their own transactions"
    on public.transactions for select
    using (auth.uid() = user_id);


-- 5. Career Agent (Claim-to-Evidence Engine)
-- The Flask backend also creates these with CREATE TABLE IF NOT EXISTS on startup (career_agent/schema.py),
-- so this block is for reference / manual setup. user_id is TEXT because guest assessments use a
-- browser-generated visitor id; signed-in users use their Supabase auth uid.
-- The backend connects with DATABASE_URL (table owner), which bypasses RLS; the policies below only
-- matter for direct Supabase client access, which is read-only and limited to the user's own rows.
CREATE TABLE IF NOT EXISTS public.assessments (
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
    created_at         TEXT DEFAULT (CURRENT_TIMESTAMP),
    updated_at         TEXT DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_assessments_user ON public.assessments (user_id, created_at);

CREATE TABLE IF NOT EXISTS public.resume_claims (
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
CREATE INDEX IF NOT EXISTS idx_claims_assessment ON public.resume_claims (assessment_id);

CREATE TABLE IF NOT EXISTS public.interview_sessions (
    id                   TEXT PRIMARY KEY,
    assessment_id        TEXT NOT NULL UNIQUE,
    user_id              TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'active',
    claim_order_json     TEXT NOT NULL,
    current_claim_idx    INTEGER NOT NULL DEFAULT 0,
    max_per_claim        INTEGER NOT NULL DEFAULT 3,
    pending_question_id  TEXT,
    started_at           TEXT DEFAULT (CURRENT_TIMESTAMP),
    ended_at             TEXT,
    updated_at           TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS public.interview_messages (
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
    created_at     TEXT DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_messages_assessment ON public.interview_messages (assessment_id, seq);

CREATE TABLE IF NOT EXISTS public.evidence_records (
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
    created_at          TEXT DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_evidence_assessment ON public.evidence_records (assessment_id);

CREATE TABLE IF NOT EXISTS public.rubric_results (
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
CREATE INDEX IF NOT EXISTS idx_rubric_assessment ON public.rubric_results (assessment_id);

CREATE TABLE IF NOT EXISTS public.remediation_tasks (
    id             TEXT PRIMARY KEY,
    assessment_id  TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    claim_key      TEXT,
    criterion_id   TEXT,
    gap_type       TEXT,
    title          TEXT,
    task_json      TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'todo',
    created_at     TEXT DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_remediation_assessment ON public.remediation_tasks (assessment_id);

alter table public.assessments enable row level security;
create policy "Users read own assessments" on public.assessments for select using (auth.uid()::text = user_id);
alter table public.resume_claims enable row level security;
create policy "Users read own resume_claims" on public.resume_claims for select using (auth.uid()::text = user_id);
alter table public.interview_sessions enable row level security;
create policy "Users read own interview_sessions" on public.interview_sessions for select using (auth.uid()::text = user_id);
alter table public.interview_messages enable row level security;
create policy "Users read own interview_messages" on public.interview_messages for select using (auth.uid()::text = user_id);
alter table public.evidence_records enable row level security;
create policy "Users read own evidence_records" on public.evidence_records for select using (auth.uid()::text = user_id);
alter table public.rubric_results enable row level security;
create policy "Users read own rubric_results" on public.rubric_results for select using (auth.uid()::text = user_id);
alter table public.remediation_tasks enable row level security;
create policy "Users read own remediation_tasks" on public.remediation_tasks for select using (auth.uid()::text = user_id);
