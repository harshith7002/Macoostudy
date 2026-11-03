import React, { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { agentApi, claimStatus, GAP, LABEL, STATUS } from "./agentApi";

export function ProviderBadge({ provider, usage }) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (provider) return;
    agentApi.provider().then(setLive).catch(() => setLive({ error: true }));
  }, [provider]);
  const p = provider || live;
  if (!p) return null;
  if (p.error) return <span className="ca-badge ca-badge-low">Model service unreachable</span>;
  const fallbacks = (usage || []).reduce((n, u) => n + (u.fallbacks || 0), 0);
  const tone = p.is_meta ? "ca-badge-meta" : p.is_llm ? "ca-badge-mid" : "ca-badge-neutral";
  return (
    <span className="ca-provider" title={p.reason || ""}>
      <span className={`ca-badge ${tone}`}>
        <span className="ca-dot" aria-hidden="true" />
        {p.label}
      </span>
      {fallbacks > 0 && (
        <span className="ca-badge ca-badge-mid" title="Some steps fell back to deterministic heuristics after a model error">
          {fallbacks} step{fallbacks === 1 ? "" : "s"} used offline fallback
        </span>
      )}
    </span>
  );
}

export function StatusPill({ status, provisional, small }) {
  if (!status) return <span className={`ca-pill ca-pill-none${small ? " sm" : ""}`}>Not assessed yet</span>;
  const s = STATUS[status];
  return (
    <span className={`ca-pill ca-pill-${s.tone}${small ? " sm" : ""}`}>
      {s.label}{provisional ? " · live" : ""}
    </span>
  );
}

export function LabelPill({ label }) {
  const l = LABEL[label] || LABEL.not_demonstrated;
  return <span className={`ca-pill sm ca-pill-${l.tone}`}>{l.label}</span>;
}

