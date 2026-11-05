import React, { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GAP, useAssessment } from "./agentApi";
import { AgentShell, AssessmentGate, PageHead } from "./Shell";
import { EmptyState, GapBadge, Icon, Ring, Spinner, StatusBadge, StatusBar, TONE_HEX, toneFor } from "./ui";

export default function Report() {
  const { id } = useParams();
  const state = useAssessment(id);
  const evaluating = !!state.data?.evaluating;
  const { reload } = state;

  // The final rubric evaluation runs in the background on the server; refresh until it lands.
  useEffect(() => {
    if (!evaluating) return undefined;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [evaluating, reload]);

  return (
    <AssessmentGate state={state} title="Report">
      {(a) => (
        <AgentShell assessment={a} title="Report">
          {a.report ? <ReportView a={a} /> : evaluating ? (
            <div className="ca-empty" role="status" aria-live="polite">
              <span className="ca-empty__icon"><Spinner /></span>
              <h3>Evaluating your answers</h3>
              <p>The model is labelling each rubric criterion against the evidence from your answers, and the backend is computing the scores. This usually takes under a minute.</p>
            </div>
          ) : (
            <EmptyState icon="chart" title="No report yet" action={<Link to={`/agent/a/${a.id}/interview`} className="ca-btn ca-btn--primary">Go to interview</Link>}>
              The report is generated from the rubric when the interview ends.
            </EmptyState>
          )}
        </AgentShell>
      )}
    </AssessmentGate>
  );
}

function GapColumn({ a, type, title, icon, empty, heat }) {
  const items = a.report.gaps.filter(g => g.gap_type === type);
  const claims = Object.fromEntries(a.claims.map(c => [c.id, c]));
  const answerFor = (qid) => a.messages.find(m => m.reply_to === qid);
  return (
    <section className="ca-card">
      <div className="ca-card__head"><span className="ca-card__title"><Icon name={icon} />{title}</span><span className="ca-mono ca-faint">{items.length}</span></div>
      <p className="ca-help" style={{ padding: "10px 18px 0" }}>{GAP[type].hint}</p>
      {items.length === 0 ? <p className="ca-card__body ca-faint">{empty}</p> : (
        <ul className="ca-findings">
          {items.map((g, i) => {
            const ans = g.message_ids.map(answerFor).find(Boolean);
            return (
              <li key={i}>
                <div className="ca-findings__top"><strong>{g.criterion_name}</strong><span className="ca-mono ca-faint" style={{ fontSize: 11.5 }}>−{g.points_lost} pts</span></div>
                <span className="ca-findings__claim">{claims[g.claim_id]?.summary}</span>
                <Link to={heat(g.claim_id, ans?.id || g.message_ids[0])} className="ca-link" style={{ fontSize: 12.5 }}>
                  {g.message_ids.length ? "See the exchange" : "Not asked: open claim"}<Icon name="chevronRight" size={12} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ReportView({ a }) {
  const r = a.report;
  const heat = (claimId, msgId) => `/agent/a/${a.id}/heatmap?claim=${claimId}${msgId ? `&msg=${msgId}` : ""}`;
  const claims = Object.fromEntries(a.claims.map(c => [c.id, c]));
  const counts = r.status_counts;
  const coveragePct = r.coverage.total ? Math.round((r.coverage.interviewed / r.coverage.total) * 100) : 0;
  const strongest = [...r.competencies].sort((x, y) => y.score - x.score).filter(c => c.score >= 70);

  return (
    <>
      <PageHead eyebrow={<><Icon name="chart" size={13} />Technical evaluation report</>} title={a.target_role}
                subtitle={`${a.filename} · generated ${r.generated_at} UTC${r.ended === "ended_early" ? " · interview ended early" : ""}`}
                actions={<span className="ca-noprint ca-actions">
                  <button className="ca-btn ca-btn--secondary ca-btn--sm" onClick={() => window.print()}><Icon name="printer" size={14} />Print / save PDF</button>
                  <Link to={`/agent/a/${a.id}/heatmap`} className="ca-btn ca-btn--secondary ca-btn--sm"><Icon name="target" size={14} />Heatmap</Link>
                  <Link to={`/agent/a/${a.id}/remediation`} className="ca-btn ca-btn--primary ca-btn--sm"><Icon name="listChecks" size={14} />Practise gaps</Link>
                </span>} />

      <div className="ca-rep-top">
        <section className="ca-card ca-readiness" aria-label="Readiness score">
          <Ring value={r.readiness_score} size={128} sub="of 100" label="Readiness" />
          <div className="ca-stack" style={{ gap: 6 }}>
            <span className="ca-eyebrow" style={{ margin: 0 }}>Readiness</span>
            <span className={`ca-readiness__band ca-t-${toneFor(r.readiness_score)}`}>{r.readiness_band}</span>
            <p className="ca-help">Job-relevance-weighted mean of {r.coverage.interviewed} interviewed claim{r.coverage.interviewed === 1 ? "" : "s"}.</p>
          </div>
        </section>
        <section className="ca-card" aria-label="Claim verdicts">
          <div className="ca-statgrid">
            <div><strong>{coveragePct}%</strong><span>Evidence coverage</span><span className="ca-faint" style={{ fontWeight: 500 }}>{r.coverage.interviewed}/{r.coverage.total} claims · {r.coverage.answers} answers</span></div>
            <div><strong className="ca-t-good">{counts.SUPPORTED || 0}</strong><span>Supported</span></div>
            <div><strong className="ca-t-mid">{counts["PARTIALLY SUPPORTED"] || 0}</strong><span>Partially supported</span></div>
            <div><strong className="ca-t-low">{counts["INSUFFICIENT EVIDENCE"] || 0}</strong><span>Insufficient evidence</span></div>
          </div>
          <div className="ca-card__foot"><StatusBar counts={counts} total={r.coverage.total} /></div>
        </section>
      </div>

      <div className="ca-grid ca-grid--2" style={{ marginTop: 16, alignItems: "start" }}>
        <section className="ca-card">
          <div className="ca-card__head"><span className="ca-card__title"><Icon name="chart" />Competency breakdown</span></div>
          <div className="ca-card__body">
            {r.competencies.length === 0 ? <p className="ca-faint">No competencies were assessed.</p> : (
              <div className="ca-chart" style={{ height: Math.max(150, r.competencies.length * 48) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.competencies} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" domain={[0, 100]} ticks={[0, 35, 70, 100]} tick={{ fill: "#7D8594", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fill: "#B4BAC6", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} formatter={(v, _n, p) => [`${v}/100 (${p.payload.awarded}/${p.payload.possible} pts)`, "Score"]}
                             contentStyle={{ background: "#14161C", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, fontSize: 12 }}
                             labelStyle={{ color: "#F4F5F7" }} itemStyle={{ color: "#B4BAC6" }} />
                    <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
                      {r.competencies.map(c => <Cell key={c.competency} fill={TONE_HEX[toneFor(c.score)]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        <section className="ca-card">
          <div className="ca-card__head"><span className="ca-card__title"><Icon name="checkCircle" />Strongest areas</span><span className="ca-mono ca-faint">{r.strengths.length}</span></div>
          {strongest.length > 0 && (
            <div className="ca-tags" style={{ padding: "12px 18px 0" }}>
              {strongest.map(c => <span key={c.competency} className="ca-badge ca-badge--good">{c.name} · {Math.round(c.score)}</span>)}
            </div>
          )}
          {r.strengths.length === 0 ? <p className="ca-card__body ca-faint">No criterion was fully demonstrated yet.</p> : (
            <ul className="ca-findings">
              {r.strengths.map((s, i) => (
                <li key={i}>
                  <div className="ca-findings__top"><strong>{s.criterion_name}</strong>
                    <Link to={heat(s.claim_id, s.message_id)} className="ca-link" style={{ fontSize: 12 }}>Your answer<Icon name="chevronRight" size={12} /></Link></div>
                  <q>{s.quote}</q>
                  <span className="ca-findings__claim">{claims[s.claim_id]?.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="ca-grid ca-grid--3" style={{ marginTop: 16 }}>
        <GapColumn a={a} heat={heat} type="knowledge_gap" title="Knowledge gaps" icon="book" empty="No knowledge gaps found." />
        <GapColumn a={a} heat={heat} type="weak_articulation" title="Communication gaps" icon="message" empty="No articulation gaps found." />
        <GapColumn a={a} heat={heat} type="insufficient_evidence" title="Insufficient evidence" icon="help" empty="Every assessed criterion had evidence." />
      </div>

      <section className="ca-card" style={{ marginTop: 16 }}>
        <div className="ca-card__head"><span className="ca-card__title"><Icon name="layers" />Claim-by-claim evidence</span></div>
        <div className="ca-tablewrap">
          <table className="ca-table ca-table--stack">
            <thead><tr><th>Claim</th><th>Competency</th><th>Verdict</th><th className="ca-num">Score</th><th className="ca-num">Evidence</th><th><span className="ca-sr">Open</span></th></tr></thead>
            <tbody>
              {a.claims.map(c => {
                const ev = a.evidence.filter(e => e.claim_id === c.id && e.signal === "positive").length;
                return (
                  <tr key={c.id}>
                    <td className="ca-td-wide" data-label="Claim">{c.source_text}<div className="ca-claim__src" style={{ marginTop: 4 }}>{c.id}</div></td>
                    <td className="ca-muted" data-label="Competency">{c.competency_name}</td>
                    <td data-label="Verdict"><StatusBadge status={c.status} small /></td>
                    <td className={`ca-num${c.interviewed ? ` ca-t-${toneFor(c.score)}` : ""}`} style={{ fontWeight: 700 }} data-label="Score">{c.interviewed ? Math.round(c.score) : "—"}</td>
                    <td className="ca-num ca-muted" data-label="Evidence">{ev}</td>
                    <td className="ca-noprint" style={{ textAlign: "right" }}><Link to={heat(c.id)} className="ca-btn ca-btn--ghost ca-btn--sm">Inspect<Icon name="chevronRight" size={13} /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ca-card ca-card__body" style={{ marginTop: 16 }}>
        <h3 className="ca-insp__h" style={{ marginBottom: 8 }}><Icon name="scale" size={13} />How this was scored</h3>
        <p className="ca-method">{r.method} Thresholds: Supported ≥ 70, Partially supported ≥ 35. Gap counts: {Object.entries(r.gap_type_counts).map(([k, v]) => `${GAP[k]?.label} ${v}`).join(", ")}.
          Model provider: {a.provider?.label}{a.provider_usage?.some(u => u.fallbacks) ? " (some steps used the offline fallback)" : ""}.</p>
        <div className="ca-tags" style={{ marginTop: 10 }}>{Object.keys(GAP).map(k => <GapBadge key={k} gap={k} />)}</div>
      </section>
    </>
  );
}
