import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { validatePdf } from "../utils/api";
import { agentApi } from "./agentApi";
import { AgentShell, PageHead } from "./Shell";
import { Alert, Icon, Progress, Spinner, useToast } from "./ui";

export const STEPS = ["Upload resume", "Add job description", "Review extracted claims", "Start technical assessment"];

export function Stepper({ current }) {
  return (
    <ol className="ca-steps" aria-label="Assessment steps">
      {STEPS.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "";
        return (
          <li key={s} className={state} aria-current={i === current ? "step" : undefined}>
            <span className="ca-steps__n">{i < current ? <Icon name="check" size={12} /> : i + 1}</span>
            <span className="ca-steps__t">{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

const LEVELS = [["", "Not specified"], ["intern", "Intern"], ["entry", "Entry level"], ["mid", "Mid level"], ["senior", "Senior"], ["staff", "Staff+"]];
const MIN_JD = 40;

export default function NewAssessment() {
  const nav = useNavigate();
  const toast = useToast();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [jd, setJd] = useState("");
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [progress, setProgress] = useState(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!file) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (f) => {
    if (!f) return;
    const err = validatePdf(f);
    setErrors(e => ({ ...e, file: err }));
    setFile(err ? null : f);
    if (!err) setSubmitError("");
  };

  const jdOk = jd.trim().length >= MIN_JD;
  const step = !file ? 0 : (!jdOk || !role.trim()) ? 1 : 2;
  const busy = !!progress;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const next = {
      file: validatePdf(file),
      role: role.trim() ? "" : "Enter the role you're targeting.",
      jd: jdOk ? "" : `Paste the job description (at least ${MIN_JD} characters) so claims can be matched to its requirements.`,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      document.querySelector("[aria-invalid='true'], .ca-drop.is-invalid")?.focus();
      return;
    }
    const form = new FormData();
    form.append("resume", file);
    form.append("target_role", role.trim());
    form.append("experience_level", level);
    form.append("job_description", jd.trim());
    setSubmitError("");
    setProgress({ phase: "upload", pct: 0 });
    try {
      const a = await agentApi.create(form, setProgress);
      toast(`${a.claims.length} claims extracted from ${file.name}`);
      nav(`/agent/a/${a.id}`);
    } catch (err) {
      setSubmitError(err.message);
      setProgress(null);
    }
  };

  return (
    <AgentShell title="New assessment">
      <Stepper current={step} />
      <PageHead eyebrow="New assessment" title="Set up a technical skill audit"
                subtitle="Add your resume and the job you're applying for. You'll review every extracted claim before the interview starts." />
      <form className="ca-new" onSubmit={submit} noValidate>
        <div className="ca-stack">
          <section className="ca-card" aria-labelledby="s1">
            <div className="ca-card__head"><span className="ca-card__title" id="s1"><span className="ca-steps__n">1</span>Resume</span>
              {file && <button type="button" className="ca-btn ca-btn--ghost ca-btn--sm" onClick={() => setShowPreview(v => !v)} aria-expanded={showPreview}>
                <Icon name="eye" size={14} />{showPreview ? "Hide preview" : "Preview PDF"}</button>}
            </div>
            <div className="ca-card__body ca-stack" style={{ gap: 12 }}>
              <button type="button"
                className={`ca-drop${drag ? " is-drag" : ""}${errors.file ? " is-invalid" : ""}${file ? " is-filled" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
                onClick={() => fileRef.current?.click()} disabled={busy} aria-describedby={errors.file ? "file-err" : undefined}>
                <span className="ca-drop__icon"><Icon name={file ? "file" : "upload"} size={20} /></span>
                <span className="ca-drop__text">
                  <strong>{file ? file.name : "Drop your resume PDF here, or browse"}</strong>
                  <span>{file ? `${(file.size / 1024).toFixed(0)} KB · PDF · click to replace` : "Text-based PDF · max 10 MB · scanned images aren't supported"}</span>
                </span>
              </button>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pick(e.target.files[0])} />
              {errors.file && <p className="ca-errtext" id="file-err"><Icon name="alert" size={14} />{errors.file}</p>}
              {file && showPreview && preview && (
                <>
                  <iframe className="ca-pdf" src={preview} title={`Preview of ${file.name}`} />
                  <p className="ca-help">Preview blank? Your browser may not display PDFs inline. <a className="ca-link" href={preview} target="_blank" rel="noreferrer">Open the PDF in a new tab</a></p>
                </>
              )}
            </div>
          </section>

          <section className="ca-card" aria-labelledby="s2">
            <div className="ca-card__head"><span className="ca-card__title" id="s2"><span className="ca-steps__n">2</span>Target role & job description</span></div>
            <div className="ca-card__body ca-stack">
              <div className="ca-formgrid">
                <div className="ca-field">
                  <label className="ca-label" htmlFor="role">Target role</label>
                  <input id="role" className="ca-input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Backend Engineer"
                         maxLength={120} aria-invalid={!!errors.role} aria-describedby={errors.role ? "role-err" : undefined} disabled={busy} />
                  {errors.role && <p className="ca-errtext" id="role-err"><Icon name="alert" size={14} />{errors.role}</p>}
                </div>
                <div className="ca-field">
                  <label className="ca-label" htmlFor="level">Experience level <em>optional</em></label>
                  <select id="level" className="ca-select" value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy}>
                    {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="ca-field">
                <label className="ca-label" htmlFor="jd">Job description <em>{jd.length.toLocaleString()} / 20,000</em></label>
                <textarea id="jd" className="ca-textarea" rows={10} maxLength={20000} value={jd} onChange={(e) => setJd(e.target.value)} disabled={busy}
                          placeholder="Paste the full posting. Skills it mentions decide which claims are probed first."
                          aria-invalid={!!errors.jd} aria-describedby={errors.jd ? "jd-err" : "jd-help"} />
                {errors.jd ? <p className="ca-errtext" id="jd-err"><Icon name="alert" size={14} />{errors.jd}</p>
                  : <p className="ca-help" id="jd-help">{jdOk ? "Looks good." : `At least ${MIN_JD} characters.`}</p>}
              </div>
            </div>
          </section>
        </div>

        <aside className="ca-stack ca-sticky">
          <div className="ca-card">
            <div className="ca-card__head"><span className="ca-card__title"><Icon name="cpu" />Analyse</span></div>
            <div className="ca-card__body ca-stack">
              {progress ? (
                <div className="ca-upload-status" aria-live="polite">
                  <div className="ca-upload-status__row"><span>Uploading {file?.name}</span><span className="ca-mono">{Math.round(progress.pct)}%</span></div>
                  <Progress value={progress.pct} label="Upload progress" />
                  <ul className="ca-stagelist">
                    <li className={progress.phase === "processing" ? "done" : "active"}>
                      {progress.phase === "processing" ? <Icon name="checkCircle" size={14} /> : <Spinner />}Upload resume
                    </li>
                    <li className={progress.phase === "processing" ? "active" : ""}>
                      {progress.phase === "processing" ? <Spinner /> : <Icon name="circle" size={14} />}
                      Parse PDF, extract claims, match to the job
                    </li>
                  </ul>
                </div>
              ) : (
                <ul className="ca-tips">
                  <li><Icon name="file" />Each concrete bullet (built, designed, reduced…) becomes a claim with its exact location.</li>
                  <li><Icon name="target" />Claims that match the job's skills are interviewed first.</li>
                  <li><Icon name="eye" />You'll review the claims before anything is scored.</li>
                </ul>
              )}
              {submitError && <Alert title="Analysis failed">{submitError}</Alert>}
              <button className="ca-btn ca-btn--primary ca-btn--lg ca-btn--block" disabled={busy}>
                {busy ? <><Spinner />{progress.phase === "processing" ? "Extracting claims…" : "Uploading…"}</> : <>Extract claims<Icon name="arrowRight" /></>}
              </button>
            </div>
          </div>
        </aside>
      </form>
    </AgentShell>
  );
}
