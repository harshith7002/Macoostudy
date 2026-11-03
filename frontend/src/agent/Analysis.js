import React from "react";
import { Link, useParams } from "react-router-dom";
import { claimStatus, useAssessment } from "./agentApi";
import { Stepper } from "./NewAssessment";
import { AgentShell, AssessmentGate, PageHead } from "./Shell";
import { Icon, StatusBadge } from "./ui";

export default function Analysis() {
  const { id } = useParams();
  const state = useAssessment(id);
  return (
    <AssessmentGate state={state} title="Review claims">
      {(a) => <Review a={a} />}
    </AssessmentGate>
  );
}

function Review({ a }) {
  const planned = new Set(a.interview_plan);
  const jdSkills = a.jd.skills || [];
  const ordered = [...a.claims].sort((x, y) => {
    const px = a.interview_plan.indexOf(x.id), py = a.interview_plan.indexOf(y.id);
    return (px < 0 ? 99 : px) - (py < 0 ? 99 : py) || x.order - y.order;
  });
  const coverage = jdSkills.map(s => ({ skill: s, claims: a.claims.filter(c => c.skills.includes(s)) }));
  const covered = coverage.filter(c => c.claims.length).length;
  const done = a.status === "completed";
  const started = !!a.session;
  const estimate = a.interview_plan.length * 2 + Math.max(0, a.interview_plan.length - 1);

  return (
    <AgentShell assessment={a} title="Review claims">
      <Stepper current={done ? 4 : started ? 3 : 2} />
      <PageHead eyebrow={<><Icon name="file" size={13} />{a.filename}</>} title={`${a.claims.length} claims extracted for ${a.target_role}`}
                subtitle="Each claim is an exact span of your resume. The ones marked In interview are probed first, most relevant to the job description at the top." />
      <div className="ca-review">
        <section className="ca-card" aria-labelledby="claims-h">
          <div className="ca-card__head">
            <span className="ca-card__title" id="claims-h"><Icon name="layers" />Technical claims</span>
            <span className="ca-faint" style={{ fontSize: 12 }}>{planned.size} in interview · {a.claims.length - planned.size} not probed this round</span>
          </div>
          <ol className="ca-claimlist" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ordered.map((c, i) => {
              const st = claimStatus(c);
              return (
                <li key={c.id} className="ca-claim">
                  <span className="ca-claim__n">{String(i + 1).padStart(2, "0")}</span>
                  <div style={{ minWidth: 0 }}>
                    <p className="ca-claim__text">{c.source_text}</p>
                    <div className="ca-claim__meta">
                      <span className="ca-badge ca-badge--sm">{c.competency_name}</span>
                      {c.skills.map(s => (
                        <span key={s} className={`ca-tag${jdSkills.includes(s) ? " ca-tag--match" : ""}`}
                              title={jdSkills.includes(s) ? "Required by the job description" : "Mentioned in the claim"}>{s}</span>
                      ))}
                    </div>
                    <div className="ca-claim__src" style={{ marginTop: 8 }}>
                      {c.id} · {c.section || "resume"} · line {c.line_index != null ? c.line_index + 1 : "?"} · chars {c.start}–{c.end}
                    </div>
                  </div>
                  <div className="ca-claim__side">
                    {planned.has(c.id) ? <span className="ca-badge ca-badge--sm ca-badge--accent"><Icon name="message" size={11} />In interview</span>
                      : <span className="ca-badge ca-badge--sm" data-tip="Only the most job-relevant claims are probed in one interview. This one will show as insufficient evidence.">Not probed</span>}
                    {(st.status || done) && <StatusBadge status={st.status} provisional={st.provisional} small />}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="ca-stack ca-sticky">
          <div className="ca-card">
            <div className="ca-card__head"><span className="ca-card__title"><Icon name="message" />{done ? "Assessment complete" : started ? "Interview in progress" : "Start technical assessment"}</span></div>
            <div className="ca-card__body ca-stack" style={{ gap: 12 }}>
              {done ? (
                <>
                  <p className="ca-muted">Readiness {Math.round(a.readiness_score || 0)}/100. Every verdict links back to the answers behind it.</p>
                  <Link to={`/agent/a/${a.id}/report`} className="ca-btn ca-btn--primary ca-btn--block">View report<Icon name="arrowRight" /></Link>
                  <Link to={`/agent/a/${a.id}/heatmap`} className="ca-btn ca-btn--secondary ca-btn--block">Open heatmap</Link>
                </>
              ) : (
                <>
                  <dl className="ca-kv" style={{ padding: 0 }}>
                    <div><dt>Claims to probe</dt><dd>{planned.size}</dd></div>
                    <div><dt>Questions</dt><dd>about {estimate}</dd></div>
                    <div><dt>Per claim</dt><dd>2–3, adaptive</dd></div>
                  </dl>
                  <p className="ca-help">Answer like you would to a senior engineer: what you built, why, what you traded off, what broke. You can end the interview at any time.</p>
                  <Link to={`/agent/a/${a.id}/interview`} className="ca-btn ca-btn--primary ca-btn--lg ca-btn--block">
                    {started ? "Resume interview" : "Start interview"}<Icon name="arrowRight" />
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="ca-card">
            <div className="ca-card__head">
              <span className="ca-card__title"><Icon name="target" />Job requirements</span>
              {jdSkills.length > 0 && <span className="ca-faint ca-mono" style={{ fontSize: 11.5 }}>{covered}/{jdSkills.length} claimed</span>}
            </div>
            {jdSkills.length === 0 ? (
              <div className="ca-card__body ca-muted">No known technical skills were detected in the job description, so claims are ordered by resume position.</div>
            ) : (
              <ul className="ca-jdreq">
                {coverage.map(({ skill, claims }) => (
                  <li key={skill}>
                    <span className={`ca-tag${claims.length ? " ca-tag--match" : " ca-tag--miss"}`}>{skill}</span>
                    <span className={claims.length ? "ca-muted" : "ca-faint"} style={{ fontSize: 12 }}>
                      {claims.length ? `${claims.length} claim${claims.length === 1 ? "" : "s"}` : "No claim mentions this"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </AgentShell>
  );
}
