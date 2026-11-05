import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getUser } from "../utils/storage";
import { agentApi, GAP } from "./agentApi";
import { AgentShell, PageHead } from "./Shell";
import { Alert, EmptyState, GapBadge, Icon, PageSkeleton, Progress, Ring, StatusBar, toneFor } from "./ui";

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(String(s).replace(" ", "T") + (String(s).includes("Z") || String(s).includes("+") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function destination(a) {
  if (a.status === "completed" || a.status === "evaluating") return `/agent/a/${a.id}/report`;
  if (a.status === "interviewing") return `/agent/a/${a.id}/interview`;
  return `/agent/a/${a.id}`;
}

export default function Dashboard() {
  const [items, setItems] = useState(null);
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState("");
  const user = getUser();

  const load = useCallback(async () => {
    setError("");
    try {
      const { assessments } = await agentApi.list();
      setItems(assessments);
      const done = assessments.find(a => a.status === "completed");
      setLatest(done ? await agentApi.get(done.id) : null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return <AgentShell title="Dashboard"><Alert title="We couldn't load your assessments" action={<button className="ca-btn ca-btn--secondary ca-btn--sm" onClick={load}>Try again</button>}>{error}</Alert></AgentShell>;
  }
  if (!items) return <AgentShell title="Dashboard"><PageSkeleton /></AgentShell>;

  const inProgress = items.find(a => a.status === "interviewing");
  const completed = items.filter(a => a.status === "completed");
  const report = latest?.report;
  const openTasks = latest ? latest.remediation.filter(t => t.status !== "done").length : 0;
  const greeting = user?.email ? `Welcome back, ${user.email.split("@")[0]}` : "Your assessment workspace";

  return (
    <AgentShell title="Dashboard">
      <section className="ca-hello">
        <div>
          <div className="ca-eyebrow"><Icon name="dashboard" size={13} />Dashboard</div>
          <h1>{greeting}</h1>
          <p>{items.length === 0
            ? "Run your first audit to find out which resume claims you can defend in an interview."
            : inProgress ? "You have an interview in progress. Pick up where you left off, or start a new assessment for another role."
              : "Start a new assessment for another role, or review your latest evidence and practice tasks."}</p>
        </div>
        <div className="ca-actions">
          {inProgress && <Link to={`/agent/a/${inProgress.id}/interview`} className="ca-btn ca-btn--secondary ca-btn--lg"><Icon name="message" />Resume interview</Link>}
          <Link to="/agent/new" className="ca-btn ca-btn--primary ca-btn--lg"><Icon name="plus" />New assessment</Link>
        </div>
      </section>

      {items.length === 0 ? (
        <div className="ca-stack">
          <div className="ca-card">
            <div className="ca-card__head"><span className="ca-card__title"><Icon name="book" />What an assessment involves</span></div>
            <div className="ca-starter">
              <div><strong><Icon name="upload" />1 · Upload</strong><p>Your resume PDF and the job description. Claims are extracted and matched to the role's skills.</p></div>
              <div><strong><Icon name="message" />2 · Interview</strong><p>About ten targeted questions on the claims most relevant to the job, with follow-ups.</p></div>
              <div><strong><Icon name="target" />3 · Evidence</strong><p>A heatmap, report and practice tasks, each linked to the exact answers behind it.</p></div>
            </div>
          </div>
          <EmptyState icon="layers" title="No assessments yet" action={<Link to="/agent/new" className="ca-btn ca-btn--primary">Start your first assessment</Link>}>
            Your readiness, competency breakdown and open skill gaps will appear here after your first interview.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="ca-grid ca-grid--4">
            <div className="ca-card ca-kpi">
              <span className="ca-kpi__label"><Icon name="layers" size={13} />Assessments</span>
              <span className="ca-kpi__value">{items.length}</span>
              <span className="ca-kpi__sub">{completed.length} completed{inProgress ? " · 1 in progress" : ""}</span>
            </div>
            <div className="ca-card ca-kpi">
              <span className="ca-kpi__label"><Icon name="chart" size={13} />Latest readiness</span>
              <span className={`ca-kpi__value${report ? ` ca-t-${toneFor(report.readiness_score)}` : ""}`}>{report ? Math.round(report.readiness_score) : "—"}</span>
              <span className="ca-kpi__sub">{report ? `${report.readiness_band} · ${latest.target_role}` : "No completed assessment yet"}</span>
            </div>
            <div className="ca-card ca-kpi">
              <span className="ca-kpi__label"><Icon name="checkCircle" size={13} />Claims supported</span>
              <span className="ca-kpi__value">{report ? `${report.status_counts.SUPPORTED || 0}/${report.coverage.total}` : "—"}</span>
              <span className="ca-kpi__sub">{report ? `${report.coverage.interviewed} interviewed in latest assessment` : "Complete an interview to see this"}</span>
            </div>
            <div className="ca-card ca-kpi">
              <span className="ca-kpi__label"><Icon name="listChecks" size={13} />Open practice tasks</span>
              <span className="ca-kpi__value">{latest ? openTasks : "—"}</span>
              <span className="ca-kpi__sub">{latest ? `${latest.remediation.length - openTasks} of ${latest.remediation.length} done` : "Generated after an interview"}</span>
            </div>
          </div>

          {latest && report && (
            <div className="ca-dash">
              <div className="ca-card">
                <div className="ca-card__head">
                  <span className="ca-card__title"><Icon name="chart" />Skill readiness · {latest.target_role}</span>
                  <Link to={`/agent/a/${latest.id}/report`} className="ca-link">Full report<Icon name="chevronRight" size={14} /></Link>
                </div>
                <div className="ca-card__body" style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: 24, alignItems: "center" }}>
                  <Ring value={report.readiness_score} size={112} sub="readiness" label="Readiness" />
                  <div className="ca-stack" style={{ gap: 12 }}>
                    {report.competencies.length === 0 && <p className="ca-muted">No competencies were assessed.</p>}
                    {report.competencies.map(c => (
                      <div key={c.competency}>
                        <div className="ca-meter__label"><span>{c.name}</span><span className="ca-mono">{Math.round(c.score)}</span></div>
                        <Progress value={c.score} tone={toneFor(c.score)} label={`${c.name} ${Math.round(c.score)} of 100`} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ca-card">
                <div className="ca-card__head">
                  <span className="ca-card__title"><Icon name="warn" />Outstanding skill gaps</span>
                  <Link to={`/agent/a/${latest.id}/remediation`} className="ca-link">Practise<Icon name="chevronRight" size={14} /></Link>
                </div>
                {report.gaps.length === 0 ? <div className="ca-card__body ca-muted">No gaps in the assessed claims.</div> : (
                  <ul className="ca-gaplist">
                    {report.gaps.slice(0, 5).map((g, i) => {
                      const claim = latest.claims.find(c => c.id === g.claim_id);
                      return (
                        <li key={i}>
                          <div className="ca-gaplist__main">
                            <strong>{g.criterion_name}</strong>
                            <span>{claim?.summary}</span>
                          </div>
                          <GapBadge gap={g.gap_type} />
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="ca-card__foot ca-legend">
                  {Object.entries(report.gap_type_counts).map(([k, n]) => <span key={k}>{GAP[k]?.label}: <b className="ca-mono">{n}</b></span>)}
                </div>
              </div>
            </div>
          )}

          <div className="ca-card" style={{ marginTop: 16 }}>
            <div className="ca-card__head"><span className="ca-card__title"><Icon name="clock" />Assessment history</span></div>
            <div className="ca-tablewrap">
              <table className="ca-table ca-table--stack">
                <thead><tr><th>Role</th><th>Date</th><th>Status</th><th>Claim verdicts</th><th className="ca-num">Readiness</th><th><span className="ca-sr">Open</span></th></tr></thead>
                <tbody>
                  {items.map(a => {
                    const counts = a.status_counts || {};
                    const done = a.status === "completed";
                    return (
                      <tr key={a.id}>
                        <td>
                          <Link to={destination(a)} className="ca-rowlink">
                            <div className="ca-hist-claim">{a.target_role || "Untitled role"}</div>
                            <div className="ca-faint ca-mono" style={{ fontSize: 11 }}>{a.filename}</div>
                          </Link>
                        </td>
                        <td className="ca-muted" data-label="Date" style={{ whiteSpace: "nowrap" }}>{fmtDate(a.created_at)}</td>
                        <td>{done ? <span className="ca-badge ca-badge--sm ca-badge--good"><span className="ca-dot" />Completed</span>
                          : a.status === "interviewing" ? <span className="ca-badge ca-badge--sm ca-badge--accent ca-badge--live"><span className="ca-dot" />Interviewing</span>
                            : <span className="ca-badge ca-badge--sm ca-badge--none"><span className="ca-dot" />Claims ready</span>}</td>
                        <td className="ca-td-mid" data-label="Verdicts">
                          {done ? (
                            <div className="ca-stack" style={{ gap: 6 }}>
                              <StatusBar counts={counts} total={a.claim_count} />
                              <span className="ca-faint" style={{ fontSize: 11.5 }}>{counts.SUPPORTED || 0} supported · {counts["PARTIALLY SUPPORTED"] || 0} partial · {counts["INSUFFICIENT EVIDENCE"] || 0} insufficient</span>
                            </div>
                          ) : <span className="ca-faint">{a.claim_count} claims extracted</span>}
                        </td>
                        <td className={`ca-num${done ? ` ca-t-${toneFor(a.readiness_score || 0)}` : ""}`} style={{ fontWeight: 700 }} data-label="Readiness">{done ? Math.round(a.readiness_score || 0) : "—"}</td>
                        <td className="ca-td-action">
                          <Link to={destination(a)} className="ca-btn ca-btn--ghost ca-btn--sm">
                            {done ? "Report" : a.status === "interviewing" ? "Resume" : "Review"}<Icon name="chevronRight" size={14} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <p className="ca-method" style={{ marginTop: 16 }}>Assessments are stored {user ? "on your account" : "for this browser (sign in to keep them across devices)"}.</p>
    </AgentShell>
  );
}

