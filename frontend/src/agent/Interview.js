import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { agentApi, claimStatus } from "./agentApi";
import { AgentShell, PageHead } from "./Shell";
import { Alert, Icon, Modal, PageSkeleton, Progress, Spinner, StatusBadge, StatusIcon, useToast } from "./ui";

const FOCUS_LABEL = { implementation: "Implementation", decision: "Design decision", "trade-off": "Trade-off", failure: "Failure scenario", measurement: "Measurement" };

export default function Interview() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState("");
  const [answerError, setAnswerError] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const threadRef = useRef(null);
  const boxRef = useRef(null);
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

  const msgCount = data?.messages?.length || 0;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgCount, busy]);

  const session = data?.session;
  const pending = session?.pending_question;
  useEffect(() => { if (pending && !busy) boxRef.current?.focus({ preventScroll: true }); }, [pending?.id, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e?.preventDefault();
    if (inFlight.current || !pending) return;
    const text = draft.trim();
    if (!text) { setAnswerError("Write an answer first. If you'd rather stop, use End interview."); boxRef.current?.focus(); return; }
    inFlight.current = true;
    setBusy("answer");
    setSent(text);
    setAnswerError("");
    try {
      const next = await agentApi.answer(id, pending.id, text);
      setDraft("");
      if (next.duplicate) toast("That answer was already recorded.", "info");
      if (next.status === "completed") { toast("Interview complete. Your report is ready."); nav(`/agent/a/${id}/report`); return; }
      setData(next);
    } catch (err) {
      setAnswerError(err.message);
      toast(err.message, "error");
    } finally {
      inFlight.current = false;
      setSent("");
      setBusy("");
    }
  };

  const end = async () => {
    setConfirmEnd(false);
    setBusy("end");
    try {
      await agentApi.end(id);
      toast("Interview ended. Report generated from the answers you gave.");
      nav(`/agent/a/${id}/report`);
    } catch (err) {
      toast(err.message, "error");
      setBusy("");
    }
  };

  if (error) {
    return <AgentShell title="Interview"><Alert title="The interview couldn't be loaded" action={<button className="ca-btn ca-btn--secondary ca-btn--sm" onClick={start}>Try again</button>}>{error}</Alert></AgentShell>;
  }
  if (!data) return <AgentShell title="Interview"><PageSkeleton /></AgentShell>;

  const claims = Object.fromEntries(data.claims.map(c => [c.id, c]));
  const current = claims[session?.current_claim_id];
  const answered = session?.answers_total || 0;
  const total = Math.max(session?.estimated_total || 1, answered + (pending ? 1 : 0));
  const pct = Math.min(100, Math.round((answered / total) * 100));
  const history = data.messages.filter(m => m.id !== pending?.id);
  const prev = history[history.length - 1];
  const isFollowUp = pending && prev?.role === "answer" && prev.claim_id === pending.claim_id;
  const isNewClaim = pending && prev && prev.claim_id !== pending.claim_id;
  const criteria = current ? (data.criteria?.[current.competency] || []) : [];
  const covered = new Set(data.evidence.filter(e => e.claim_id === current?.id && e.signal === "positive").flatMap(e => e.criterion_ids));
  const live = current ? claimStatus(current) : null;
  const qNo = (session?.answers_this_claim || 0) + 1;

  return (
    <AgentShell assessment={data} title="Interview">
      {busy === "end" && (
        <div className="ca-overlay" role="status"><div className="ca-overlay__box"><Spinner large /><strong>Evaluating your answers</strong>
          <span>Labelling each rubric criterion and computing scores. This can take a little while on a live model.</span></div></div>
      )}
      <Modal open={confirmEnd} title="End the interview now?" onClose={() => setConfirmEnd(false)}
             actions={<><button className="ca-btn ca-btn--secondary" onClick={() => setConfirmEnd(false)} data-autofocus>Keep going</button>
               <button className="ca-btn ca-btn--danger" onClick={end}><Icon name="flag" size={14} />End and evaluate</button></>}>
        <p>Your {answered} answer{answered === 1 ? "" : "s"} will be scored now. Claims you haven't discussed yet will be marked <b>Insufficient evidence</b>, which means "not explained yet", not "untrue".</p>
      </Modal>

      <PageHead eyebrow={<><span className="ca-dot" style={{ width: 6, height: 6, borderRadius: 9, background: "var(--accent)", display: "inline-block" }} />Live interview</>}
                title={data.target_role} subtitle={`Question ${answered + (pending ? 1 : 0)} of about ${total} · ${session?.claim_order.length} claims`}
                actions={<>
                  <Link to={`/agent/a/${id}/heatmap`} className="ca-btn ca-btn--secondary ca-btn--sm"><Icon name="target" size={14} />Live heatmap</Link>
                  <button className="ca-btn ca-btn--ghost ca-btn--sm" onClick={() => setConfirmEnd(true)} disabled={!!busy}><Icon name="flag" size={14} />End interview</button>
                </>} />

      <div className="ca-room">
        {/* LEFT: claims under evaluation */}
        <aside className="ca-room__pane ca-room__left ca-card" aria-label="Claims in this interview">
          <div className="ca-card__body" style={{ paddingBottom: 12 }}>
            <div className="ca-meter__label"><span style={{ fontWeight: 600 }}>Progress</span><span className="ca-mono ca-faint">{answered}/{total}</span></div>
            <Progress value={pct} label={`Interview progress ${pct}%`} />
          </div>
          <div className="ca-side__label" style={{ padding: "4px 16px 6px" }}>Claims</div>
          <ol className="ca-qclaims">
            {session?.claim_order.map((cid, i) => {
              const c = claims[cid];
              const st = claimStatus(c);
              const state = i < session.current_claim_idx ? "done" : i === session.current_claim_idx ? "current" : "next";
              return (
                <li key={cid} className={`ca-qclaim is-${state}`} aria-current={state === "current" ? "step" : undefined}>
                  <span className="ca-qclaim__n">{state === "done" ? <Icon name="check" size={12} /> : i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <p>{c.summary}</p>
                    {st.status ? <StatusBadge status={st.status} provisional={st.provisional} small />
                      : <span className="ca-faint" style={{ fontSize: 11.5 }}>{state === "current" ? "Being probed" : "Up next"}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* CENTER: conversation */}
        <section className="ca-room__center" aria-label="Interview conversation">
          {current && (
            <div className="ca-card ca-current">
              <div className="ca-current__meta">
                <span className="ca-badge ca-badge--accent">Claim {session.current_claim_idx + 1} of {session.claim_order.length}</span>
                <span className="ca-badge">{current.competency_name}</span>
                <span className="ca-claim__src">{current.id} · line {current.line_index != null ? current.line_index + 1 : "?"}</span>
              </div>
              <blockquote className="ca-quote">{current.source_text}</blockquote>
            </div>
          )}

          <div className="ca-card" style={{ overflow: "hidden" }}>
            <div className="ca-thread" ref={threadRef} aria-live="polite" aria-label="Conversation history">
              {history.length === 0 && !sent && <p className="ca-thread--empty">The interviewer opens with a question about your first claim.</p>}
              {history.map((m, i) => {
                const before = history[i - 1];
                const sep = m.role === "question" && before && before.claim_id !== m.claim_id;
                return (
                  <React.Fragment key={m.id}>
                    {sep && <div className="ca-claimsep"><span>Next claim · {claims[m.claim_id]?.summary}</span></div>}
                    <Message m={m} criteria={data.criteria?.[claims[m.claim_id]?.competency]} />
                  </React.Fragment>
                );
              })}
              {sent && pending && <Message m={pending} criteria={data.criteria?.[claims[pending.claim_id]?.competency]} />}
              {sent && <Message m={{ role: "answer", content: sent }} pendingSend />}
              {busy === "answer" && (
                <div className="ca-msg ca-msg--q"><span className="ca-msg__avatar">Q</span>
                  <div className="ca-thinking"><span className="ca-dots" aria-hidden="true"><i /><i /><i /></span>Reviewing your answer and extracting evidence</div></div>
              )}
            </div>

            {pending && busy !== "answer" && (
              <div className="ca-ask">
                <div className="ca-msg ca-msg--q ca-msg--current">
                  <span className="ca-msg__avatar">Q</span>
                  <div className="ca-msg__body">
                    <div className="ca-msg__meta">
                      <strong>Interviewer</strong>
                      {isFollowUp && <span className="ca-followup-tag"><Icon name="reply" size={12} />Following up on your last answer</span>}
                      {isNewClaim && <span className="ca-followup-tag"><Icon name="arrowRight" size={12} />New claim</span>}
                      {session.current_criterion && <span title={FOCUS_LABEL[session.current_criterion.focus]}>· Probing {session.current_criterion.name.toLowerCase()}</span>}
                    </div>
                    <p className="ca-msg__text">{pending.content}</p>
                  </div>
                </div>
              </div>
            )}
            {session?.status === "active" && !pending && !busy && (
              <div className="ca-ask"><Alert tone="warn" title="The next question wasn't generated"
                action={<button className="ca-btn ca-btn--secondary ca-btn--sm" onClick={start}><Icon name="refresh" size={14} />Resume</button>}>
                Your last answer was saved. The connection may have dropped before the next question arrived.</Alert></div>
            )}
          </div>

          <form className="ca-card ca-composer" onSubmit={submit}>
            <label htmlFor="answer" className="ca-sr">Your answer</label>
            <textarea id="answer" ref={boxRef} className="ca-textarea" value={draft} maxLength={4000} rows={6}
                      onChange={(e) => { setDraft(e.target.value); if (answerError) setAnswerError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e); }}
                      placeholder="Be specific: what you built, why you chose it, what you traded off, what broke and how you found out."
                      disabled={!pending || !!busy} aria-invalid={!!answerError} aria-describedby="answer-hint" />
            {answerError && <p className="ca-errtext" role="alert"><Icon name="alert" size={14} />{answerError}</p>}
            <div className="ca-composer__bar">
              <span className="ca-composer__hint" id="answer-hint"><span className="ca-kbd">Ctrl</span>+<span className="ca-kbd">Enter</span> to submit · {draft.length}/4000</span>
              <div className="ca-actions">
                <button className="ca-btn ca-btn--primary" disabled={!pending || !!busy || !draft.trim()}>
                  {busy === "answer" ? <><Spinner />Submitting</> : <>Submit answer<Icon name="send" size={14} /></>}
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* RIGHT: evaluation context */}
        <aside className="ca-room__pane ca-room__right" aria-label="Evaluation context">
          <div className="ca-room__rightinner ca-stack">
            <div className="ca-card">
              <div className="ca-card__head"><span className="ca-card__title"><Icon name="listChecks" />Evaluation criteria</span>
                <span className="ca-faint" style={{ fontSize: 11.5 }}>{current?.competency_name}</span></div>
              <ul className="ca-crit">
                {criteria.map(c => {
                  const probing = session?.current_criterion?.id === c.id;
                  const hit = covered.has(c.id);
                  return (
                    <li key={c.id} className={probing ? "is-probing" : hit ? "is-covered" : "is-open"}>
                      {probing ? <Icon name="target" size={14} className="ca-t-accent" /> : <Icon name={hit ? "checkCircle" : "circle"} size={14} />}
                      <div><div className="ca-crit__name">{c.name}</div><div className="ca-crit__desc">{probing ? "Being probed now. " : hit ? "Evidence found. " : ""}{c.description}</div></div>
                      <span className="ca-crit__pts">{c.points}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="ca-card__foot ca-help">Points are fixed by the rubric. Final labels are set when the interview ends.</div>
            </div>
            <div className="ca-card">
              <div className="ca-card__head"><span className="ca-card__title"><Icon name="chart" />This claim</span>{live?.status && <StatusIcon status={live.status} />}</div>
              <dl className="ca-kv">
                <div><dt>Question</dt><dd>{qNo} of up to {session?.max_per_claim}</dd></div>
                <div><dt>Criteria with evidence</dt><dd>{criteria.filter(c => covered.has(c.id)).length} / {criteria.length}</dd></div>
                <div><dt>Live score</dt><dd>{live?.score != null ? `${Math.round(live.score)} / 100` : "After first answer"}</dd></div>
                <div><dt>Skills</dt><dd style={{ fontFamily: "var(--mono)", fontWeight: 500 }}>{current?.skills.join(", ") || "—"}</dd></div>
              </dl>
            </div>
          </div>
        </aside>
      </div>
    </AgentShell>
  );
}

function Message({ m, criteria, pendingSend }) {
  const isQ = m.role === "question";
  const crit = isQ && criteria ? criteria.find(c => c.id === m.criterion_id) : null;
  return (
    <div className={`ca-msg ca-msg--${isQ ? "q" : "a"}`} style={pendingSend ? { opacity: 0.7 } : undefined}>
      <span className="ca-msg__avatar">{isQ ? "Q" : "A"}</span>
      <div className="ca-msg__body">
        <div className="ca-msg__meta"><strong>{isQ ? "Interviewer" : "You"}</strong>{crit && <span>{crit.name}</span>}{pendingSend && <span>sending…</span>}</div>
        <p className="ca-msg__text">{m.content}</p>
      </div>
    </div>
  );
}
