import React, { useCallback, useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { claimStatus, STATUS, useAssessment } from "./agentApi";
import { AgentShell, AssessmentGate, PageHead } from "./Shell";
import { GapBadge, Icon, LabelBadge, StatusBadge, toneFor } from "./ui";

const FILTERS = [["all", "All claims"], ["SUPPORTED", "Supported"], ["PARTIALLY SUPPORTED", "Partially supported"], ["INSUFFICIENT EVIDENCE", "Insufficient evidence"]];

export default function Heatmap() {
  const { id } = useParams();
  const state = useAssessment(id);
  return <AssessmentGate state={state} title="Resume heatmap">{(a) => <HeatmapView a={a} reload={state.reload} />}</AssessmentGate>;
}

function HeatmapView({ a, reload }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get("claim");
  const focusMsg = params.get("msg");
  const filter = params.get("f") || "all";
  const done = a.status === "completed";

  const update = useCallback((patch) => {
    const next = Object.fromEntries(params.entries());
    Object.entries(patch).forEach(([k, v]) => (v ? (next[k] = v) : delete next[k]));
    setParams(next, { replace: true });
  }, [params, setParams]);

  // Open the first claim by default so the inspector is never empty.
  useEffect(() => {
    if (!selected && a.claims.length) update({ claim: [...a.claims].sort((x, y) => x.start - y.start)[0].id });
  }, [selected, a.claims, update]);

  const counts = useMemo(() => {
    const c = { all: a.claims.length };
    a.claims.forEach(cl => { const s = claimStatus(cl).status; if (s) c[s] = (c[s] || 0) + 1; });
    return c;
  }, [a.claims]);

  // Rebuild the resume line by line (text = lines joined by "\n"), keeping exact claim offsets.
  const lines = useMemo(() => {
    const out = [];
    let offset = 0;
    a.resume_text.split("\n").forEach((text, i) => {
      const start = offset, end = offset + text.length;
      const inLine = a.claims.filter(c => c.start >= start && c.start < end + 1).sort((x, y) => x.start - y.start);
      const parts = [];
      let pos = start;
      inLine.forEach(c => {
        if (c.start < pos) return;
        if (c.start > pos) parts.push({ text: a.resume_text.slice(pos, c.start) });
        parts.push({ text: a.resume_text.slice(c.start, Math.min(c.end, end)), claim: c });
        pos = Math.min(c.end, end);
      });
      if (pos < end) parts.push({ text: a.resume_text.slice(pos, end) });
      const heading = text.length < 40 && /^[A-Za-z &]+$/.test(text) && inLine.length === 0 &&
        /^(summary|profile|experience|work experience|professional experience|projects|personal projects|skills|technical skills|education|achievements|awards|certifications|leadership|activities|internships?)$/i.test(text.trim());
      out.push({ n: i + 1, parts, heading });
      offset = end + 1;
    });
    return out;
  }, [a.resume_text, a.claims]);

  const claimNo = Object.fromEntries([...a.claims].sort((x, y) => x.start - y.start).map((c, i) => [c.id, i + 1]));

  return (
    <AgentShell assessment={a} title="Resume heatmap">
      <PageHead eyebrow={<><Icon name="target" size={13} />Resume heatmap</>} title="Which claims did your answers support?"
                subtitle={done ? "Final verdicts from the rubric. Select any highlighted claim to inspect the evidence behind it."
                  : "Provisional, live verdicts from the evidence collected so far (dashed). Final verdicts appear when the interview ends."}
                actions={<>
                  {!done && <Link to={`/agent/a/${a.id}/interview`} className="ca-btn ca-btn--primary ca-btn--sm"><Icon name="message" size={14} />Back to interview</Link>}
                  {!done && <button className="ca-btn ca-btn--secondary ca-btn--sm" onClick={reload}><Icon name="refresh" size={14} />Refresh</button>}
                  {done && <Link to={`/agent/a/${a.id}/report`} className="ca-btn ca-btn--secondary ca-btn--sm"><Icon name="chart" size={14} />Report</Link>}
                </>} />

      <div className="ca-heat__toolbar">
        <div className="ca-seg" role="group" aria-label="Filter claims by verdict">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => update({ f: k === "all" ? null : k })}>
              {k !== "all" && <i className={`ca-sw ca-sw--${STATUS[k].tone}`} />}{l}<span className="ca-seg__n">{counts[k] || 0}</span>
            </button>
          ))}
        </div>
        <div className="ca-legend"><span><i className="ca-sw ca-sw--none" />Not assessed yet</span></div>
      </div>

      <div className="ca-heat">
        <div className="ca-doc" role="region" aria-label="Resume with highlighted claims">
          <div className="ca-doc__bar">
            <span>{a.filename} · text reconstructed from the PDF</span>
            <span>{a.claims.length} claims · exact character offsets</span>
          </div>
          <div className="ca-doc__page">
            {lines.map(l => (
              <div key={l.n} className={`ca-doc__row${l.heading ? " is-heading" : ""}`}>
                <span aria-hidden="true" className="ca-doc__ln">{l.n}</span>
                <span className={l.heading ? "ca-doc__line--heading" : undefined}>
                  {l.parts.length === 0 && " "}
                  {l.parts.map((p, j) => {
                    if (!p.claim) return <span key={j}>{p.text}</span>;
                    const st = claimStatus(p.claim);
                    const tone = st.status ? STATUS[st.status].tone : "none";
                    const dim = filter !== "all" && st.status !== filter;
                    return (
                      <button key={j} type="button" onClick={() => {
                                update({ claim: p.claim.id, msg: null });
                                // Stacked layout: the inspector is below the resume, so bring it into view.
                                if (window.innerWidth <= 1024) setTimeout(() => document.querySelector(".ca-insp")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
                              }}
                              className={`ca-hl ca-hl--${tone}${selected === p.claim.id ? " is-selected" : ""}${st.provisional ? " is-provisional" : ""}${dim ? " is-dim" : ""}`}
                              aria-pressed={selected === p.claim.id}
                              aria-label={`Claim ${claimNo[p.claim.id]}: ${p.claim.summary}. ${st.status ? STATUS[st.status].label : "Not assessed yet"}${st.provisional ? ", provisional" : ""}`}>
                        {p.text}<sup className="ca-hl__id">{claimNo[p.claim.id]}</sup>
                      </button>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
        {selected && <Inspector a={a} claimId={selected} focusMsg={focusMsg} n={claimNo[selected]} onClose={() => update({ claim: null, msg: null })} />}
      </div>
    </AgentShell>
  );
}

function Sec({ n, title, children }) {
  return (
    <section className="ca-insp__sec">
      <h3 className="ca-insp__h"><b>{n}</b>{title}</h3>
      {children}
    </section>
  );
}

export function Inspector({ a, claimId, focusMsg, n, onClose }) {
  const claim = a.claims.find(c => c.id === claimId);
  useEffect(() => {
    if (!focusMsg) return;
    const t = setTimeout(() => document.getElementById(`msg-${focusMsg}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => clearTimeout(t);
  }, [focusMsg, claimId]);
  if (!claim) return null;

  const st = claimStatus(claim);
  const msgs = a.messages.filter(m => m.claim_id === claim.id);
  const questions = msgs.filter(m => m.role === "question");
  const answerFor = Object.fromEntries(msgs.filter(m => m.role === "answer").map(m => [m.reply_to, m]));
  const evidence = a.evidence.filter(e => e.claim_id === claim.id);
  const positive = evidence.filter(e => e.signal === "positive");
  const crits = a.criteria?.[claim.competency] || [];
  const critName = Object.fromEntries(crits.map(c => [c.id, c.name]));
  const results = a.rubric[claim.id] || [];
  const coveredLive = new Set(positive.flatMap(e => e.criterion_ids));
  const missing = results.length ? results.filter(r => r.label !== "demonstrated")
    : crits.filter(c => !coveredLive.has(c.id)).map(c => ({ criterion_id: c.id, criterion_name: c.name, description: c.description, points_possible: c.points }));

  return (
    <aside className="ca-card ca-insp ca-fade" aria-label="Evidence inspector" key={claim.id}>
      <div className="ca-insp__head">
        <div style={{ minWidth: 0 }}>
          <div className="ca-eyebrow" style={{ marginBottom: 6 }}><Icon name="eye" size={13} />Evidence inspector · claim {n}</div>
          <StatusBadge status={st.status} provisional={st.provisional} />
        </div>
        <div className="ca-row" style={{ gap: 8, flexWrap: "nowrap" }}>
          {st.score != null && <div className={`ca-insp__score ca-t-${toneFor(st.score)}`}>{Math.round(st.score)}<small>/100</small></div>}
          <button className="ca-btn ca-btn--ghost ca-btn--icon ca-btn--sm" onClick={onClose} aria-label="Close inspector"><Icon name="x" size={14} /></button>
        </div>
      </div>

      <Sec n="1" title="Resume statement">
        <blockquote className="ca-quote">{claim.source_text}</blockquote>
        <p className="ca-claim__src" style={{ marginTop: 8 }}>{claim.id} · {claim.section || "resume"} · line {claim.line_index != null ? claim.line_index + 1 : "?"} · chars {claim.start}–{claim.end}</p>
      </Sec>

      <Sec n="2" title="Competency">
        <div className="ca-row" style={{ gap: 6 }}>
          <span className="ca-badge">{claim.competency_name}</span>
          {claim.skills.map(s => <span key={s} className={`ca-tag${a.jd.skills?.includes(s) ? " ca-tag--match" : ""}`}>{s}</span>)}
        </div>
      </Sec>

      <Sec n="3" title={`Questions & your answers (${questions.length})`}>
        {questions.length === 0 ? <p className="ca-faint">This claim wasn't discussed in the interview{a.status === "completed" ? "" : " yet"}.</p> : questions.map(q => {
          const ans = answerFor[q.id];
          const ev = ans ? evidence.filter(e => e.message_id === ans.id) : [];
          return (
            <div className="ca-qa" key={q.id}>
              <div className="ca-qa__q" id={`msg-${q.id}`}><span className="ca-qa__who">Q</span>
                <div>{q.content}{critName[q.criterion_id] && <span className="ca-qa__crit">Probing: {critName[q.criterion_id]}</span>}</div></div>
              {ans ? (
                <div className={`ca-qa__a${focusMsg === ans.id ? " is-focus" : ""}`} id={`msg-${ans.id}`}><span className="ca-qa__who">A</span>
                  <span><Highlighted text={ans.content} evidence={ev} /></span></div>
              ) : <div className="ca-qa__a ca-faint"><span className="ca-qa__who">A</span>Not answered.</div>}
            </div>
          );
        })}
      </Sec>

      <Sec n="4" title={`Supporting evidence (${positive.length})`}>
        {positive.length === 0 ? <p className="ca-faint">No excerpt from your answers demonstrated a criterion for this claim.</p> : (
          <ul className="ca-evlist">
            {positive.map(e => (
              <li key={e.id}>
                <q>{e.quote}</q>
                <div className="ca-evlist__meta">
                  {e.criterion_ids.map(cid => <span key={cid} className="ca-badge ca-badge--sm ca-badge--good">{critName[cid] || cid}</span>)}
                  <a href={`#msg-${e.message_id}`} className="ca-link" style={{ fontSize: 12, marginLeft: "auto" }}
                     onClick={(ev) => { ev.preventDefault(); document.getElementById(`msg-${e.message_id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                    In answer<Icon name="chevronRight" size={12} /></a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Sec>

      <Sec n="5" title={`Missing rubric criteria (${missing.length})`}>
        {missing.length === 0 ? <p className="ca-faint">Every criterion was demonstrated.</p> : (
          <ul className="ca-missing">
            {missing.map(r => (
              <li key={r.criterion_id}>
                <span>{r.criterion_name}<span className="ca-missing__d">{r.description}</span></span>
                <span className="ca-row" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                  {r.label ? <LabelBadge label={r.label} /> : null}{r.gap_type ? <GapBadge gap={r.gap_type} /> : <span className="ca-mono ca-faint" style={{ fontSize: 11 }}>{r.points_possible} pts</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {results.length > 0 && (
          <p className="ca-method" style={{ marginTop: 10 }}>
            Score {results.reduce((s, r) => s + r.points_awarded, 0)} of {results.reduce((s, r) => s + r.points_possible, 0)} rubric points.
          </p>
        )}
      </Sec>

      <Sec n="6" title="Assessment explanation">
        <p className="ca-muted">{claim.explanation || "Provisional. The rubric evaluation and explanation are generated when the interview ends."}</p>
      </Sec>

      <Sec n="7" title="Recommended improvement">
        {claim.recommendation ? <div className="ca-reco">{claim.recommendation}</div> : <p className="ca-faint">Available after the interview ends.</p>}
        {a.status === "completed" && missing.length > 0 && (
          <Link to={`/agent/a/${a.id}/remediation`} className="ca-link" style={{ marginTop: 10, fontSize: 13 }}>Practice tasks for this claim<Icon name="chevronRight" size={13} /></Link>
        )}
      </Sec>
    </aside>
  );
}

function Highlighted({ text, evidence }) {
  const spans = [...evidence].filter(e => e.start != null).sort((x, y) => x.start - y.start);
  const parts = [];
  let pos = 0;
  spans.forEach(e => {
    if (e.start < pos) return;
    if (e.start > pos) parts.push(<span key={`t${pos}`}>{text.slice(pos, e.start)}</span>);
    parts.push(<mark key={e.id} className={`ca-ev ca-ev--${e.signal}`} title={e.note || undefined}>{text.slice(e.start, e.end)}</mark>);
    pos = e.end;
  });
  if (pos < text.length) parts.push(<span key="end">{text.slice(pos)}</span>);
  return <>{parts}</>;
}
