import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { agentApi } from "./agentApi";
import { Alert, Icon, PageSkeleton } from "./ui";

export function useDocTitle(title) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · Macoostudy Career Agent` : "Macoostudy Career Agent";
    return () => { document.title = prev; };
  }, [title]);
}

/** Which model actually ran. Never claims Meta unless the backend reports it. */
export function ProviderBadge({ provider, usage }) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (provider) return;
    agentApi.provider().then(setLive).catch(() => setLive({ error: true }));
  }, [provider]);
  const p = provider || live;
  if (!p) return <div className="ca-provider"><div className="ca-provider__row ca-faint"><Icon name="cpu" size={14} />Checking model…</div></div>;
  if (p.error) return <div className="ca-provider"><div className="ca-provider__row ca-t-low"><Icon name="alert" size={14} />API unreachable</div></div>;
  const fallbacks = (usage || []).reduce((n, u) => n + (u.fallbacks || 0), 0);
  const sub = p.is_meta ? "Meta Model API, structured JSON output"
    : p.is_llm ? "No Meta key configured; using Groq fallback"
    : "No model credentials configured. Deterministic heuristics, no LLM.";
  return (
    <div className={`ca-provider${p.is_meta ? " ca-provider--meta" : ""}`} title={sub}>
      <div className="ca-provider__row"><Icon name="cpu" size={14} /><span>{p.label}</span></div>
      <div className="ca-provider__sub">{sub}{fallbacks > 0 ? ` ${fallbacks} step${fallbacks === 1 ? "" : "s"} fell back to heuristics after a model error.` : ""}</div>
    </div>
  );
}

function NavItem({ to, icon, children, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `ca-navlink${isActive ? " active" : ""}`}>
      <Icon name={icon} size={16} />{children}
    </NavLink>
  );
}

export function AgentShell({ assessment, title, children }) {
  useDocTitle(title);
  const a = assessment;
  const done = a?.status === "completed";
  return (
    <div className="ca-shell">
      <aside className="ca-side" aria-label="Career Agent navigation">
        <div className="ca-side__brand">
          <strong>Career Agent</strong>
          <span>Claim-to-Evidence Engine</span>
        </div>
        <nav className="ca-side__group" aria-label="Workspace">
          <div className="ca-side__label">Workspace</div>
          <NavItem to="/agent" icon="home" end>Overview</NavItem>
          <NavItem to="/agent/dashboard" icon="dashboard">Dashboard</NavItem>
          <NavItem to="/agent/new" icon="plus">New assessment</NavItem>
        </nav>
        {a && (
          <nav className="ca-side__group" aria-label="Current assessment">
            <div className="ca-side__label">Assessment</div>
            <div className="ca-side__ctx">{a.target_role}</div>
            <NavItem to={`/agent/a/${a.id}`} icon="layers" end>Claims</NavItem>
            {!done && <NavItem to={`/agent/a/${a.id}/interview`} icon="message">Interview</NavItem>}
            <NavItem to={`/agent/a/${a.id}/heatmap`} icon="target">Heatmap</NavItem>
            {done && <NavItem to={`/agent/a/${a.id}/report`} icon="chart">Report</NavItem>}
            {done && <NavItem to={`/agent/a/${a.id}/remediation`} icon="listChecks">Remediation</NavItem>}
          </nav>
        )}
        <div className="ca-side__foot"><ProviderBadge provider={a?.provider} usage={a?.provider_usage} /></div>
      </aside>
      <main className="ca-main ca-fade" id="ca-main">{children}</main>
    </div>
  );
}

export function PageHead({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="ca-pagehead">
      <div className="ca-pagehead__text">
        {eyebrow && <div className="ca-eyebrow">{eyebrow}</div>}
        <h1 className="ca-title">{title}</h1>
        {subtitle && <p className="ca-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ca-actions">{actions}</div>}
    </header>
  );
}

/** Loading / error gate for pages that need an assessment. */
export function AssessmentGate({ state, title, children }) {
  const { data, error, loading, reload } = state;
  if (error) {
    return (
      <AgentShell title={title}>
        <Alert title="We couldn't load this assessment" action={<button className="ca-btn ca-btn--secondary ca-btn--sm" onClick={reload}>Try again</button>}>
          {error}
        </Alert>
      </AgentShell>
    );
  }
  if (loading && !data) return <AgentShell title={title}><PageSkeleton /></AgentShell>;
  return children(data);
}
