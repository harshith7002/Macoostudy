import React, { useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { validatePdf } from "../utils/api";
import { agentApi } from "./agentApi";
import { AgentShell, EmptyState, ErrorState, Loading, StatusPill } from "./components";
import { AnalysisPage, HeatmapPage, InterviewPage, RemediationPage, ReportPage } from "./AssessmentPages";
import "./agent.css";

export default function CareerAgent() {
  return (
    <Routes>
      <Route index element={<Landing />} />
      <Route path="dashboard" element={<AgentDashboard />} />
      <Route path="new" element={<NewAssessment />} />
      <Route path="a/:id" element={<AnalysisPage />} />
      <Route path="a/:id/interview" element={<InterviewPage />} />
      <Route path="a/:id/heatmap" element={<HeatmapPage />} />
      <Route path="a/:id/report" element={<ReportPage />} />
      <Route path="a/:id/remediation" element={<RemediationPage />} />
      <Route path="*" element={<AgentShell><EmptyState title="Page not found" action={<Link className="ca-btn" to="/agent">Back to Career Agent</Link>}>That Career Agent page doesn't exist.</EmptyState></AgentShell>} />
    </Routes>
  );
}

const PIPELINE = [
  ["Claim", "Each resume bullet becomes a claim with a stable ID, its exact location and linked skills."],
  ["Question", "The interviewer targets one rubric criterion of one claim: implementation, trade-offs, failure modes."],
  ["Answer", "You answer in your own words. Follow-ups build on what you actually said, never repeating a question."],
  ["Evidence", "Excerpts are quoted verbatim from your answers and mapped to criteria. Nothing is invented."],
  ["Rubric", "The model only labels criteria demonstrated / partial / not shown. The backend computes every point."],
  ["Status", "Claims end as Supported, Partially supported or Insufficient evidence. It measures explanation, not honesty."],
  ["Remediation", "Each gap gets an exercise, a scenario, solution criteria and a follow-up question to practise."],
];

function Landing() {
  return (
    <AgentShell>
      <section className="ca-hero">
        <span className="ca-eyebrow">Macoostudy Career Agent · Technical skill auditor</span>
        <h1>Don't just claim the skill. <span>Prove you can defend it.</span></h1>
        <p className="ca-lead">
          Upload your resume and the job you want. The agent pulls out every concrete claim, interviews you on the ones
          that matter for the role, and shows exactly which claims your answers support, with the evidence behind each verdict.
        </p>
        <div className="ca-hero-cta">
          <Link to="/agent/new" className="ca-btn ca-btn-lg">Start Assessment</Link>
          <Link to="/agent/dashboard" className="ca-btn ca-btn-ghost ca-btn-lg">Your assessments</Link>
        </div>
      </section>

      <section className="ca-section">
        <h2>The Claim-to-Evidence Engine</h2>
        <p className="ca-muted">Every verdict is traceable back to a resume line and to the words you used in the interview.</p>
        <ol className="ca-pipeline">
          {PIPELINE.map(([title, body], i) => (
            <li key={title}>
              <span className="ca-step">{i + 1}</span>
              <div><strong>{title}</strong><p>{body}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="ca-section ca-grid-3">
        <div className="ca-card">
          <h3>Resume heatmap</h3>
          <p>Your resume text with every extracted claim highlighted green, amber or red. Click a claim to see the questions, your answers and the rubric.</p>
        </div>
        <div className="ca-card">
          <h3>Gaps, separated</h3>
          <p>Knowledge gaps, weak articulation and insufficient evidence need different fixes, so they're reported separately.</p>
        </div>
        <div className="ca-card">
          <h3>Deterministic scoring</h3>
          <p>Same labels, same score. Points per criterion are fixed in the rubric and computed by the backend, not by the model.</p>
        </div>
      </section>
    </AgentShell>
  );
}

function AgentDashboard() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    agentApi.list().then(d => setItems(d.assessments)).catch(e => setError(e.message));
  };
  useEffect(load, []);

  return (
    <AgentShell>
      <div className="ca-head-row">
        <div>
          <h1 className="ca-h1">Assessments</h1>
          <p className="ca-muted">Your past skill audits. Stored per account (or per browser for guests).</p>
        </div>
        <Link to="/agent/new" className="ca-btn">New assessment</Link>
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && !items && <Loading label="Loading assessments…" />}
      {items && items.length === 0 && (
        <EmptyState title="No assessments yet" action={<Link to="/agent/new" className="ca-btn">Start Assessment</Link>}>
          Run your first audit to see which resume claims you can defend.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <div className="ca-list">
          {items.map(a => {
            const done = a.status === "completed";
            const to = done ? `/agent/a/${a.id}/report` : a.status === "interviewing" ? `/agent/a/${a.id}/interview` : `/agent/a/${a.id}`;
            return (
              <Link key={a.id} to={to} className="ca-list-item">
                <div className="ca-li-main">
                  <strong>{a.target_role || "Untitled role"}</strong>
                  <span className="ca-muted">{a.filename} · {String(a.created_at || "").slice(0, 16)} · {a.provider?.label || "unknown provider"}</span>
                </div>
                <div className="ca-li-side">
                  {done ? (
                    <>
                      <span className="ca-li-score">{Math.round(a.readiness_score || 0)}</span>
                      <span className="ca-counts">
                        {Object.entries(a.status_counts).map(([s, n]) => (
                          <span key={s} className="ca-count">{n} <StatusPill status={s} small /></span>
                        ))}
                      </span>
                    </>
                  ) : (
                    <span className="ca-pill ca-pill-none">{a.status === "interviewing" ? "Interview in progress" : `${a.claim_count} claims · not interviewed`}</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </AgentShell>
  );
}

const LEVELS = [["", "Not specified"], ["intern", "Intern"], ["entry", "Entry level"], ["mid", "Mid level"], ["senior", "Senior"], ["staff", "Staff+"]];

function NewAssessment() {
  const nav = useNavigate();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [jd, setJd] = useState("");
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const pick = (f) => {
    const err = validatePdf(f);
    setErrors(e => ({ ...e, file: err }));
    setFile(err ? null : f);
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {
      file: validatePdf(file),
      role: role.trim() ? "" : "Enter the role you're targeting.",
      jd: jd.trim().length >= 40 ? "" : "Paste the job description (at least a few sentences).",
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    const form = new FormData();
    form.append("resume", file);
    form.append("target_role", role.trim());
    form.append("experience_level", level);
    form.append("job_description", jd.trim());
    setBusy(true);
    setSubmitError("");
    try {
      const a = await agentApi.create(form);
      nav(`/agent/a/${a.id}`);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AgentShell>
      <h1 className="ca-h1">New assessment</h1>
      <p className="ca-muted">Your resume is parsed on the server; claims are extracted and stored with your assessment.</p>
      <form className="ca-form" onSubmit={submit} noValidate>
        <div
          className={`ca-drop${drag ? " drag" : ""}${errors.file ? " invalid" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          aria-label="Choose resume PDF"
        >
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files[0])} />
          {file ? (
            <><strong>{file.name}</strong><span className="ca-muted">{(file.size / 1024).toFixed(0)} KB · click to replace</span></>
          ) : (
            <><strong>Drop your resume PDF here</strong><span className="ca-muted">or click to browse · max 10 MB · text-based PDFs only</span></>
          )}
        </div>
        {errors.file && <p className="ca-field-err">{errors.file}</p>}

        <div className="ca-row-2">
          <label className="ca-field">
            <span>Target role</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Backend Engineer" maxLength={120} aria-invalid={!!errors.role} />
            {errors.role && <span className="ca-field-err">{errors.role}</span>}
          </label>
          <label className="ca-field">
            <span>Experience level <em>(optional)</em></span>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <label className="ca-field">
          <span>Job description</span>
          <textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={9} maxLength={20000}
                    placeholder="Paste the full job description. Skills it mentions decide which claims are probed first." aria-invalid={!!errors.jd} />
          <span className="ca-hint">{jd.length.toLocaleString()} / 20,000</span>
          {errors.jd && <span className="ca-field-err">{errors.jd}</span>}
        </label>

        {submitError && <ErrorState message={submitError} />}
        <div className="ca-actions">
          <button className="ca-btn ca-btn-lg" disabled={busy}>
            {busy ? <><span className="ca-spinner sm" aria-hidden="true" /> Extracting claims…</> : "Analyse resume"}
          </button>
        </div>
      </form>
    </AgentShell>
  );
}
