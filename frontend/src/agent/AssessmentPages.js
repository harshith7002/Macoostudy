import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { agentApi, claimStatus, GAP, STATUS, useAssessment } from "./agentApi";
import { AgentShell, EmptyState, ErrorState, EvidencePanel, GapPill, Loading, StatusPill } from "./components";

function useLoaded() {
  const { id } = useParams();
  const state = useAssessment(id);
  return { id, ...state };
}

function Gate({ loading, error, data, reload, children }) {
  if (error) return <AgentShell><ErrorState message={error} onRetry={reload} /></AgentShell>;
  if (loading && !data) return <AgentShell><Loading label="Loading assessment…" /></AgentShell>;
  return children;
}

/* ── Analysis: extracted claims ─────────────────────────────────── */
export function AnalysisPage() {
  const { id, data, error, loading, reload } = useLoaded();
  return (
    <Gate {...{ loading, error, data, reload }}>
      {data && (
        <AgentShell assessment={data}>
          <div className="ca-head-row">
            <div>
              <span className="ca-eyebrow">{data.filename}</span>
              <h1 className="ca-h1">{data.target_role}</h1>
              <p className="ca-muted">
                {data.claims.length} claim{data.claims.length === 1 ? "" : "s"} extracted · {data.interview_plan.length} will be probed in the interview (most relevant to the job first)
              </p>
            </div>
            {data.status === "completed" ? (
              <Link to={`/agent/a/${id}/report`} className="ca-btn">View report</Link>
            ) : (
              <Link to={`/agent/a/${id}/interview`} className="ca-btn">{data.session ? "Resume interview" : "Start interview"}</Link>
            )}
          </div>

          <section className="ca-card ca-mb">
            <h3>What the job description asks for</h3>
            {data.jd.skills?.length ? (
              <div className="ca-chips">{data.jd.skills.map(s => <span key={s} className="ca-chip">{s}</span>)}</div>
            ) : <p className="ca-muted">No known technical skills were detected in the job description; claims are ordered by resume position.</p>}
          </section>

          <div className="ca-claims">
            {data.claims.map((c, i) => {
              const st = claimStatus(c);
              const planned = data.interview_plan.includes(c.id);
              return (
                <article key={c.id} className="ca-claim-card">
                  <div className="ca-claim-top">
                    <span className="ca-claim-id">#{i + 1} · {c.id}</span>
                    <StatusPill status={st.status} provisional={st.provisional} small />
                  </div>
                  <p className="ca-claim-text">{c.source_text}</p>
                  <div className="ca-claim-meta">
                    <span className="ca-chip ca-chip-comp">{c.competency_name}</span>
                    {c.skills.map(s => (
                      <span key={s} className={`ca-chip${data.jd.skills?.includes(s) ? " ca-chip-match" : ""}`}>{s}</span>
                    ))}
                    <span className="ca-muted ca-small">{c.section ? `${c.section} · ` : ""}line {c.line_index != null ? c.line_index + 1 : "?"}</span>
                    {planned && <span className="ca-small ca-planned">In interview</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </AgentShell>
      )}
    </Gate>
  );
}

/* ── Interview room ─────────────────────────────────────────────── */
export function InterviewPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerError, setAnswerError] = useState("");
  const endRef = useRef(null);
  const inFlight = useRef(false);

  const start = useCallback(async () => {
    setError("");
    setBusy("start");
    try {
      const current = await agentApi.get(id);
      if (current.status === "completed") { nav(`/agent/a/${id}/report`, { replace: true }); return; }
      setData(await agentApi.start(id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }, [id, nav]);

  useEffect(() => { start(); }, [start]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [data?.messages?.length]);

  const session = data?.session;
  const pending = session?.pending_question;

  const submit = async (e) => {
    e?.preventDefault();
    if (inFlight.current || !pending) return;
    if (!answer.trim()) { setAnswerError("Type an answer first, or end the interview."); return; }
    inFlight.current = true;
    setBusy("answer");
    setAnswerError("");
    try {
      const next = await agentApi.answer(id, pending.id, answer);
      setAnswer("");
      if (next.status === "completed") { nav(`/agent/a/${id}/report`); return; }
      setData(next);
    } catch (err) {
      setAnswerError(err.message);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };

  const end = async () => {
    if (!window.confirm("End the interview now? Claims you haven't discussed will be marked Insufficient evidence.")) return;
    setBusy("end");
    try {
      await agentApi.end(id);
      nav(`/agent/a/${id}/report`);
    } catch (err) {
      setAnswerError(err.message);
      setBusy("");
    }
  };

  if (error) return <AgentShell><ErrorState message={error} onRetry={start} /></AgentShell>;
  if (!data) return <AgentShell><Loading label="Preparing your first question…" /></AgentShell>;

  const claims = Object.fromEntries(data.claims.map(c => [c.id, c]));
  const current = claims[session?.current_claim_id];
  const answered = session?.answers_total || 0;
  const total = Math.max(session?.estimated_total || 1, answered + (pending ? 1 : 0));
  const pct = Math.min(100, Math.round((answered / total) * 100));

  return (
    <AgentShell assessment={data}>
      {busy === "end" && <div className="ca-overlay"><Loading label="Evaluating your answers against the rubric…" /></div>}
      <div className="ca-interview">
        <aside className="ca-int-side">
          <div className="ca-progress" aria-label={`Progress ${pct}%`}>
            <div className="ca-progress-row"><strong>Progress</strong><span>{answered} answered · ~{total} questions</span></div>
            <div className="ca-bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
          <h4 className="ca-side-h">Claims in this interview</h4>
          <ol className="ca-side-claims">
            {session?.claim_order.map((cid, i) => {
              const c = claims[cid];
              const st = claimStatus(c);
              const state = i < session.current_claim_idx ? "done" : i === session.current_claim_idx ? "current" : "next";
              return (
                <li key={cid} className={`ca-side-claim ${state}`}>
                  <span className="ca-side-num">{i + 1}</span>
                  <div>
                    <p>{c.summary}</p>
                    {st.status ? <StatusPill status={st.status} provisional={st.provisional} small /> : <span className="ca-muted ca-small">{state === "current" ? "In progress" : "Up next"}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
          <Link to={`/agent/a/${id}/heatmap`} className="ca-btn ca-btn-ghost ca-btn-block">Open live heatmap</Link>
        </aside>

        <section className="ca-int-main">
          {current && (
            <div className="ca-current">
              <div className="ca-current-meta">
                <span className="ca-eyebrow">Current claim · {session.current_competency}</span>
                {session.current_criterion && <span className="ca-chip ca-chip-focus">Probing: {session.current_criterion.name}</span>}
                <span className="ca-muted ca-small">Question {session.answers_this_claim + 1} of up to {session.max_per_claim} on this claim</span>
              </div>
              <blockquote className="ca-claim-quote">{current.source_text}</blockquote>
            </div>
          )}

          <div className="ca-chat" aria-live="polite">
            {data.messages.map((m, i) => {
              const prev = data.messages[i - 1];
              const newClaim = m.role === "question" && (!prev || prev.claim_id !== m.claim_id);
              return (
                <React.Fragment key={m.id}>
                  {newClaim && <div className="ca-chat-sep">{claims[m.claim_id]?.summary}</div>}
                  <div className={`ca-msg ca-msg-${m.role}`}>
                    <span className="ca-msg-who">{m.role === "question" ? "Interviewer" : "You"}</span>
                    <p>{m.content}</p>
                  </div>
                </React.Fragment>
              );
            })}
            {busy === "answer" && <div className="ca-msg ca-msg-question ca-typing"><span className="ca-spinner sm" /> Reading your answer and extracting evidence…</div>}
            <div ref={endRef} />
          </div>

          {session?.status === "active" && !pending && busy !== "answer" && (
            <div className="ca-state">
              <span>The next question wasn't generated (the connection may have dropped).</span>
              <button className="ca-btn" onClick={start} disabled={!!busy}>Resume interview</button>
            </div>
          )}

          <form className="ca-answer" onSubmit={submit}>
            <label htmlFor="ca-answer-box" className="ca-sr">Your answer</label>
            <textarea
              id="ca-answer-box" value={answer} rows={5} maxLength={4000}
              onChange={(e) => { setAnswer(e.target.value); if (answerError) setAnswerError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e); }}
              placeholder="Explain it like you would to a senior engineer: what you built, why, what you traded off, what broke."
              disabled={!pending || !!busy}
            />
            {answerError && <p className="ca-field-err" role="alert">{answerError}</p>}
            <div className="ca-answer-bar">
              <span className="ca-muted ca-small">{answer.length}/4000 · Ctrl+Enter to send</span>
              <div className="ca-answer-btns">
                <button type="button" className="ca-btn ca-btn-ghost" onClick={end} disabled={!!busy}>End interview</button>
                <button className="ca-btn" disabled={!pending || !!busy}>{busy === "answer" ? "Sending…" : "Submit answer"}</button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </AgentShell>
  );
}

/* ── Resume heatmap ─────────────────────────────────────────────── */
export function HeatmapPage() {
  const { id, data, error, loading, reload } = useLoaded();
  const [params, setParams] = useSearchParams();
  const openClaim = params.get("claim");
  const focusMsg = params.get("msg");
  const open = (cid) => setParams(cid ? { claim: cid } : {});
  const close = useCallback(() => setParams({}), [setParams]);

  const segments = useMemo(() => {
    if (!data) return [];
    const text = data.resume_text;
    const spans = [...data.claims].filter(c => c.start != null).sort((a, b) => a.start - b.start);
    const out = [];
    let pos = 0;
    spans.forEach(c => {
      if (c.start < pos) return;
      if (c.start > pos) out.push({ text: text.slice(pos, c.start) });
      out.push({ text: text.slice(c.start, c.end), claim: c });
      pos = c.end;
    });
    if (pos < text.length) out.push({ text: text.slice(pos) });
    return out;
  }, [data]);

  return (
    <Gate {...{ loading, error, data, reload }}>
      {data && (
        <AgentShell assessment={data}>
          <div className="ca-head-row">
            <div>
              <h1 className="ca-h1">Resume heatmap</h1>
              <p className="ca-muted">
                {data.status === "completed" ? "Final claim statuses." : "Live, provisional statuses update as you answer; final statuses appear when the interview ends."} Click a highlighted claim for its evidence.
              </p>
            </div>
            <button className="ca-btn ca-btn-ghost" onClick={reload}>Refresh</button>
          </div>
          <div className="ca-legend">
            {Object.entries(STATUS).map(([k, v]) => <span key={k}><i className={`ca-swatch ca-sw-${v.tone}`} />{v.label}</span>)}
            <span><i className="ca-swatch ca-sw-none" />Not assessed yet</span>
          </div>
          <div className={`ca-heat-wrap${openClaim ? " with-panel" : ""}`}>
            <div className="ca-resume" aria-label="Resume text with highlighted claims">
              {segments.map((s, i) => {
                if (!s.claim) return <span key={i}>{s.text}</span>;
                const st = claimStatus(s.claim);
                const tone = st.status ? STATUS[st.status].tone : "none";
                return (
                  <button key={i} type="button"
                          className={`ca-hl ca-hl-${tone}${openClaim === s.claim.id ? " active" : ""}${st.provisional ? " provisional" : ""}`}
                          onClick={() => open(s.claim.id)}
                          aria-label={`Claim: ${s.claim.summary}. Status: ${st.status ? STATUS[st.status].label : "not assessed yet"}`}>
                    {s.text}
                  </button>
                );
              })}
            </div>
            {openClaim && <EvidencePanel assessment={data} claimId={openClaim} focusMessageId={focusMsg} onClose={close} />}
          </div>
          {data.status !== "completed" && (
            <div className="ca-actions"><Link to={`/agent/a/${id}/interview`} className="ca-btn">Back to interview</Link></div>
          )}
        </AgentShell>
      )}
    </Gate>
  );
}

/* ── Report ─────────────────────────────────────────────────────── */
const TONE_COLOR = { good: "#10B981", mid: "#F59E0B", low: "#EF4444" };
const toneFor = (score) => (score >= 70 ? "good" : score >= 35 ? "mid" : "low");

export function ReportPage() {
  const { id, data, error, loading, reload } = useLoaded();
  return (
    <Gate {...{ loading, error, data, reload }}>
      {data && (
        <AgentShell assessment={data}>
          {!data.report ? (
            <EmptyState title="No report yet" action={<Link to={`/agent/a/${id}/interview`} className="ca-btn">Go to interview</Link>}>
              The report is generated when the interview ends.
            </EmptyState>
          ) : <Report data={data} />}
        </AgentShell>
      )}
    </Gate>
  );
}

function Report({ data }) {
  const r = data.report;
  const id = data.id;
  const claims = Object.fromEntries(data.claims.map(c => [c.id, c]));
  const heat = (claimId, msgId) => `/agent/a/${id}/heatmap?claim=${claimId}${msgId ? `&msg=${msgId}` : ""}`;
  const answerFor = (qid) => data.messages.find(m => m.reply_to === qid);
  const tone = toneFor(r.readiness_score);
  const gapsByType = Object.keys(GAP).map(g => [g, r.gaps.filter(x => x.gap_type === g)]);

  return (
    <>
      <div className="ca-head-row">
        <div>
          <span className="ca-eyebrow">Final report · {data.filename}</span>
          <h1 className="ca-h1">{data.target_role}</h1>
          <p className="ca-muted">{r.ended === "ended_early" ? "Interview ended early. " : ""}Generated {r.generated_at} UTC.</p>
        </div>
        <div className="ca-head-btns">
          <Link to={`/agent/a/${id}/heatmap`} className="ca-btn ca-btn-ghost">Heatmap</Link>
          <Link to={`/agent/a/${id}/remediation`} className="ca-btn">Practise the gaps</Link>
        </div>
      </div>

      <div className="ca-report-top">
        <div className={`ca-readiness ca-tone-${tone}`}>
          <div className="ca-ring" style={{ "--pct": r.readiness_score, "--ring": TONE_COLOR[tone] }}>
            <span>{Math.round(r.readiness_score)}</span>
          </div>
          <div>
            <strong>{r.readiness_band}</strong>
            <p className="ca-muted ca-small">Readiness score · based on {r.coverage.interviewed} of {r.coverage.total} claims ({r.coverage.answers} answers)</p>
          </div>
        </div>
        <div className="ca-card ca-statuses">
          {Object.entries(STATUS).map(([k, v]) => (
            <div key={k} className="ca-stat"><span className={`ca-stat-n ca-t-${v.tone}`}>{r.status_counts[k] || 0}</span><span>{v.label}</span></div>
          ))}
        </div>
      </div>

      <section className="ca-card ca-mb">
        <h3>Competency breakdown</h3>
        {r.competencies.length === 0 ? <p className="ca-muted">No competencies were assessed.</p> : (
          <div className="ca-chart" style={{ height: Math.max(140, r.competencies.length * 52) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.competencies} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: "#94A3B8", fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={170} tick={{ fill: "#CBD5E1", fontSize: 13 }} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={{ background: "#1C1E26", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                         formatter={(v) => [`${v}/100`, "Score"]} />
                <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={22}>
                  {r.competencies.map(c => <Cell key={c.competency} fill={TONE_COLOR[toneFor(c.score)]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="ca-card ca-mb">
        <h3>Claim summary</h3>
        <div className="ca-table-wrap">
          <table className="ca-table">
            <thead><tr><th>Claim</th><th>Competency</th><th>Status</th><th className="num">Score</th><th /></tr></thead>
            <tbody>
              {data.claims.map(c => (
                <tr key={c.id}>
                  <td className="ca-td-claim">{c.source_text}</td>
                  <td>{c.competency_name}</td>
                  <td><StatusPill status={c.status} small /></td>
                  <td className="num">{c.interviewed ? Math.round(c.score) : "—"}</td>
                  <td><Link to={heat(c.id)} className="ca-link">Evidence →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ca-grid-2">
        <section className="ca-card">
          <h3>Strengths</h3>
          {r.strengths.length === 0 && <p className="ca-muted">No criterion was fully demonstrated yet.</p>}
          <ul className="ca-findings">
            {r.strengths.map((s, i) => (
              <li key={i}>
                <strong>{s.criterion_name}</strong> <span className="ca-muted ca-small">· {claims[s.claim_id]?.summary}</span>
                <q>{s.quote}</q>
                <Link to={heat(s.claim_id, s.message_id)} className="ca-link">View your response →</Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="ca-card">
          <h3>Gaps</h3>
          {r.gaps.length === 0 && <p className="ca-muted">No gaps found in the assessed claims.</p>}
          {gapsByType.map(([g, items]) => items.length > 0 && (
            <div key={g} className="ca-gap-group">
              <div className="ca-gap-head"><GapPill gap={g} /><span className="ca-muted ca-small">{GAP[g].hint}</span></div>
              <ul className="ca-findings">
                {items.map((x, i) => {
                  const ans = x.message_ids.map(answerFor).find(Boolean);
                  return (
                    <li key={i}>
                      <strong>{x.criterion_name}</strong> <span className="ca-muted ca-small">· {claims[x.claim_id]?.summary} · −{x.points_lost} pts</span>
                      <Link to={heat(x.claim_id, ans?.id || x.message_ids[0])} className="ca-link">
                        {x.message_ids.length ? "See the related exchange →" : "Not asked: see claim →"}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      </div>
      <p className="ca-muted ca-small ca-method">{r.method} Model provider: {data.provider?.label}.</p>
    </>
  );
}

/* ── Remediation ────────────────────────────────────────────────── */
export function RemediationPage() {
  const { id, data, setData, error, loading, reload } = useLoaded();
  const [filter, setFilter] = useState("all");
  const [taskErr, setTaskErr] = useState("");

  const toggle = async (task) => {
    const status = task.status === "done" ? "todo" : "done";
    setTaskErr("");
    try {
      await agentApi.setTask(id, task.id, status);
      setData(d => ({ ...d, remediation: d.remediation.map(t => (t.id === task.id ? { ...t, status } : t)) }));
    } catch (e) {
      setTaskErr(e.message);
    }
  };

  return (
    <Gate {...{ loading, error, data, reload }}>
      {data && (
        <AgentShell assessment={data}>
          <div className="ca-head-row">
            <div>
              <h1 className="ca-h1">Remediation plan</h1>
              <p className="ca-muted">Written and verbal exercises for each gap. Nothing here runs code.</p>
            </div>
            <Link to={`/agent/a/${id}/report`} className="ca-btn ca-btn-ghost">Back to report</Link>
          </div>
          {data.status !== "completed" ? (
            <EmptyState title="Finish the interview first" action={<Link to={`/agent/a/${id}/interview`} className="ca-btn">Go to interview</Link>}>
              Remediation tasks are generated from the final rubric results.
            </EmptyState>
          ) : data.remediation.length === 0 ? (
            <EmptyState title="Nothing to practise">Every assessed criterion was demonstrated.</EmptyState>
          ) : (
            <>
              <div className="ca-filters" role="tablist">
                {[["all", "All"], ...Object.entries(GAP).map(([k, v]) => [k, v.label])].map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={filter === k} className={`ca-filter${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>
                    {l} <span>{k === "all" ? data.remediation.length : data.remediation.filter(t => t.gap_type === k).length}</span>
                  </button>
                ))}
              </div>
              {taskErr && <ErrorState message={taskErr} />}
              <div className="ca-tasks">
                {data.remediation.filter(t => filter === "all" || t.gap_type === filter).map(t => {
                  const claim = data.claims.find(c => c.id === t.claim_id);
                  return (
                    <article key={t.id} className={`ca-task${t.status === "done" ? " done" : ""}`}>
                      <div className="ca-task-top">
                        <GapPill gap={t.gap_type} />
                        <button className="ca-btn ca-btn-ghost sm" onClick={() => toggle(t)}>{t.status === "done" ? "✓ Done · undo" : "Mark done"}</button>
                      </div>
                      <h3>{t.title}</h3>
                      {claim && <blockquote className="ca-claim-quote sm">{claim.source_text}</blockquote>}
                      <p>{t.explanation}</p>
                      <h4>Exercise</h4><p>{t.exercise}</p>
                      <h4>Scenario</h4><p>{t.scenario}</p>
                      <h4>A strong answer…</h4>
                      <ul>{(t.solution_criteria || []).map((s, i) => <li key={i}>{s}</li>)}</ul>
                      <div className="ca-followup"><span>Follow-up question to practise</span><p>{t.follow_up_question}</p></div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </AgentShell>
      )}
    </Gate>
  );
}