export function GapPill({ gap }) {
  if (!gap) return null;
  return <span className={`ca-gap ca-gap-${gap}`} title={GAP[gap]?.hint}>{GAP[gap]?.label || gap}</span>;
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="ca-state" role="status" aria-live="polite">
      <span className="ca-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="ca-state ca-state-error" role="alert">
      <strong>Something went wrong</strong>
      <span>{message}</span>
      {onRetry && <button className="ca-btn ca-btn-ghost" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="ca-empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function AgentShell({ children, assessment }) {
  const id = assessment?.id;
  return (
    <main className="ca-page">
      <div className="ca-topbar">
        <nav className="ca-tabs" aria-label="Career Agent">
          <NavLink end to="/agent" className="ca-tab">Overview</NavLink>
          <NavLink to="/agent/dashboard" className="ca-tab">Dashboard</NavLink>
          <NavLink to="/agent/new" className="ca-tab">New assessment</NavLink>
          {id && (
            <>
              <span className="ca-tab-sep" aria-hidden="true" />
              <NavLink end to={`/agent/a/${id}`} className="ca-tab">Claims</NavLink>
              {assessment.status !== "completed" && <NavLink to={`/agent/a/${id}/interview`} className="ca-tab">Interview</NavLink>}
              <NavLink to={`/agent/a/${id}/heatmap`} className="ca-tab">Heatmap</NavLink>
              {assessment.status === "completed" && <NavLink to={`/agent/a/${id}/report`} className="ca-tab">Report</NavLink>}
              {assessment.status === "completed" && <NavLink to={`/agent/a/${id}/remediation`} className="ca-tab">Remediation</NavLink>}
            </>
          )}
        </nav>
        <ProviderBadge provider={assessment?.provider} usage={assessment?.provider_usage} />
      </div>
      {children}
    </main>
  );
}

/** Everything known about one claim: questions, answers, evidence, rubric, explanation. */
export function EvidencePanel({ assessment, claimId, focusMessageId, onClose }) {
  const claim = assessment.claims.find(c => c.id === claimId);
  useEffect(() => {
    if (!focusMessageId) return;
    const el = document.getElementById(`msg-${focusMessageId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusMessageId, claimId]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!claim) return null;
  const { status, score, provisional } = claimStatus(claim);
  const messages = assessment.messages.filter(m => m.claim_id === claim.id);
  const evidence = assessment.evidence.filter(e => e.claim_id === claim.id);
  const evById = Object.fromEntries(evidence.map(e => [e.id, e]));
  const results = assessment.rubric[claim.id] || [];
  const answersById = Object.fromEntries(messages.filter(m => m.role === "answer").map(m => [m.reply_to, m]));
  const questions = messages.filter(m => m.role === "question");

  return (
    <aside className="ca-panel" role="dialog" aria-label="Claim evidence">
      <div className="ca-panel-head">
        <div>
          <div className="ca-eyebrow">{claim.competency_name}{claim.section ? ` · ${claim.section}` : ""}</div>
          <StatusPill status={status} provisional={provisional} />
          {score != null && <span className="ca-score-inline">{Math.round(score)}/100</span>}
        </div>
        <button className="ca-icon-btn" onClick={onClose} aria-label="Close evidence panel">✕</button>
      </div>
      <blockquote className="ca-claim-quote">{claim.source_text}</blockquote>
      {claim.skills.length > 0 && (
        <div className="ca-chips">{claim.skills.map(s => <span key={s} className="ca-chip">{s}</span>)}</div>
      )}

      {claim.explanation && (
        <section className="ca-panel-sec">
          <h4>Explanation</h4>
          <p>{claim.explanation}</p>
          {claim.recommendation && <p className="ca-reco"><strong>Recommendation:</strong> {claim.recommendation}</p>}
        </section>
      )}
      {!claim.explanation && provisional && (
        <p className="ca-muted ca-panel-sec">Live, provisional score from evidence collected so far. The final rubric evaluation runs when the interview ends.</p>
      )}

      {results.length > 0 && (
        <section className="ca-panel-sec">
          <h4>Rubric</h4>
          <table className="ca-rubric">
            <thead><tr><th>Criterion</th><th>Result</th><th className="num">Points</th></tr></thead>
            <tbody>
              {results.map(r => (
                <tr key={r.criterion_id}>
                  <td>
                    <div className="ca-crit-name">{r.criterion_name}</div>
                    <div className="ca-crit-desc">{r.description}</div>
                    {r.evidence_ids.map(eid => evById[eid] && (
                      <a key={eid} href={`#msg-${evById[eid].message_id}`} className="ca-cite">“{evById[eid].quote}”</a>
                    ))}
                  </td>
                  <td><LabelPill label={r.label} /> <GapPill gap={r.gap_type} /></td>
                  <td className="num">{r.points_awarded}/{r.points_possible}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="ca-panel-sec">
        <h4>Interview transcript for this claim</h4>
        {questions.length === 0 && <p className="ca-muted">This claim hasn't been discussed in the interview.</p>}
        {questions.map(q => {
          const a = answersById[q.id];
          const evs = a ? evidence.filter(e => e.message_id === a.id) : [];
          return (
            <div key={q.id} className="ca-qa">
              <div className="ca-q" id={`msg-${q.id}`}><span className="ca-who">Q</span>{q.content}</div>
              {a ? (
                <div className={`ca-a${focusMessageId === a.id ? " focus" : ""}`} id={`msg-${a.id}`}>
                  <span className="ca-who">A</span>
                  <HighlightedAnswer text={a.content} evidence={evs} />
                </div>
              ) : <div className="ca-a ca-muted"><span className="ca-who">A</span>Not answered.</div>}
            </div>
          );
        })}
      </section>
    </aside>
  );
}

function HighlightedAnswer({ text, evidence }) {
  const spans = [...evidence].filter(e => e.start != null).sort((a, b) => a.start - b.start);
  const parts = [];
  let pos = 0;
  spans.forEach(e => {
    if (e.start < pos) return;
    if (e.start > pos) parts.push(<span key={`t${pos}`}>{text.slice(pos, e.start)}</span>);
    parts.push(
      <mark key={e.id} className={`ca-ev ca-ev-${e.signal}`} title={e.note || e.criterion_ids.join(", ")}>
        {text.slice(e.start, e.end)}
      </mark>
    );
    pos = e.end;
  });
  if (pos < text.length) parts.push(<span key="end">{text.slice(pos)}</span>);
  return <span className="ca-answer-text">{parts}</span>;
}

export function BackLink({ to, children }) {
  return <Link to={to} className="ca-back">← {children}</Link>;
}
