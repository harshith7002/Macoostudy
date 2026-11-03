import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { agentApi, GAP, useAssessment } from "./agentApi";
import { AgentShell, AssessmentGate, PageHead } from "./Shell";
import { EmptyState, GapBadge, Icon, Progress, Spinner, useToast } from "./ui";

export default function Remediation() {
  const { id } = useParams();
  const state = useAssessment(id);
  return <AssessmentGate state={state} title="Remediation">{(a) => <Workspace a={a} setData={state.setData} />}</AssessmentGate>;
}

function Workspace({ a, setData }) {
  const toast = useToast();
  const [gapFilter, setGapFilter] = useState("all");
  const [saving, setSaving] = useState("");
  const tasks = a.remediation;
  const doneCount = tasks.filter(t => t.status === "done").length;

  const toggle = async (t) => {
    const status = t.status === "done" ? "todo" : "done";
    setSaving(t.id);
    try {
      await agentApi.setTask(a.id, t.id, status);
      setData(d => ({ ...d, remediation: d.remediation.map(x => (x.id === t.id ? { ...x, status } : x)) }));
      toast(status === "done" ? "Marked as practised." : "Moved back to pending.");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSaving("");
    }
  };

  if (a.status !== "completed") {
    return (
      <AgentShell assessment={a} title="Remediation">
        <EmptyState icon="listChecks" title="Finish the interview first" action={<Link to={`/agent/a/${a.id}/interview`} className="ca-btn ca-btn--primary">Go to interview</Link>}>
          Practice tasks are generated from the final rubric results.
        </EmptyState>
      </AgentShell>
    );
  }

  const visible = tasks.filter(t => gapFilter === "all" || t.gap_type === gapFilter);
  const pending = visible.filter(t => t.status !== "done");
  const done = visible.filter(t => t.status === "done");

  return (
    <AgentShell assessment={a} title="Remediation">
      <PageHead eyebrow={<><Icon name="listChecks" size={13} />Remediation workspace</>} title="Practise the gaps the interview found"
                subtitle="Written and spoken exercises, one per gap. Nothing here runs code."
                actions={<Link to={`/agent/a/${a.id}/report`} className="ca-btn ca-btn--secondary ca-btn--sm"><Icon name="chart" size={14} />Report</Link>} />

      {tasks.length === 0 ? (
        <EmptyState icon="checkCircle" title="Nothing to practise">Every assessed criterion was demonstrated.</EmptyState>
      ) : (
        <>
          <div className="ca-remhead">
            <div className="ca-seg" role="group" aria-label="Filter by gap type">
              {[["all", "All gaps"], ...Object.entries(GAP).map(([k, v]) => [k, v.label])].map(([k, l]) => (
                <button key={k} type="button" aria-pressed={gapFilter === k} onClick={() => setGapFilter(k)}>
                  {l}<span className="ca-seg__n">{k === "all" ? tasks.length : tasks.filter(t => t.gap_type === k).length}</span>
                </button>
              ))}
            </div>
            <div>
              <div className="ca-meter__label"><span style={{ fontWeight: 600 }}>Practised</span><span className="ca-mono ca-faint">{doneCount}/{tasks.length}</span></div>
              <Progress value={(doneCount / tasks.length) * 100} tone="good" label="Tasks practised" />
            </div>
          </div>

          <h2 className="ca-insp__h" style={{ margin: "8px 0 10px" }}>Pending · {pending.length}</h2>
          {pending.length === 0 && <p className="ca-faint" style={{ marginBottom: 16 }}>Nothing pending{gapFilter !== "all" ? " for this gap type" : ""}.</p>}
          <div className="ca-stack">{pending.map(t => <TaskCard key={t.id} a={a} t={t} onToggle={toggle} saving={saving === t.id} />)}</div>

          {done.length > 0 && (
            <>
              <h2 className="ca-insp__h" style={{ margin: "28px 0 10px" }}>Completed · {done.length}</h2>
              <div className="ca-stack">{done.map(t => <TaskCard key={t.id} a={a} t={t} onToggle={toggle} saving={saving === t.id} />)}</div>
            </>
          )}
        </>
      )}
    </AgentShell>
  );
}

function TaskCard({ a, t, onToggle, saving }) {
  const claim = a.claims.find(c => c.id === t.claim_id);
  const crit = (a.criteria?.[claim?.competency] || []).find(c => c.id === t.criterion_id);
  const isDone = t.status === "done";
  return (
    <article className={`ca-card ca-task${isDone ? " is-done" : ""}`} aria-label={t.title}>
      <div className="ca-task__head">
        <div style={{ minWidth: 0 }}>
          <div className="ca-row" style={{ gap: 8, marginBottom: 6 }}>
            <GapBadge gap={t.gap_type} />
            {isDone && <span className="ca-badge ca-badge--sm ca-badge--good"><Icon name="check" size={11} />Practised</span>}
          </div>
          <h3 className="ca-task__title">{t.title}</h3>
          {claim && <p className="ca-task__claim">From: “{claim.summary}” · <Link className="ca-link" to={`/agent/a/${a.id}/heatmap?claim=${claim.id}`}>evidence</Link></p>}
        </div>
        <button className={`ca-btn ca-btn--sm ${isDone ? "ca-btn--ghost" : "ca-btn--secondary"}`} onClick={() => onToggle(t)} disabled={saving} aria-pressed={isDone}>
          {saving ? <Spinner /> : <Icon name={isDone ? "refresh" : "check"} size={14} />}{isDone ? "Mark pending" : "Mark practised"}
        </button>
      </div>
      <div className="ca-task__grid">
        <div className="ca-task__cell"><h4><Icon name="target" size={12} />Identified skill gap</h4>
          <p><b style={{ color: "var(--tx-1)" }}>{crit?.name || t.criterion_id}</b>{crit ? ` · ${crit.points} rubric points` : ""}</p></div>
        <div className="ca-task__cell"><h4><Icon name="help" size={12} />Why it matters</h4>
          <p>{GAP[t.gap_type]?.hint} {crit?.description}</p></div>
        <div className="ca-task__cell ca-task__cell--wide"><h4><Icon name="book" size={12} />Technical explanation</h4><p>{t.explanation}</p></div>
        <div className="ca-task__cell"><h4><Icon name="layers" size={12} />Engineering scenario</h4><p>{t.scenario}</p></div>
        <div className="ca-task__cell"><h4><Icon name="file" size={12} />Practical task</h4><p>{t.exercise}</p></div>
        <div className="ca-task__cell ca-task__cell--wide"><h4><Icon name="listChecks" size={12} />Expected solution criteria</h4>
          <ul>{(t.solution_criteria || []).map((s, i) => <li key={i}><Icon name="check" size={13} />{s}</li>)}</ul></div>
      </div>
      <div className="ca-task__fq"><h4 className="ca-insp__h" style={{ margin: "0 0 4px", color: "var(--accent-2)" }}><Icon name="reply" size={12} />Follow-up assessment question</h4>
        <p>{t.follow_up_question}</p></div>
    </article>
  );
}
