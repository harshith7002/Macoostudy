import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { GAP, LABEL, STATUS } from "./agentApi";

/* ── Icons ──────────────────────────────────────────────────────────────
   A few Lucide icon paths (ISC licence) inlined to avoid a new dependency. */
const PATHS = {
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  reply: '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
  minus: '<path d="M5 12h14"/>',
};

export function Icon({ name, size = 16, className, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
         strokeLinejoin="round" className={className} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
         dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : "") + (PATHS[name] || "") }} />
  );
}

/* ── Status vocabulary ────────────────────────────────────────────────── */
const STATUS_ICON = { good: "checkCircle", mid: "help", low: "alert" };

export function StatusBadge({ status, provisional, small }) {
  const cls = `ca-badge${small ? " ca-badge--sm" : ""}`;
  if (!status) return <span className={`${cls} ca-badge--none`}><span className="ca-dot" />Not assessed</span>;
  const s = STATUS[status];
  return (
    <span className={`${cls} ca-badge--${s.tone}${provisional ? " ca-badge--live" : ""}`}
          data-tip={provisional ? "Live, provisional status from evidence so far. Final status is set when the interview ends." : undefined}>
      <span className="ca-dot" />{s.label}{provisional ? " · live" : ""}
    </span>
  );
}

export function StatusIcon({ status, size = 16 }) {
  if (!status) return <Icon name="circle" size={size} className="ca-faint" />;
  const tone = STATUS[status].tone;
  return <Icon name={STATUS_ICON[tone]} size={size} className={`ca-t-${tone}`} />;
}

export function LabelBadge({ label }) {
  const l = LABEL[label] || LABEL.not_demonstrated;
  return <span className={`ca-badge ca-badge--sm ca-badge--${l.tone}`}>{l.label}</span>;
}

export function GapBadge({ gap }) {
  if (!gap) return null;
  const tone = { knowledge_gap: "low", weak_articulation: "mid", insufficient_evidence: "none" }[gap];
  return <span className={`ca-badge ca-badge--sm ca-badge--${tone}`} data-tip={GAP[gap]?.hint} tabIndex={0}>{GAP[gap]?.label}</span>;
}

export const toneFor = (score) => (score >= 70 ? "good" : score >= 35 ? "mid" : "low");
export const TONE_HEX = { good: "#34D399", mid: "#FBBF24", low: "#F87171", none: "#8B93A3", accent: "#FF8A3D" };

/* ── Feedback ─────────────────────────────────────────────────────────── */
export function Spinner({ large }) {
  return <span className={`ca-spinner${large ? " ca-spinner--lg" : ""}`} aria-hidden="true" />;
}

export function Skeleton({ w = "100%", h = 14, style }) {
  return <span className="ca-skel" style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div className="ca-stack" role="status" aria-label="Loading">
      <Skeleton w="30%" h={12} />
      <Skeleton w="55%" h={26} />
      <div className="ca-grid ca-grid--3" style={{ marginTop: 12 }}>
        {[0, 1, 2].map(i => <Skeleton key={i} h={96} style={{ borderRadius: 12 }} />)}
      </div>
      <Skeleton h={240} style={{ borderRadius: 12 }} />
    </div>
  );
}

export function Alert({ tone = "error", title, children, action }) {
  const icon = { error: "alert", info: "alert", warn: "warn" }[tone];
  return (
    <div className={`ca-alert ca-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon = "layers", title, children, action }) {
  return (
    <div className="ca-empty">
      <span className="ca-empty__icon"><Icon name={icon} size={20} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/* ── Data viz primitives ──────────────────────────────────────────────── */
export function Ring({ value, size = 120, stroke = 10, tone, label, sub }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="ca-ring" style={{ width: size, height: size }} role="img" aria-label={`${label || "Score"} ${Math.round(pct)} out of 100`}>
      <svg width={size} height={size}>
        <circle className="ca-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="ca-ring__value" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke}
                stroke={TONE_HEX[tone || toneFor(pct)]} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div className="ca-ring__label"><div><strong>{Math.round(pct)}</strong>{sub && <div className="ca-faint" style={{ fontSize: 11 }}>{sub}</div>}</div></div>
    </div>
  );
}

export function Progress({ value, tone, label }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={`ca-progress${tone ? ` ca-progress--${tone}` : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100}
         aria-valuenow={Math.round(pct)} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatusBar({ counts, total }) {
  const t = total || Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const parts = [["SUPPORTED", "good"], ["PARTIALLY SUPPORTED", "mid"], ["INSUFFICIENT EVIDENCE", "low"]];
  return (
    <div className="ca-stackbar" role="img"
         aria-label={parts.map(([k]) => `${counts[k] || 0} ${STATUS[k].label}`).join(", ")}>
      {parts.map(([k, tone]) => (counts[k] ? <span key={k} style={{ width: `${(counts[k] / t) * 100}%`, background: TONE_HEX[tone] }} /> : null))}
    </div>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────── */
export function Modal({ open, title, children, onClose, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const node = ref.current;
    node?.querySelector("[data-autofocus]")?.focus() || node?.querySelector("button")?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && node) {
        const f = [...node.querySelectorAll("button, [href], textarea, input, select")].filter(el => !el.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ca-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ca-modal" role="dialog" aria-modal="true" aria-labelledby="ca-modal-title" ref={ref}>
        <div className="ca-modal__body">
          <h2 id="ca-modal-title">{title}</h2>
          {children}
        </div>
        <div className="ca-modal__foot">{actions}</div>
      </div>
    </div>
  );
}

/* ── Toasts ───────────────────────────────────────────────────────────── */
const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), []);
  const push = useCallback((message, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
  }, [dismiss]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="ca-toasts" aria-live="polite" aria-atomic="false">
        {toasts.map(t => (
          <div key={t.id} className={`ca-toast ca-toast--${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            <Icon name={t.tone === "error" ? "alert" : t.tone === "info" ? "alert" : "checkCircle"} />
            <span>{t.message}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification"><Icon name="x" size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
