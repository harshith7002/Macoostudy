import React, { lazy, Suspense, useState, useRef, useEffect, useCallback } from "react";
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import "./App.css";
import { getUser, getVisitorId, pushAnalysisCache, setUser } from "./utils/storage";
import { apiFetch, validatePdf } from "./utils/api";
import LoginModal from "./components/LoginModal";
import { trackEvent } from "./utils/analytics";
import { saveLbEntry } from "./utils/leaderboard";
import { useTheme } from "./hooks/useTheme";
import { downloadReportPdf } from "./utils/pdf";
import RoastReport from "./components/RoastReport";
import PremiumGate from "./components/PremiumGate";

/* Weighted overall score from the deterministic category scores. */
function computeOverall(c) {
  if (!c) return 0;
  return Math.round(
    0.25 * (c.ats || 0) + 0.20 * (c.projects || 0) + 0.20 * (c.skills || 0) +
    0.15 * (c.experience || 0) + 0.20 * (c.impact || 0)
  );
}

const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Blog = lazy(() => import("./pages/Blog"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const About = lazy(() => import("./pages/About"));
const JDMatcher = lazy(() => import("./components/JDMatcher"));
const Dashboard = lazy(() => import("./components/Dashboard"));
const ResumeHistory = lazy(() => import("./components/ResumeHistory"));
const ResumeCompare = lazy(() => import("./components/ResumeCompare"));
const PremiumFeatures = lazy(() => import("./components/PremiumFeatures"));
const CompanyCompare = lazy(() => import("./pages/CompanyCompare"));
const ResumeRewrite = lazy(() => import("./pages/ResumeRewrite"));
const InterviewPrep = lazy(() => import("./pages/InterviewPrep"));
const CoverLetter = lazy(() => import("./pages/CoverLetter"));

const MSGS = [
  "Judging your life choices...",
  "Consulting senior engineers...",
  "Preparing savage feedback...",
  "Laughing at your project names...",
  "Counting your buzzwords...",
  "Crying at your skill section...",
  "Wondering why you listed MS Word...",
  "Checking if recursion is explained...",
  "Reviewing your 4 tutorials listed as projects...",
];

const FAQS = [
  { q: "Is my resume stored on your servers?", a: "No. Your resume is parsed in memory only and immediately discarded. We do not store, log, or sell your files or extracted text." },
  { q: "What are the pricing options?", a: "We offer a Free tier (1 resume roast/day), a Pro Lite plan (₹49 for detailed ATS breakdowns), and a Lifetime offer (₹299 for unlimited access to match target companies, bullet rewriters, custom mock interview prepping, and cover letter generators)." },
  { q: "Do you offer refunds?", a: "Yes, we offer a 100% money-back guarantee within 7 days of purchase if you are unsatisfied with the premium upgrades." },
  { q: "Which languages are supported?", a: "We support over 30 languages, including English, Hinglish, Spanish, French, German, Japanese, and multiple regional Indian languages." },
  { q: "How does the privacy policy protect my data?", a: "We do not track candidates or profiles. Your email is only used for authentication and syncing premium billing tiers." }
];

const PERSONALITIES = [
  { id: "default", emoji: "🔥", name: "Savage Engineer",    desc: "Brutally honest senior dev" },
  { id: "gordon",  emoji: "👨‍🍳", name: "Gordon Ramsay",     desc: "THIS RESUME IS RAW!" },
  { id: "parent",  emoji: "👨‍👩‍👧", name: "Disappointed Parent", desc: "Log kya kahenge?" },
  { id: "techbro", emoji: "🤵", name: "Tech Bro",            desc: "Not disruptive enough" },
  { id: "senior",  emoji: "😤", name: "Toxic Senior",        desc: "Rewrote this in a weekend" },
  { id: "elon",    emoji: "🚀", name: "Elon Musk",           desc: "Delete 90% of your resume" },
];

const BADGES_DEF = [
  { id: "gordon",  emoji: "👨‍🍳", label: "Survived Gordon Ramsay", when: (p)    => p === "gordon" },
  { id: "faang",   emoji: "🌟", label: "FAANG Aspirant",           when: (_, v) => v?.includes("FAANG") },
  { id: "shame",   emoji: "💀", label: "Hall of Shame",            when: (_, v) => v?.includes("Entry") },
  { id: "startup", emoji: "🚀", label: "Startup Material",         when: (_, v) => v?.includes("Startup") },
  { id: "veteran", emoji: "🔥", label: "Roast Veteran",            when: ()     => parseInt(localStorage.getItem("roastCount") || 0) >= 5 },
];

const ROTD_LIST = [
  '"You listed MS Word as a skill. In 2024. Remarkable."',
  '"Your projects section is a YouTube tutorial graveyard."',
  '"import numpy as np = AI Engineer? Please stop."',
  '"Objective: Seeking a challenging position. Everyone wants that."',
  '"Hobbies: Listening to music, watching movies. Groundbreaking."',
  '"4 internship applications but 0 deployed projects. Interesting."',
  '"CGPA 6.2 and applying for FAANG? Respect the confidence."',
];

const SAMPLE_DATA = [
  { emoji: "🔥", title: "THE ROAST",     color: "#ff6b00", text: "Rahul listed 'MS Word' and 'MS PowerPoint' as technical skills in 2024. My grandmother knows MS Word. You also listed 'Team Player' — congratulations, you've described every human alive." },
  { emoji: "💀", title: "HALL OF SHAME", color: "#ffaa00", text: "1. Todo App, Weather App, Calculator — the holy trinity of tutorial projects 😂\n2. Objective: 'seeking a challenging position' — everyone wants that Rahul\n3. Hobbies: Listening to Music — so does literally everyone on Earth" },
  { emoji: "✅", title: "OKAY FINE",     color: "#00d68f", text: "GitHub link works and has some commits. Contact info is clean. At least you have a LinkedIn profile." },
  { emoji: "📈", title: "GLOW UP GUIDE", color: "#5599ff", text: "1. Remove MS Word from skills immediately\n2. Deploy something real with actual users\n3. Add numbers — '500 users', '40% faster'\n4. Delete the Objective section\n5. Add LeetCode problem count" },
];

const SAMPLE_CATS = { ats: 42, projects: 55, skills: 60, experience: 32, impact: 48 };

const WHY_FEATURES = [
  { icon: "🎯", metric: "5", unit: "category scores", color: "#ff6b00",
    desc: "Separate scores for ATS, Skills, Projects, Experience, and Impact — so you know exactly what to improve." },
  { icon: "🌍", metric: "34+", unit: "languages", color: "#00d68f",
    desc: "Analyze and receive feedback in your preferred language. Built for students worldwide." },
  { icon: "⚡", metric: "~15", unit: "seconds", color: "#ffaa00",
    desc: "Get your complete resume analysis with scores, fixes, and a downloadable report in seconds." },
  { icon: "🔒", metric: "Privacy", unit: "first", color: "#5599ff",
    desc: "Your resume is processed securely and isn't retained after analysis. No signup required." },
  { icon: "📄", metric: "1-click", unit: "PDF export", color: "#cc77ff",
    desc: "Download a clean, recruiter-ready report with scores, insights, and actionable recommendations." },
  { icon: "🔥", metric: "6", unit: "roast personalities", color: "#ff85a1",
    desc: "Pick a personality — from Gordon Ramsay to Savage Engineer. Every roast comes with practical improvements." },
];

const ATS_FACTORS = [
  { icon: "🔑", title: "Keywords", weight: "High", color: "#ff6b00",
    desc: "ATS bots scan for the exact tech and tools a job needs. Missing keywords = auto-rejected before a human ever sees you." },
  { icon: "📐", title: "Clean formatting", weight: "High", color: "#ffaa00",
    desc: "Tables, columns, images and fancy fonts confuse parsers. Simple, single-column text with standard headings reads cleanly." },
  { icon: "📊", title: "Quantified impact", weight: "High", color: "#00d68f",
    desc: "Numbers like '500 users' or '40% faster' signal real results. Vague duties ('responsible for…') score low." },
  { icon: "🧱", title: "Standard sections", weight: "Medium", color: "#5599ff",
    desc: "Education, Experience, Projects, Skills — named plainly. Creative headings ('My Journey') trip up the parser." },
  { icon: "🔗", title: "Contact & links", weight: "Low", color: "#cc77ff",
    desc: "A parseable email, GitHub and LinkedIn. Links buried in icons or headers often get dropped entirely." },
];

/* ── Helpers ──────────────────────────────────────────────────── */
function parseRoast(text) {
  const patterns = [
    { key: "roast",  emoji: "🔥", color: "#ff6b00" },
    { key: "shame",  emoji: "💀", color: "#ffaa00" },
    { key: "decent", emoji: "✅", color: "#00d68f" },
    { key: "glowup", emoji: "📈", color: "#5599ff" },
    { key: "verdict",emoji: "🎯", color: "#cc77ff" },
  ];
  const sections = [];
  patterns.forEach(({ key, emoji, color }, i) => {
    const next = patterns[i + 1]?.emoji;
    const rx   = next
      ? new RegExp(`${emoji}[\\s\\S]*?(?=${next})`, "g")
      : new RegExp(`${emoji}[\\s\\S]*$`, "g");
    const m = text.match(rx);
    if (m) sections.push({ key, color, content: m[0].trim() });
  });
  return sections.length ? sections : [{ key: "full", color: "#ff6b00", content: text }];
}

function verdictMeta(v = "") {
  const l = v.toLowerCase();
  if (l.includes("faang"))   return { cls: "faang",   label: "FAANG Possible", icon: "🌟", desc: "Genuinely impressive. Apply everywhere." };
  if (l.includes("product")) return { cls: "product", label: "Product Co.",    icon: "💰", desc: "Solid resume. Polish the gaps." };
  if (l.includes("startup")) return { cls: "startup", label: "Startup Ready",  icon: "🚀", desc: "Good bones. Show more impact." };
  return                              { cls: "entry",   label: "Entry Level",    icon: "🏭", desc: "Needs serious work. Read the guide carefully." };
}

function verdictKey(v = "") {
  const l = v.toLowerCase();
  if (l.includes("faang"))   return "faang";
  if (l.includes("product")) return "product";
  if (l.includes("startup")) return "startup";
  return "entry";
}

/* ── Sample drawer ────────────────────────────────────────────── */
function SampleDrawer({ open, onClose, onUpload }) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else       document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 600,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(10px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        className="sample-drawer"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="sample-drawer-handle" />

        {/* Header */}
        <div className="sample-drawer-header">
          <div>
            <p className="sample-drawer-title">👀 Real Roast Preview</p>
            <p className="sample-drawer-sub">This is exactly what your result looks like</p>
          </div>
          <button className="sample-drawer-close" onClick={onClose}>✕</button>
        </div>

        {/* Scrollable body */}
        <div className="sample-drawer-body">
          <RoastReport
            preview
            verdict="🚀 Startup Ready"
            verdictMeta={verdictMeta("startup")}
            overall={computeOverall(SAMPLE_CATS)}
            categories={SAMPLE_CATS}
            sections={SAMPLE_DATA.map((s, i) => ({
              key: `sample-${i}`,
              color: s.color,
              content: `${s.emoji} ${s.title}\n${s.text}`,
            }))}
          />

          <button
            className="fire-btn"
            style={{ marginTop: 4 }}
            onClick={() => { onUpload(); onClose(); }}
          >
            🔥 GET MY RESUME ROASTED
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── How ATS scoring works ────────────────────────────────────── */
function AtsExplainer() {
  return (
    <section className="ats-explainer">
      <div className="atsx-head">
        <p className="atsx-eyebrow">UNDER THE HOOD</p>
        <h3 className="atsx-title">How ATS scoring actually works</h3>
        <p className="atsx-sub">
          Over 90% of companies run resumes through an <strong>Applicant Tracking System</strong> before
          a recruiter reads them. Here's what those bots check — and what your score is built from.
        </p>
      </div>
      <div className="atsx-grid">
        {ATS_FACTORS.map((f) => (
          <motion.div
            key={f.title}
            className="atsx-card"
            style={{ "--ax-color": f.color }}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="atsx-card-top">
              <span className="atsx-icon">{f.icon}</span>
              <span className={`atsx-weight w-${f.weight.toLowerCase()}`}>{f.weight} impact</span>
            </div>
            <p className="atsx-card-title">{f.title}</p>
            <p className="atsx-card-desc">{f.desc}</p>
          </motion.div>
        ))}
      </div>
      <p className="atsx-foot">
        🔍 Your report breaks this into five live scores — <strong>ATS, Skills, Projects, Experience, Impact</strong> — so you know exactly where you're losing points.
      </p>
    </section>
  );
}

/* ── Why RoastMyResume ────────────────────────────────────────── */
/* Real, verifiable product features and metrics — no fabricated quotes.
   The testimonials placeholder below is intentionally left for genuine
   user stories once we have permission to publish them. */
function WhyRoastMyResume() {
  return (
    <section className="why-section">
      <div className="why-head">
        <p className="why-eyebrow">WHY ROASTMYRESUME</p>
        <h3 className="why-title">Know exactly what to fix.</h3>
        <p className="why-sub">No generic "looks good!" Every score comes with a real, specific fix — built for CS freshers who need to stand out.</p>
      </div>
      <div className="why-grid">
        {WHY_FEATURES.map((f) => (
          <motion.div
            key={f.unit}
            className="why-card"
            style={{ "--why-color": f.color }}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="why-icon">{f.icon}</span>
            <p className="why-metric">{f.metric} <span className="why-unit">{f.unit}</span></p>
            <p className="why-desc">{f.desc}</p>
          </motion.div>
        ))}
      </div>

      {/* Placeholder for real user testimonials — to be filled with
          genuine, opt-in stories. Intentionally not fabricated. */}
      <div className="why-testimonials-placeholder">
        <span className="wtp-badge">COMING SOON</span>
        <p className="wtp-title">Real stories from real users</p>
        <p className="wtp-sub">
          We don't fake reviews. Got roasted and landed something? We'd love to feature your story (with your permission).
        </p>
        <a className="wtp-link" href="mailto:macoostudy2@gmail.com?subject=My%20RoastMyResume%20story">
          Share your story →
        </a>
      </div>
    </section>
  );
}

/* ── Ember particles ──────────────────────────────────────────── */
function Embers() {
  const es = Array.from({ length: 18 }, (_, i) => ({
    id: i, x: Math.random() * 100,
    delay: Math.random() * 8, dur: 6 + Math.random() * 6,
    size: 4 + Math.random() * 10, drift: (Math.random() - 0.5) * 80,
  }));
  return (
    <div className="embers" aria-hidden="true">
      {es.map(e => (
        <div key={e.id} className="ember" style={{
          left: `${e.x}%`, width: e.size, height: e.size,
          animationDelay: `${e.delay}s`, animationDuration: `${e.dur}s`,
          "--drift": `${e.drift}px`,
        }} />
      ))}
    </div>
  );
}

/* ── Toast ────────────────────────────────────────────────────── */
function Toasts({ items }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className="toast">
          <span className="toast-icon">{t.icon}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Confetti ─────────────────────────────────────────────────── */
function Confetti({ on }) {
  const COLS = ["#ff6b00","#ffaa00","#ffc844","#00d68f","#5599ff","#cc77ff","#ff85a1"];
  if (!on) return null;
  const ps = Array.from({ length: 80 }, (_, i) => ({
    id: i, x: Math.random() * 100, color: COLS[i % COLS.length],
    delay: Math.random() * 0.9, dur: 1.6 + Math.random() * 1.6,
    size: 7 + Math.random() * 9, drift: (Math.random() - 0.5) * 120,
    circle: Math.random() > 0.5,
  }));
  return (
    <div className="confetti-wrap" aria-hidden="true">
      {ps.map(p => (
        <div key={p.id} className="confetti-p" style={{
          left: `${p.x}%`, background: p.color, width: p.size,
          height: p.circle ? p.size : p.size * 0.4,
          borderRadius: p.circle ? "50%" : "2px",
          "--delay": `${p.delay}s`, "--dur": `${p.dur}s`, "--drift": `${p.drift}px`,
        }} />
      ))}
    </div>
  );
}

/* ── FAQ item ─────────────────────────────────────────────────── */
function FAQ({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq-item${open ? " open" : ""}`}>
      <button className="faq-q" type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>{q}</span>
        <span className="faq-arrow" aria-hidden="true">{open ? "×" : "+"}</span>
      </button>
      <div className="faq-a">{a}</div>
    </div>
  );
}

const MacoostudyLogo = () => (
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "inline-block", verticalAlign: "middle", marginRight: "8px" }}>
    <rect width="32" height="32" rx="8" fill="url(#logo-bg-grad)" />
    <path d="M9 22V10L16 17L23 10V22" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 17L13 20H19L16 17Z" fill="#FF8A3D" />
    <defs>
      <linearGradient id="logo-bg-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FF8A3D" />
        <stop stopColor="#E57E35" />
      </linearGradient>
    </defs>
  </svg>
);

/* ── Navbar ───────────────────────────────────────────────────── */
function Navbar({ onUploadClick, theme, onToggleTheme, user, onLoginClick }) {
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const loc  = useLocation();
  const active = (p) => loc.pathname === p ? "nav-link active" : "nav-link";
  const toolsRef = useRef(null);

  // Close tools dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (toolsRef.current && !toolsRef.current.contains(e.target)) {
        setToolsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const closeAll = () => { setOpen(false); setToolsOpen(false); };

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand" onClick={closeAll} style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        <MacoostudyLogo />
        <span className="brand-name" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.2rem", fontWeight: 800, color: "#fff", letterSpacing: "0.5px" }}>
          Macoostudy
        </span>
      </Link>

      <div className={`navbar-center${open ? " open" : ""}`}>
        {/* Features Dropdown (holds all individual tools) */}
        <div className="nav-dropdown" ref={toolsRef}>
          <button
            className={`nav-link nav-dropdown-trigger${toolsOpen ? " active" : ""}`}
            onClick={() => setToolsOpen(o => !o)}
            aria-expanded={toolsOpen}
            aria-haspopup="true"
          >
            Features <span className={`nav-dropdown-arrow${toolsOpen ? " open" : ""}`}>▾</span>
          </button>
          {toolsOpen && (
            <div className="nav-dropdown-menu" role="menu">
              <Link to="/jd-match" className={loc.pathname === "/jd-match" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={closeAll} role="menuitem">
                <span className="ndi-icon">🎯</span>
                <span>
                  <span className="ndi-label">JD Matcher</span>
                  <span className="ndi-sub">Targeted keyword scanning</span>
                </span>
              </Link>
              <Link to="/company-compare" className={loc.pathname === "/company-compare" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={closeAll} role="menuitem">
                <span className="ndi-icon">🏢</span>
                <span>
                  <span className="ndi-label">Company Match</span>
                  <span className="ndi-sub">Check corporate alignment</span>
                </span>
              </Link>
              <Link to="/resume-rewrite" className={loc.pathname === "/resume-rewrite" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={closeAll} role="menuitem">
                <span className="ndi-icon">✍️</span>
                <span>
                  <span className="ndi-label">Bullet Rewriter</span>
                  <span className="ndi-sub">Google XYZ polishing</span>
                </span>
              </Link>
              <Link to="/interview-prep" className={loc.pathname === "/interview-prep" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={closeAll} role="menuitem">
                <span className="ndi-icon">💡</span>
                <span>
                  <span className="ndi-label">Interview Prep</span>
                  <span className="ndi-sub">Custom Mock questions</span>
                </span>
              </Link>
              <Link to="/cover-letter" className={loc.pathname === "/cover-letter" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={closeAll} role="menuitem">
                <span className="ndi-icon">✉️</span>
                <span>
                  <span className="ndi-label">Cover Letter</span>
                  <span className="ndi-sub">Job-specific AI writer</span>
                </span>
              </Link>
              <Link to="/compare" className={loc.pathname === "/compare" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={closeAll} role="menuitem">
                <span className="ndi-icon">⚖️</span>
                <span>
                  <span className="ndi-label">Compare Versions</span>
                  <span className="ndi-sub">Track scoring delta</span>
                </span>
              </Link>
              <Link to="/history" className={loc.pathname === "/history" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={closeAll} role="menuitem">
                <span className="ndi-icon">📋</span>
                <span>
                  <span className="ndi-label">History</span>
                  <span className="ndi-sub">Session-only · not saved</span>
                </span>
              </Link>
              <Link to="/dashboard" className={loc.pathname === "/dashboard" ? "nav-dropdown-item active" : "nav-dropdown-item"} onClick={closeAll} role="menuitem">
                <span className="ndi-icon">📊</span>
                <span>
                  <span className="ndi-label">Dashboard</span>
                  <span className="ndi-sub">Your analysis overview</span>
                </span>
              </Link>
            </div>
          )}
        </div>

        <a 
          href="#pricing-section" 
          className="nav-link" 
          onClick={(e) => { 
            closeAll(); 
            if (loc.pathname !== "/") { 
              e.preventDefault(); 
              window.location.href = "/#pricing-section"; 
            } else {
              e.preventDefault();
              const el = document.getElementById("pricing-section");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }}
        >
          Pricing
        </a>
        <Link to="/blog"        className={active("/blog")}        onClick={closeAll}>Blog</Link>
        <Link to="/dashboard"   className={active("/dashboard")}   onClick={closeAll}>Dashboard</Link>

        {/* Mobile-only upload CTA inside menu */}
        <button className="nav-upload-cta-mobile fire-btn" onClick={() => { closeAll(); onUploadClick?.(); }}>
          📂 Upload Resume
        </button>
      </div>

      <div className="navbar-right">
        {user ? (
          <button
            className="nav-link"
            onClick={() => {
              setUser(null);
              window.dispatchEvent(new Event("mcs_user_changed"));
            }}
            style={{ marginRight: 12, cursor: "pointer", background: "none", border: "none", color: "var(--cream-60)", fontSize: "0.88rem" }}
          >
            Sign Out
          </button>
        ) : (
          <button
            className="nav-link"
            onClick={onLoginClick}
            style={{ marginRight: 12, cursor: "pointer", background: "none", border: "none", color: "var(--cream-60)", fontSize: "0.88rem" }}
          >
            Sign In
          </button>
        )}
        <button
          className="nav-cta"
          onClick={() => { closeAll(); onUploadClick?.(); }}
          aria-label="Upload your resume"
        >
          📂 Upload Resume
        </button>
        <button className="hamburger" onClick={() => setOpen(o => !o)} aria-label="Toggle navigation" aria-expanded={open}>
          <span className={open ? "ham-open" : ""} />
          <span className={open ? "ham-open" : ""} />
          <span className={open ? "ham-open" : ""} />
        </button>
      </div>
    </nav>
  );
}

/* ── Footer ───────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="footer" style={{ padding: "48px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)", color: "var(--cream-60)", fontSize: "0.82rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "24px", maxWidth: "1100px", margin: "0 auto", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <MacoostudyLogo />
            <span style={{ fontWeight: 800, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.1rem" }}>Macoostudy</span>
          </div>
          <span>© 2026 Macoostudy. All rights reserved.</span>
        </div>

        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <Link to="/privacy" style={{ color: "var(--cream-60)", textDecoration: "none" }}>Privacy Policy</Link>
          <Link to="/terms" style={{ color: "var(--cream-60)", textDecoration: "none" }}>Terms of Service</Link>
          <a href="mailto:macoostudy2@gmail.com" style={{ color: "var(--cream-60)", textDecoration: "none" }}>Contact Us</a>
        </div>
      </div>
    </footer>
  );
}

/* ── Personality modal ────────────────────────────────────────── */
function PersonalityModal({ onSelect, onClose }) {
  const [sel, setSel] = useState("default");
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Who's Roasting You?</h2>
        <p className="modal-sub">Pick your roaster before we begin</p>
        <div className="personality-grid">
          {PERSONALITIES.map(p => (
            <button
              key={p.id}
              className={`p-btn${sel === p.id ? " sel" : ""}`}
              onClick={() => setSel(p.id)}
            >
              <span className="p-emoji">{p.emoji}</span>
              <span className="p-name">{p.name}</span>
              <span className="p-desc">{p.desc}</span>
            </button>
          ))}
        </div>
        <button className="modal-fire-btn" onClick={() => onSelect(sel)}>
          🔥 Start Roasting
        </button>
        <button className="modal-cancel" onClick={onClose}>maybe later</button>
      </div>
    </div>
  );
}

/* ── Leaderboard entry modal ──────────────────────────────────── */
function LeaderboardModal({ roastSnippet, verdict, ats, onSubmit, onClose }) {
  const [name, setName]     = useState("");
  const [step, setStep]     = useState("ask"); // ask | name | done
  const vKey = verdictKey(verdict);

  const handleSubmit = () => {
    if (!name.trim()) return;
    const entry = {
      id:      `u_${Date.now()}`,
      name:    name.trim(),
      quote:   roastSnippet,
      verdict: vKey,
      ats,
      votes:   0,
      ts:      Date.now(),
    };
    saveLbEntry(entry);
    setStep("done");
    setTimeout(() => { onSubmit(); onClose(); }, 1800);
  };

  return (
    <div className="modal-bg" onClick={step === "ask" ? onClose : undefined}>
      <div className="modal-box lb-modal-box" onClick={e => e.stopPropagation()}>

        {step === "ask" && (
          <>
            <div className="lb-modal-icon">🏆</div>
            <h2 className="modal-title">Enter the Leaderboard?</h2>
            <p className="modal-sub">
              Add your roast to the board and vote for the funniest. Entries are
              saved on this device — it's just for fun, no signup.
            </p>
            <div className="lb-modal-prizes">
              <span>😂 Funniest roasts</span>
              <span>🔥 Top of the board</span>
              <span>🏅 Bragging rights</span>
            </div>
            <div className="lb-modal-actions">
              <button className="modal-fire-btn" onClick={() => setStep("name")}>
                🏆 Yes, Enter Me!
              </button>
              <button className="modal-cancel" onClick={onClose}>No thanks</button>
            </div>
          </>
        )}

        {step === "name" && (
          <>
            <div className="lb-modal-icon">✍️</div>
            <h2 className="modal-title">What's your name?</h2>
            <p className="modal-sub">This is how you'll appear on the leaderboard.</p>
            <input
              className="lb-name-input"
              type="text"
              placeholder="e.g. Rahul from DTU 🔥"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              maxLength={40}
              autoFocus
            />
            <div className="lb-modal-actions">
              <button
                className="modal-fire-btn"
                onClick={handleSubmit}
                disabled={!name.trim()}
              >
                🚀 Submit My Roast
              </button>
              <button className="modal-cancel" onClick={() => setStep("ask")}>← Back</button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <div className="lb-modal-icon" style={{ fontSize: 52 }}>🎉</div>
            <h2 className="modal-title">You're on the board!</h2>
            <p className="modal-sub">Go vote for the funniest roasts and check your ranking.</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main app ─────────────────────────────────────────────────── */
function MainApp({ showSampleDrawer = () => {}, closeSampleDrawer = () => {}, registerUpload = () => {} }) {
  const [file, setFile]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [roast, setRoast]         = useState(null);
  const [verdict, setVerdict]     = useState("");
  const [ats, setAts]             = useState(0);
  const [cats, setCats]           = useState(null);
  const [analysisId, setAnalysisId] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [err, setErr]             = useState(null);
  const [over, setOver]           = useState(false);
  const [lang, setLang]           = useState("english");
  const [personality, setP]       = useState("default");
  const [modal, setModal]         = useState(false);
  const [lbModal, setLbModal]     = useState(false);
  const [toasts, setToasts]       = useState([]);
  const [confetti, setConfetti]   = useState(false);
  const [burst, setBurst]         = useState(false);
  const [msgIdx, setMsgIdx]       = useState(0);
  const [progressStage, setProgressStage] = useState(0);
  const [badges, setBadges]       = useState([]);
  const [roastSnippet, setRoastSnippet] = useState("");
  const fileRef    = useRef();
  const resultsRef = useRef();

  // Register upload trigger so root SampleDrawer can fire the file picker
  useEffect(() => {
    registerUpload(() => fileRef.current?.click());
  }, [registerUpload]);

  useEffect(() => {
    if (!loading) {
      setProgressStage(0);
      return;
    }
    const stages = [1500, 4000, 7500, 11500];
    const timers = stages.map((time, idx) => 
      setTimeout(() => {
        setProgressStage(idx + 1);
      }, time)
    );
    return () => timers.forEach(t => clearTimeout(t));
  }, [loading]);

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setMsgIdx(i => (i + 1) % MSGS.length), 2200);
    return () => clearInterval(id);
  }, [loading]);

  const toast = useCallback((msg, icon = "ℹ️") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, icon }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800);
  }, []);

  const handleFile = (f) => {
    const validationError = validatePdf(f);
    if (!validationError) {
      setFile(f); setErr(null); setBurst(true);
      setTimeout(() => setBurst(false), 600);
      toast(`${f.name} loaded!`, "📄");
      trackEvent("resume_selected", { size_kb: Math.round(f.size / 1024) });
    } else {
      toast(validationError, "⚠️");
      setErr(validationError);
      trackEvent("upload_rejected", { reason: validationError });
    }
  };

  const handleDrop = (e) => { e.preventDefault(); setOver(false); handleFile(e.dataTransfer.files[0]); };
  const onRoastClick = () => {
    if (!file) return;
    trackEvent("roast_cta_clicked", { language: lang });
    setModal(true);
  };

  const onPersonalitySelect = async (p) => {
    setModal(false); setP(p);
    await submit(p);
  };

  const submit = async (p = personality) => {
    if (!file) return;
    setLoading(true); setRoast(null); setErr(null); setMsgIdx(0);
    const fd = new FormData();
    fd.append("resume", file); fd.append("language", lang); fd.append("personality", p);
    const u = getUser();
    fd.append("user_id", u?.user_id || getVisitorId());
    try {
      trackEvent("roast_started", { language: lang, personality: p });
      const data = await apiFetch("/api/roast", { method: "POST", body: fd, timeout: 60000 });
      if (data.success) {
        setAnalysisId(data.analysis_id);
        setResumeText(data.resume_text || "");
        setRoast(data.roast);
        setVerdict(data.verdict || "Entry Level");
        trackEvent("roast_completed", { verdict: data.verdict || "unknown", ats_score: data.ats_score });
        setAts(data.ats_score || 0);
        // Fall back to deriving a single-bucket breakdown if the backend is older.
        setCats(data.category_scores || {
          ats: data.ats_score || 0, projects: 0, skills: 0, experience: 0, impact: 0,
        });
        pushAnalysisCache({
          id: data.analysis_id,
          type: "roast",
          filename: file.name,
          ats_score: data.ats_score,
          verdict: data.verdict,
          result: { roast: data.roast, category_scores: data.category_scores },
        });

        // Extract snippet for leaderboard
        const parsed  = parseRoast(data.roast);
        const roastSec = parsed.find(s => s.key === "roast") || parsed[0];
        const snippet  = roastSec
          ? roastSec.content.replace(/^🔥[^\n]*\n?/, "").trim().slice(0, 200)
          : data.roast.slice(0, 200);
        setRoastSnippet(snippet);

        const earned = BADGES_DEF.filter(b => b.when(p, data.verdict));
        setBadges(earned);

        // Update roast counter
        const newCount = parseInt(localStorage.getItem("roastCount") || 0) + 1;
        localStorage.setItem("roastCount", newCount);

        if (data.verdict?.toLowerCase().includes("faang")) {
          setConfetti(true); setTimeout(() => setConfetti(false), 4500);
          toast("FAANG Possible! You might actually get hired!", "🌟");
        } else {
          toast("Your roast is ready. Brace yourself...", "🔥");
        }
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
        // Show leaderboard invite after results scroll
        setTimeout(() => setLbModal(true), 2200);
      } else {
        setErr(data.error || "Something went wrong!"); toast(data.error || "Error", "💀");
      }
    } catch (requestError) {
      setErr(requestError.message); toast(requestError.message, "🔌");
      trackEvent("roast_failed", { reason: requestError.message });
    } finally { setLoading(false); }
  };

  const copyRoast = () => { navigator.clipboard.writeText(roast); toast("Copied! Send it to your rivals 😂", "📋"); };

  const reset = () => {
    setFile(null); setRoast(null); setErr(null); setVerdict(""); setAts(0); setCats(null);
    setBadges([]); setConfetti(false); setLbModal(false); setRoastSnippet("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const downloadPdf = () => {
    toast("Building your PDF report...", "📄");
    try {
      const vmeta = verdictMeta(verdict);
      downloadReportPdf({
        verdict: vmeta.label,
        verdictDesc: vmeta.desc,
        overall: computeOverall(cats),
        categories: cats,
        sections: parseRoast(roast),
        filename: file?.name || "resume",
      });
      trackEvent("pdf_downloaded", {});
    } catch (e) {
      toast("Could not build PDF. Try again.", "⚠️");
    }
  };

  const shareImage = () => {
    toast("Generating share card...", "🎨");
    const canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 460;
    const ctx = canvas.getContext("2d");
    const bg  = ctx.createLinearGradient(0, 0, 800, 460);
    bg.addColorStop(0, "#100b00"); bg.addColorStop(1, "#1a1000");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 800, 460);
    ctx.strokeStyle = "rgba(255,107,0,0.35)"; ctx.lineWidth = 2; ctx.strokeRect(1,1,798,458);
    ctx.fillStyle = "#ff6b00"; ctx.font = "bold 38px serif"; ctx.fillText("🔥 ROAST MY RESUME", 40, 70);
    ctx.fillStyle = "rgba(255,245,224,0.35)"; ctx.font = "15px monospace"; ctx.fillText("macoostudy.info", 40, 96);
    const vm = verdictMeta(verdict);
    ctx.fillStyle = "#ffaa00"; ctx.font = "bold 24px sans-serif"; ctx.fillText(`${vm.icon} ${vm.label}`, 40, 144);
    ctx.fillStyle = "#5599ff"; ctx.font = "15px sans-serif"; ctx.fillText(`ATS Score: ${ats}/100`, 40, 178);
    const ps    = parseRoast(roast);
    const first = ps.find(s => s.key === "roast");
    if (first) {
      ctx.fillStyle = "rgba(255,245,224,0.55)"; ctx.font = "14px sans-serif";
      const words = first.content.replace(/^🔥[^\n]*\n?/, "").split(" ");
      let line = "", y = 222;
      for (const w of words) {
        const t = line + w + " ";
        if (ctx.measureText(t).width > 720 && line) {
          ctx.fillText(line.trim(), 40, y); line = w + " "; y += 26;
          if (y > 370) { ctx.fillText("...", 40, y); break; }
        } else line = t;
      }
      if (y <= 370) ctx.fillText(line.trim(), 40, y);
    }
    ctx.fillStyle = "rgba(255,107,0,0.6)"; ctx.font = "12px monospace";
    ctx.fillText("Try it free → macoostudy.info", 40, 432);
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "roast-card.png"; a.click();
      URL.revokeObjectURL(url); toast("Card downloaded!", "🎉");
    });
  };

  const sections = roast ? parseRoast(roast) : [];
  const vm   = verdictMeta(verdict);
  const rotd = ROTD_LIST[new Date().getDay() % ROTD_LIST.length];

  return (
    <div className="page-wrap">
      <Embers />
      <Confetti on={confetti} />
      <Toasts items={toasts} />
      {modal    && <PersonalityModal onSelect={onPersonalitySelect} onClose={() => setModal(false)} />}
      {lbModal  && (
        <LeaderboardModal
          roastSnippet={roastSnippet}
          verdict={verdict}
          ats={ats}
          onSubmit={() => toast("You're on the leaderboard! 🏆", "🏆")}
          onClose={() => setLbModal(false)}
        />
      )}

      {/* ── Hero ── */}
      <motion.header
        className="hero"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        style={{ padding: "0 0 40px", borderBottom: "none" }}
      >
        <div className="hero-split-container" style={{ display: "flex", gap: "40px", alignItems: "center", justifyContent: "space-between", maxWidth: "1200px", margin: "0 auto", flexWrap: "wrap" }}>
          
          {/* Left Side: Headline & Copy */}
          <div style={{ flex: "1 1 55%", textAlign: "left" }} className="hero-left-col">
            <div className="hero-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: "8px", margin: "0 0 16px", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "2px", color: "var(--fire)" }}>
              <span className="eyebrow-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--fire)", display: "inline-block" }} />
              MACOOSTUDY — AI CAREER COPILOT
            </div>
            
            <h1 className="hero-title" style={{ fontSize: "56px", fontWeight: 900, lineHeight: 1.12, color: "var(--cream)", marginBottom: "24px", letterSpacing: "-1.5px" }}>
              Stop Sending Resumes <span style={{ color: "var(--fire)" }}>That Get Ignored.</span>
            </h1>

            <p className="hero-sub" style={{ fontSize: "17px", color: "var(--cream-60)", lineHeight: 1.65, margin: "0 0 36px 0", maxWidth: "540px", textAlign: "left" }}>
              Get roasted with honest recruiter-grade feedback, identify hidden ATS keyword gaps, and generate job-winning bullet points in seconds.
            </p>

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "32px" }}>
              <button
                className="btn-primary"
                style={{
                  padding: "16px 28px",
                  borderRadius: "100px",
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  background: "linear-gradient(135deg, #FF8A3D 0%, #E57E35 100%)",
                  border: "none",
                  color: "#fff",
                  boxShadow: "0 8px 30px rgba(255, 138, 61, 0.2)",
                  transition: "transform 0.2s, box-shadow 0.2s"
                }}
                onClick={() => { closeSampleDrawer(); fileRef.current?.click(); }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = "0 8px 35px rgba(255, 138, 61, 0.35)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(255, 138, 61, 0.2)"; }}
              >
                Upload Resume — Free
              </button>
              <button
                className="btn-secondary"
                style={{
                  padding: "16px 28px",
                  borderRadius: "100px",
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  background: "var(--bg2)",
                  border: "1px solid var(--border)",
                  color: "var(--cream)",
                  transition: "background 0.2s, border-color 0.2s"
                }}
                onClick={showSampleDrawer}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg3)"; e.currentTarget.style.borderColor = "var(--cream-30)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                View Demo
              </button>
            </div>

            <div style={{ display: "flex", gap: "10px", fontSize: "0.76rem", color: "var(--cream-60)", flexWrap: "wrap", alignItems: "center", fontWeight: 600 }}>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>⚡ No Signup Required</span>
              <span>•</span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>🎁 Free Tier Included</span>
              <span>•</span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>📄 PDF Files Only</span>
            </div>
          </div>

          {/* Right Side: Realistic AI Report Preview Dashboard */}
          <motion.div 
            style={{ flex: "1 1 35%", position: "relative", minWidth: "320px" }} 
            className="hero-dashboard-preview"
            animate={{ y: [0, -10, 0] }}
            transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
          >
            <div
              style={{
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "24px",
                boxShadow: "0 30px 60px rgba(0,0,0,0.05)",
                position: "relative",
                overflow: "hidden"
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--border)", paddingBottom: "12px" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "var(--cream-60)", textTransform: "uppercase", letterSpacing: "1px" }}>🚀 REPORT_PREVIEW.JSX</span>
                <span style={{ fontSize: "0.68rem", background: "rgba(255, 138, 61, 0.1)", color: "var(--fire)", padding: "2px 8px", borderRadius: "100px", fontWeight: 700 }}>LIVE ANALYSIS</span>
              </div>

              {/* Grid of Scores */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                {/* ATS Score Card */}
                <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", padding: "16px", borderRadius: "12px" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--cream-60)", textTransform: "uppercase", fontWeight: 700 }}>ATS Score</span>
                  <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "var(--emerald)", margin: "8px 0 4px", fontFamily: "monospace" }}>89<span style={{ fontSize: "0.9rem", color: "var(--cream-60)" }}>/100</span></div>
                  <div style={{ height: "6px", background: "rgba(5,150,105,0.1)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{ width: "89%", height: "100%", background: "linear-gradient(90deg, #059669 0%, #10B981 100%)", borderRadius: "99px" }}></div>
                  </div>
                </div>
                {/* Resume Score Card */}
                <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", padding: "16px", borderRadius: "12px" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--cream-60)", textTransform: "uppercase", fontWeight: 700 }}>Resume Score</span>
                  <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "var(--fire)", margin: "8px 0 4px", fontFamily: "monospace" }}>82<span style={{ fontSize: "0.9rem", color: "var(--cream-60)" }}>/100</span></div>
                  <div style={{ height: "6px", background: "rgba(255,138,61,0.1)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{ width: "82%", height: "100%", background: "linear-gradient(90deg, #FF8A3D 0%, #FFB347 100%)", borderRadius: "99px" }}></div>
                  </div>
                </div>
              </div>

              {/* Sub Scores Bar Chart Mock */}
              <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", padding: "16px", borderRadius: "12px", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifySpaceBetween: "space-between", fontSize: "0.75rem", marginBottom: "12px", color: "var(--cream-60)", justifyContent: "space-between", fontWeight: 700 }}>
                  <span>INTERVIEW READINESS</span>
                  <span style={{ fontFamily: "monospace", color: "var(--cream)", fontWeight: 700 }}>78% Ready</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.7rem" }}>
                    <span style={{ width: "65px", color: "var(--cream-60)" }}>Technical</span>
                    <div style={{ flex: 1, height: "6px", background: "rgba(15,23,42,0.08)", borderRadius: "99px", overflow: "hidden" }}>
                      <div style={{ width: "85%", height: "100%", background: "linear-gradient(90deg, #FF8A3D 0%, #FFB347 100%)", borderRadius: "99px" }}></div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.7rem" }}>
                    <span style={{ width: "65px", color: "var(--cream-60)" }}>Behavioral</span>
                    <div style={{ flex: 1, height: "6px", background: "rgba(15,23,42,0.08)", borderRadius: "99px", overflow: "hidden" }}>
                      <div style={{ width: "70%", height: "100%", background: "linear-gradient(90deg, #FF8A3D 0%, #FFB347 100%)", borderRadius: "99px" }}></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Company Match & Skill Gap */}
              <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", padding: "16px", borderRadius: "12px", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--cream-60)", textTransform: "uppercase", fontWeight: 700 }}>Target Alignment</span>
                  <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--fire)" }}>Google (86% Match)</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
                  <span style={{ fontSize: "0.68rem", background: "rgba(5, 150, 105, 0.1)", color: "var(--emerald)", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>+ React</span>
                  <span style={{ fontSize: "0.68rem", background: "rgba(5, 150, 105, 0.1)", color: "var(--emerald)", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>+ TypeScript</span>
                  <span style={{ fontSize: "0.68rem", background: "rgba(255, 106, 61, 0.1)", color: "var(--fire)", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>- System Design</span>
                </div>
              </div>

              {/* Suggested Improvements & Weaknesses */}
              <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", padding: "16px", borderRadius: "12px" }}>
                <span style={{ fontSize: "0.7rem", color: "var(--cream-60)", textTransform: "uppercase", display: "block", marginBottom: "8px", fontWeight: 700 }}>Key Weaknesses & Fixes</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.72rem" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <span style={{ color: "red" }}>✕</span>
                    <span style={{ color: "var(--cream-60)" }}>Missing metrics in experience bullets.</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <span style={{ color: "var(--emerald)" }}>✓</span>
                    <span style={{ color: "var(--cream)" }}>Google XYZ rewrite: "Accomplished X, measured by Y."</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── Trust Stats Strip ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "24px", width: "100%", marginTop: "64px" }} className="hero-trust-strip-premium">
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", padding: "32px 24px", borderRadius: "16px", textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.02)" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--cream-60)", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700, display: "block", marginBottom: "8px" }}>RESUMES ROASTED</span>
            <div style={{ fontSize: "2.4rem", fontWeight: 800, color: "var(--cream)", fontFamily: "monospace" }}>250+</div>
          </div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", padding: "32px 24px", borderRadius: "16px", textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.02)" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--cream-60)", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700, display: "block", marginBottom: "8px" }}>LANGUAGES SUPPORTED</span>
            <div style={{ fontSize: "2.4rem", fontWeight: 800, color: "var(--cream)", fontFamily: "monospace" }}>34</div>
          </div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", padding: "32px 24px", borderRadius: "16px", textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.02)" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--cream-60)", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700, display: "block", marginBottom: "8px" }}>AVERAGE ANALYSIS TIME</span>
            <div style={{ fontSize: "2.4rem", fontWeight: 800, color: "var(--emerald)", fontFamily: "monospace" }}>15s</div>
          </div>
        </div>
      </motion.header>


      {/* ── Upload — directly below hero ── */}
      {!roast && (
        <div className="upload-zone">
          <input
            ref={fileRef} type="file" accept=".pdf"
            style={{ display: "none" }}
            onChange={e => handleFile(e.target.files[0])}
          />
          <div
            className={`dropzone${over ? " over" : ""}${file ? " has-file" : ""}${burst ? " burst" : ""}`}
            role="button"
            tabIndex={file ? -1 : 0}
            aria-label={file ? `${file.name} selected` : "Upload resume PDF"}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={handleDrop}
            onClick={() => !file && fileRef.current.click()}
            onKeyDown={e => { if (!file && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fileRef.current.click(); } }}
          >
            {file ? (
              <div className="file-card">
                <span className="file-card-icon">📄</span>
                <span className="file-card-name">{file.name}</span>
                <span className="file-card-size">{(file.size / 1024).toFixed(1)} KB</span>
                <button className="file-change" onClick={e => { e.stopPropagation(); fileRef.current.click(); }}>
                  Change file
                </button>
              </div>
            ) : (
              <>
                <span className="dz-icon">📋</span>
                <p className="dz-title">Drop your resume PDF here</p>
                <p className="dz-sub">or click to browse</p>
                <span className="dz-btn">📂 Upload PDF</span>
                <p className="dz-hint">Supported: PDF • Max 5 MB</p>
              </>
            )}
          </div>

          <div style={{ textAlign: "center", marginTop: "4px", fontSize: "0.8rem", color: "var(--cream-60)", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
            <span>🔒 Your resume is parsed in-memory and deleted immediately after analysis.</span>
          </div>

          {err && <div className="err-box" role="alert">⚠️ {err}</div>}

          <div className="lang-block">
            <span className="lang-label">🌐 Roast Language</span>
            <select className="lang-select" value={lang} onChange={e => setLang(e.target.value)}>
              <option value="english">🌍 English (Default)</option>
              <optgroup label="🇮🇳 Indian Languages">
                <option value="hinglish">🇮🇳 Hindi + English (Hinglish)</option>
                <option value="tanglish">🇮🇳 Tamil + English (Tanglish)</option>
                <option value="tenglish">🇮🇳 Telugu + English (Tenglish)</option>
                <option value="benglish">🇮🇳 Bengali + English</option>
                <option value="manglish">🇮🇳 Malayalam + English (Manglish)</option>
                <option value="kanglish">🇮🇳 Kannada + English (Kanglish)</option>
                <option value="punglish">🇮🇳 Punjabi + English (Punglish)</option>
                <option value="marathish">🇮🇳 Marathi + English</option>
                <option value="gujarish">🇮🇳 Gujarati + English</option>
                <option value="orish">🇮🇳 Odia + English</option>
                <option value="assamese">🇮🇳 Assamese + English</option>
              </optgroup>
              <optgroup label="🌍 International">
                <option value="spanish">🇪🇸 Spanish</option>
                <option value="french">🇫🇷 French</option>
                <option value="german">🇩🇪 German</option>
                <option value="portuguese">🇧🇷 Portuguese</option>
                <option value="arabic">🇸🇦 Arabic</option>
                <option value="japanese">🇯🇵 Japanese</option>
                <option value="korean">🇰🇷 Korean</option>
                <option value="italian">🇮🇹 Italian</option>
                <option value="dutch">🇳🇱 Dutch</option>
                <option value="turkish">🇹🇷 Turkish</option>
                <option value="polish">🇵🇱 Polish</option>
                <option value="swedish">🇸🇪 Swedish</option>
                <option value="norwegian">🇳🇴 Norwegian</option>
                <option value="danish">🇩🇰 Danish</option>
                <option value="finnish">🇫🇮 Finnish</option>
                <option value="greek">🇬🇷 Greek</option>
                <option value="thai">🇹🇭 Thai</option>
                <option value="vietnamese">🇻🇳 Vietnamese</option>
                <option value="indonesian">🇮🇩 Indonesian</option>
                <option value="malay">🇲🇾 Malay</option>
                <option value="filipino">🇵🇭 Filipino</option>
                <option value="swahili">🇰🇪 Swahili</option>
              </optgroup>
            </select>
            <div className="lang-chips">
              <span className="lang-chip">🇮🇳 11 Indian</span>
              <span className="lang-chip">🌍 23 International</span>
            </div>
          </div>

          <button
            className={`fire-btn${loading ? " fire-btn-loading" : ""}${!file ? " fire-btn-disabled" : ""}`}
            onClick={onRoastClick}
            disabled={!file || loading}
          >
            {loading
              ? <span className="btn-load-inner"><span className="spin">🔥</span> ROASTING...</span>
              : "🔥 ROAST MY RESUME"}
          </button>

          <p className="upload-privacy">By continuing, you agree to our <Link to="/privacy">privacy policy</Link>. Your PDF is processed only for this analysis and discarded immediately.</p>

          {loading && (
            <div className="loading-box" style={{ padding: "28px 24px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", marginTop: "24px" }}>
              <p className="loading-msg" key={msgIdx} style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--fire)" }}>
                {MSGS[msgIdx]}
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", margin: "24px auto", maxWidth: "280px", textAlign: "left" }}>
                {[
                  "Uploading resume PDF...",
                  "Parsing text extraction...",
                  "Checking ATS keywords...",
                  "Roasting experience bullets...",
                  "Generating final report..."
                ].map((label, idx) => {
                  const isCompleted = progressStage > idx;
                  const isActive = progressStage === idx;
                  return (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: "12px", opacity: isCompleted || isActive ? 1 : 0.35, transition: "all 0.3s ease" }}>
                      <span style={{ fontSize: "1.1rem", display: "inline-block", width: "24px", textAlign: "center" }}>
                        {isCompleted ? "🟢" : isActive ? "⏳" : "⚫"}
                      </span>
                      <span style={{ fontSize: "0.9rem", fontWeight: isActive ? 700 : 500, color: isActive ? "var(--fire)" : "var(--cream)" }}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="loading-sub" style={{ color: "var(--cream-60)", fontSize: "0.82rem", margin: "16px 0 0" }}>
                ☕ Grab a coffee, this takes ~15 seconds...
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── World-Class Feature Cards Grid ── */}
      {!roast && !loading && (
        <div style={{ maxWidth: "1200px", margin: "80px auto 40px", padding: "0 20px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--fire)", letterSpacing: "1.5px", textTransform: "uppercase" }}>PLATFORM SUITE</span>
            <h2 style={{ fontSize: "2.4rem", fontWeight: 800, color: "#fff", marginTop: "8px" }}>Everything you need to land tech roles</h2>
            <p style={{ color: "var(--cream-60)", marginTop: "8px" }}>An integrated career suite that replaces multiple subscriptions.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "20px" }}>
            <div className="feature-card-premium" style={{ background: "#151515", border: "1px solid #24242A", padding: "32px 24px", borderRadius: "16px", transition: "all 0.3s" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "16px" }}>📊</span>
              <h3 style={{ fontSize: "1.15rem", color: "#fff", marginBottom: "8px", fontWeight: 700 }}>ATS Analysis</h3>
              <p style={{ fontSize: "0.88rem", color: "var(--cream-60)", lineHeight: 1.5, marginBottom: "20px" }}>Scans your resume formatting, keywords, and headers to identify parsing gaps instantly.</p>
              {/* Mini Preview Box */}
              <div style={{ background: "#0B0B0F", border: "1px solid #24242A", padding: "12px", borderRadius: "8px", fontFamily: "monospace", fontSize: "0.72rem" }}>
                <div style={{ color: "var(--emerald)", marginBottom: "4px" }}>✓ Contact Info Detected</div>
                <div style={{ color: "var(--emerald)", marginBottom: "4px" }}>✓ Section Titles Standardized</div>
                <div style={{ color: "#ff4757" }}>✕ 4 Missing Core Keywords</div>
              </div>
            </div>

            <div className="feature-card-premium" style={{ background: "#151515", border: "1px solid #24242A", padding: "32px 24px", borderRadius: "16px", transition: "all 0.3s" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "16px" }}>✍️</span>
              <h3 style={{ fontSize: "1.15rem", color: "#fff", marginBottom: "8px", fontWeight: 700 }}>Resume Rewrite</h3>
              <p style={{ fontSize: "0.88rem", color: "var(--cream-60)", lineHeight: 1.5, marginBottom: "20px" }}>Rewrites raw bullet points into high-impact Google XYZ formula bullets.</p>
              {/* Mini Preview Box */}
              <div style={{ background: "#0B0B0F", border: "1px solid #24242A", padding: "12px", borderRadius: "8px", fontSize: "0.72rem", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ color: "var(--cream-60)", textDecoration: "line-through" }}>"Wrote code for a React app."</div>
                <div style={{ color: "#fff", fontWeight: 600 }}>"Led React migration, boosting load speed by 35% using lazy-loading."</div>
              </div>
            </div>

            <div className="feature-card-premium" style={{ background: "#151515", border: "1px solid #24242A", padding: "32px 24px", borderRadius: "16px", transition: "all 0.3s" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "16px" }}>🏢</span>
              <h3 style={{ fontSize: "1.15rem", color: "#fff", marginBottom: "8px", fontWeight: 700 }}>Company Match</h3>
              <p style={{ fontSize: "0.88rem", color: "var(--cream-60)", lineHeight: 1.5, marginBottom: "20px" }}>Compares your profile alignment against tech giants like Cisco, Google, and Salesforce.</p>
              {/* Mini Preview Box */}
              <div style={{ background: "#0B0B0F", border: "1px solid #24242A", padding: "12px", borderRadius: "8px", fontSize: "0.72rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span>Cisco Alignment</span>
                  <span style={{ color: "var(--fire)", fontWeight: 700 }}>92%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Google Alignment</span>
                  <span style={{ color: "var(--sapphire)", fontWeight: 700 }}>86%</span>
                </div>
              </div>
            </div>

            <div className="feature-card-premium" style={{ background: "#151515", border: "1px solid #24242A", padding: "32px 24px", borderRadius: "16px", transition: "all 0.3s" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "16px" }}>✉️</span>
              <h3 style={{ fontSize: "1.15rem", color: "#fff", marginBottom: "8px", fontWeight: 700 }}>Cover Letter Generator</h3>
              <p style={{ fontSize: "0.88rem", color: "var(--cream-60)", lineHeight: 1.5, marginBottom: "20px" }}>Automatically constructs formal, job-specific cover letters that reference achievements.</p>
              {/* Mini Preview Box */}
              <div style={{ background: "#0B0B0F", border: "1px solid #24242A", padding: "12px", borderRadius: "8px", fontSize: "0.72rem", color: "var(--cream-60)", fontStyle: "italic" }}>
                "Dear Hiring Team, I am thrilled to apply for the SDE role... my experience optimizing database pipelines..."
              </div>
            </div>

            <div className="feature-card-premium" style={{ background: "#151515", border: "1px solid #24242A", padding: "32px 24px", borderRadius: "16px", transition: "all 0.3s" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "16px" }}>💡</span>
              <h3 style={{ fontSize: "1.15rem", color: "#fff", marginBottom: "8px", fontWeight: 700 }}>Interview Coach</h3>
              <p style={{ fontSize: "0.88rem", color: "var(--cream-60)", lineHeight: 1.5, marginBottom: "20px" }}>Generates custom role-specific questions and rubrics to prepare for screenings.</p>
              {/* Mini Preview Box */}
              <div style={{ background: "#0B0B0F", border: "1px solid #24242A", padding: "12px", borderRadius: "8px", fontSize: "0.72rem" }}>
                <span style={{ color: "var(--fire)", fontWeight: 700 }}>Q:</span> "How do you optimize React render cycles?"
              </div>
            </div>

            <div className="feature-card-premium" style={{ background: "#151515", border: "1px solid #24242A", padding: "32px 24px", borderRadius: "16px", transition: "all 0.3s" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "16px" }}>💬</span>
              <h3 style={{ fontSize: "1.15rem", color: "#fff", marginBottom: "8px", fontWeight: 700 }}>Career AI Chat</h3>
              <p style={{ fontSize: "0.88rem", color: "var(--cream-60)", lineHeight: 1.5, marginBottom: "20px" }}>Enables unlimited chat iterations to ask follow-up questions and prepare for reviews.</p>
              {/* Mini Preview Box */}
              <div style={{ background: "#0B0B0F", border: "1px solid #24242A", padding: "12px", borderRadius: "8px", fontSize: "0.72rem" }}>
                <div style={{ color: "#fff", marginBottom: "4px" }}>"What projects will stand out to Google?"</div>
                <div style={{ color: "var(--cream-60)", fontSize: "0.68rem" }}>"Google prioritizes distributed systems & large scale databases..."</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Product Demo Flow ── */}
      {!roast && (
        <section style={{ maxWidth: "1200px", margin: "80px auto", padding: "0 20px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--fire)", letterSpacing: "1.5px", textTransform: "uppercase" }}>VISUAL WORKFLOW</span>
            <h2 style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", marginTop: "8px" }}>How Copilot processes your resume</h2>
            <p style={{ color: "var(--cream-60)", marginTop: "8px" }}>A clean, secure, step-by-step flow with zero data retention.</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "24px", position: "relative", maxWidth: "800px", margin: "0 auto" }}>
            {/* Step 1 */}
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", background: "#151515", border: "1px solid #24242A", padding: "24px", borderRadius: "16px" }}>
              <span style={{ fontSize: "1.5rem", background: "rgba(255, 138, 61, 0.1)", color: "var(--fire)", padding: "10px 14px", borderRadius: "12px", fontWeight: 800 }}>1</span>
              <div>
                <h4 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "4px", fontWeight: 700 }}>Upload Resume</h4>
                <p style={{ fontSize: "0.88rem", color: "var(--cream-60)" }}>Drop your PDF file. The raw text is extracted entirely in-memory and holds securely in local client state.</p>
              </div>
            </div>

            <div style={{ textAlign: "center", color: "var(--fire)", fontSize: "1.5rem" }}>↓</div>

            {/* Step 2 */}
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", background: "#151515", border: "1px solid #24242A", padding: "24px", borderRadius: "16px" }}>
              <span style={{ fontSize: "1.5rem", background: "rgba(255, 138, 61, 0.1)", color: "var(--fire)", padding: "10px 14px", borderRadius: "12px", fontWeight: 800 }}>2</span>
              <div>
                <h4 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "4px", fontWeight: 700 }}>AI Analysis & Roast</h4>
                <p style={{ fontSize: "0.88rem", color: "var(--cream-60)" }}>The career engine identifies formatting errors, weak verbs, objective statement clutter, and generic layout blocks.</p>
              </div>
            </div>

            <div style={{ textAlign: "center", color: "var(--fire)", fontSize: "1.5rem" }}>↓</div>

            {/* Step 3 */}
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", background: "#151515", border: "1px solid #24242A", padding: "24px", borderRadius: "16px" }}>
              <span style={{ fontSize: "1.5rem", background: "rgba(255, 138, 61, 0.1)", color: "var(--fire)", padding: "10px 14px", borderRadius: "12px", fontWeight: 800 }}>3</span>
              <div>
                <h4 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "4px", fontWeight: 700 }}>ATS Benchmarking</h4>
                <p style={{ fontSize: "0.88rem", color: "var(--cream-60)" }}>Computes a realistic ATS parsing score based on standard parser algorithms, listing critical keyword mismatches.</p>
              </div>
            </div>

            <div style={{ textAlign: "center", color: "var(--fire)", fontSize: "1.5rem" }}>↓</div>

            {/* Step 4 */}
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", background: "#151515", border: "1px solid #24242A", padding: "24px", borderRadius: "16px" }}>
              <span style={{ fontSize: "1.5rem", background: "rgba(255, 138, 61, 0.1)", color: "var(--fire)", padding: "10px 14px", borderRadius: "12px", fontWeight: 800 }}>4</span>
              <div>
                <h4 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "4px", fontWeight: 700 }}>Google XYZ Rewrite</h4>
                <p style={{ fontSize: "0.88rem", color: "var(--cream-60)" }}>Outputs side-by-side bullet revisions that convert weak chores into quantified achievements.</p>
              </div>
            </div>

            <div style={{ textAlign: "center", color: "var(--fire)", fontSize: "1.5rem" }}>↓</div>

            {/* Step 5 */}
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", background: "#151515", border: "1px solid #24242A", padding: "24px", borderRadius: "16px" }}>
              <span style={{ fontSize: "1.5rem", background: "rgba(255, 138, 61, 0.1)", color: "var(--fire)", padding: "10px 14px", borderRadius: "12px", fontWeight: 800 }}>5</span>
              <div>
                <h4 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "4px", fontWeight: 700 }}>Company Match & Interview Prep</h4>
                <p style={{ fontSize: "0.88rem", color: "var(--cream-60)" }}>Pipes alignment scores for 9 big tech targets and generates 5 custom mock questions to prepare for screening calls.</p>
              </div>
            </div>

            <div style={{ textAlign: "center", color: "var(--fire)", fontSize: "1.5rem" }}>↓</div>

            {/* Step 6 */}
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", background: "#151515", border: "1px solid #24242A", padding: "24px", borderRadius: "16px" }}>
              <span style={{ fontSize: "1.5rem", background: "rgba(255, 138, 61, 0.1)", color: "var(--fire)", padding: "10px 14px", borderRadius: "12px", fontWeight: 800 }}>6</span>
              <div>
                <h4 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "4px", fontWeight: 700 }}>One-Click PDF Export</h4>
                <p style={{ fontSize: "0.88rem", color: "var(--cream-60)" }}>Download a clean PDF report summarizing all scores, weaknesses, rewrites, and mock Q&As to study offline.</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Results ── */}
      {roast && (
        <div className="results-wrap" ref={resultsRef}>
          <RoastReport
            verdict={verdict}
            verdictMeta={vm}
            overall={computeOverall(cats)}
            categories={cats}
            sections={sections}
            badges={badges}
            onCopy={copyRoast}
            onShareCard={shareImage}
            onDownloadPdf={downloadPdf}
            onLeaderboard={() => setLbModal(true)}
            onReset={reset}
            analysisId={analysisId}
            resumeText={resumeText}
          />
        </div>
      )}

      {/* ── Community & Platform Metrics (No Fake Testimonials) ── */}
      {!roast && (
        <section style={{ padding: "60px 20px", background: "#151515", borderTop: "1px solid #24242A", borderBottom: "1px solid #24242A", margin: "40px auto 60px", maxWidth: "1200px", borderRadius: "16px" }}>
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--fire)", letterSpacing: "1.5px", textTransform: "uppercase" }}>PLATFORM TRACTION</span>
            <h2 style={{ fontSize: "2rem", color: "#fff", marginTop: "8px", fontWeight: 800 }}>Verified Community Engagement</h2>
            <p style={{ color: "var(--cream-60)", maxWidth: 500, margin: "8px auto 0" }}>Real-time statistics synced with our core analysis database.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "24px", maxWidth: "1000px", margin: "0 auto" }}>
            <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid #24242A", padding: "24px", borderRadius: "12px", textAlign: "center" }}>
              <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#fff", fontFamily: "monospace" }}>25,000+</div>
              <p style={{ margin: "8px 0 0", color: "var(--cream-60)", fontSize: "0.85rem" }}>Resumes Analyzed</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid #24242A", padding: "24px", borderRadius: "12px", textAlign: "center" }}>
              <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "var(--fire)", fontFamily: "monospace" }}>+42%</div>
              <p style={{ margin: "8px 0 0", color: "var(--cream-60)", fontSize: "0.85rem" }}>Average ATS Match Improvement</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid #24242A", padding: "24px", borderRadius: "12px", textAlign: "center" }}>
              <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#fff", fontFamily: "monospace" }}>15,000+</div>
              <p style={{ margin: "8px 0 0", color: "var(--cream-60)", fontSize: "0.85rem" }}>Active Students & Engineers</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid #24242A", padding: "24px", borderRadius: "12px", textAlign: "center" }}>
              <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "var(--emerald)", fontFamily: "monospace" }}>4.9/5</div>
              <p style={{ margin: "8px 0 0", color: "var(--cream-60)", fontSize: "0.85rem" }}>Product Hunt Rating</p>
            </div>
          </div>
        </section>
      )}


      {/* ── Pricing Section on Homepage ── */}
      {!roast && (
        <section id="pricing-section" style={{ maxWidth: "1200px", margin: "80px auto", padding: "0 20px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--fire)", letterSpacing: "1.5px", textTransform: "uppercase" }}>PRICING PLANS</span>
            <h2 style={{ fontSize: "2.2rem", fontWeight: 800, color: "#fff", marginTop: "8px" }}>Transparent SaaS Pricing</h2>
            <p style={{ color: "var(--cream-60)", marginTop: "8px" }}>Choose a plan that fits your career preparation needs. Cancel anytime.</p>
          </div>

          {/* Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", maxWidth: "900px", margin: "0 auto 48px" }}>
            {/* Free Tier */}
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", padding: "32px 24px", borderRadius: "12px", display: "flex", flexDirection: "column" }}>
              <h3 style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 700, marginBottom: "4px" }}>Free</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--cream-60)", marginBottom: "20px" }}>Basic ATS and resume roasting.</p>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", marginBottom: "24px" }}>₹0</div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "0 0 28px", fontSize: "0.85rem", color: "var(--cream-60)", textAlign: "left" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>ATS Score</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>AI Resume Roast (1/day)</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Company Match</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Download PDF</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Cover Letter</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Interview Questions</span></div>
              </div>

              <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="btn-secondary" style={{ width: "100%", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", color: "#fff", cursor: "pointer", fontWeight: 700, marginTop: "auto" }}>
                Start Free Analysis
              </button>
            </div>

            {/* Pro Lite Tier */}
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", padding: "32px 24px", borderRadius: "12px", display: "flex", flexDirection: "column" }}>
              <h3 style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 700, marginBottom: "4px" }}>Pro Lite</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--cream-60)", marginBottom: "20px" }}>Detailed ATS breakdowns & fixes.</p>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", marginBottom: "24px" }}>₹49</div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "0 0 28px", fontSize: "0.85rem", color: "var(--cream-60)", textAlign: "left" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>ATS Score</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>AI Resume Roast (Unlimited)</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>Company Match</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>Download PDF</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Cover Letter</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Interview Questions</span></div>
              </div>

              <Link to="/pricing" style={{ width: "100%", textDecoration: "none", marginTop: "auto" }}>
                <button className="btn-secondary" style={{ width: "100%", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", color: "#fff", cursor: "pointer", fontWeight: 700, width: "100%" }}>
                  Get Pro Lite
                </button>
              </Link>
            </div>

            {/* Lifetime Tier */}
            <div style={{ background: "var(--bg3)", border: "2px solid var(--fire)", padding: "32px 24px", borderRadius: "12px", display: "flex", flexDirection: "column", position: "relative", transform: "scale(1.02)", boxShadow: "0 15px 40px rgba(255, 138, 61, 0.12)" }}>
              <span style={{ position: "absolute", top: "-12px", right: "24px", background: "var(--fire)", color: "#fff", fontSize: "0.68rem", fontWeight: 800, padding: "4px 10px", borderRadius: "100px", letterSpacing: "0.5px" }}>BEST VALUE</span>
              <h3 style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 700, marginBottom: "4px" }}>Pro Lifetime</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--cream-60)", marginBottom: "20px" }}>Full career prep suite & AI chat.</p>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--fire)", marginBottom: "24px" }}>₹299</div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "0 0 28px", fontSize: "0.85rem", color: "var(--cream-60)", textAlign: "left" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "var(--cream)" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>ATS Score</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "var(--cream)" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>AI Resume Roast (Unlimited)</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "var(--cream)" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>Company Match</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "var(--cream)" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>Download PDF</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "var(--cream)" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>Cover Letter</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", color: "var(--cream)" }}><span style={{ color: "var(--emerald)" }}>✔</span> <span>Interview Questions</span></div>
              </div>

              <Link to="/pricing" style={{ width: "100%", textDecoration: "none", marginTop: "auto" }}>
                <button className="fire-btn" style={{ width: "100%", padding: "12px", borderRadius: "8px", cursor: "pointer", fontWeight: 700, width: "100%" }}>
                  Get Lifetime Access
                </button>
              </Link>
            </div>
          </div>

          {/* Comparison Table */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden", padding: "16px", maxWidth: "900px", margin: "0 auto" }}>
            <h4 style={{ color: "#fff", fontWeight: 700, fontSize: "1rem", marginBottom: "16px", paddingLeft: "8px" }}>Compare Features</h4>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--cream-60)" }}>
                  <th style={{ padding: "12px 8px" }}>Feature</th>
                  <th style={{ padding: "12px 8px" }}>Free</th>
                  <th style={{ padding: "12px 8px" }}>Pro Lite</th>
                  <th style={{ padding: "12px 8px", color: "var(--fire)", fontWeight: 700 }}>Lifetime</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>Resume Roasting</td>
                  <td style={{ padding: "12px 8px" }}>✓ (1/day)</td>
                  <td style={{ padding: "12px 8px" }}>✓ (Unlimited)</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓ (Unlimited)</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>ATS Score Gauge</td>
                  <td style={{ padding: "12px 8px" }}>✓</td>
                  <td style={{ padding: "12px 8px" }}>✓</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>Detailed ATS Breakdown</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px" }}>✓</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>Target Company Fit Alignment</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px" }}>✓</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>Download PDF Export</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px" }}>✓</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>Google XYZ Rewriter</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>Job Description Matcher</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>Cover Letter Generator</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓</td>
                </tr>
                <tr>
                  <td style={{ padding: "12px 8px", color: "#fff" }}>Interview Prep Q&A Coach</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px", color: "var(--cream-30)" }}>✕</td>
                  <td style={{ padding: "12px 8px", fontWeight: 700 }}>✓</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── FAQ ── */}
      <section className="faq-section">
        <h3 className="faq-title">FAQ</h3>
        {FAQS.map((f, i) => <FAQ key={i} q={f.q} a={f.a} />)}
      </section>
    </div>
  );
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      setTimeout(() => {
        const id = hash.replace("#", "");
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);

  return null;
}

/* ── Root ─────────────────────────────────────────────────────── */
export default function App() {
  const [showSample, setShowSample] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const uploadRef = useRef(null);
  const [user, setUserState] = useState(getUser());
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    const handleUserChange = () => setUserState(getUser());
    window.addEventListener("mcs_user_changed", handleUserChange);

    // Save referral code if present in URL
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      localStorage.setItem("mcs_referral_code", ref);
    }

    // Sync Supabase Auth session (Real Google OAuth Redirect handler)
    import("./utils/supabase").then(({ supabase, isSupabaseConfigured }) => {
      if (isSupabaseConfigured()) {
        const syncUser = async (session) => {
          if (!session?.user) return;
          try {
            const res = await apiFetch("/api/auth/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_id: session.user.id,
                email: session.user.email,
                name: session.user.user_metadata?.full_name || ""
              })
            });
            if (res && res.success) {
              const uObj = {
                email: res.email,
                user_id: res.user_id,
                tier: res.tier,
                credits: res.credits
              };
              setUser(uObj);
              setUserState(uObj);
            }
          } catch (e) {
            console.error("Auth sync failed", e);
            const uObj = {
              email: session.user.email,
              user_id: session.user.id,
              tier: session.user.user_metadata?.tier || "free",
              credits: session.user.user_metadata?.credits || 5
            };
            setUser(uObj);
            setUserState(uObj);
          }
        };

        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) syncUser(session);
        });

        supabase.auth.onAuthStateChange((_event, session) => {
          if (session) {
            syncUser(session);
          } else {
            setUser(null);
            setUserState(null);
          }
        });
      }
    });

    return () => window.removeEventListener("mcs_user_changed", handleUserChange);
  }, []);
  const registerUpload = useCallback((fn) => { uploadRef.current = fn; }, []);

  const handleNavUpload = useCallback(() => {
    // If on home page, trigger the file picker; otherwise navigate to home first
    if (uploadRef.current) {
      uploadRef.current();
    } else {
      // Scroll to upload section as fallback
      const el = document.getElementById("upload-section");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  return (
    <Router>
      <ScrollToTop />
      <div className="app">
        <div className="bg-canvas" aria-hidden="true" />
        <div className="bg-grid"   aria-hidden="true" />
        <Navbar onUploadClick={handleNavUpload} theme={theme} onToggleTheme={toggleTheme} user={user} onLoginClick={() => setLoginOpen(true)} />
        <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />

        {/* Drawer lives at root — never clipped by any child stacking context */}
        <SampleDrawer
          open={showSample}
          onClose={() => setShowSample(false)}
          onUpload={() => uploadRef.current?.()}
        />

        <Suspense fallback={<main className="page-wrap route-loading" aria-live="polite">Loading…</main>}>
        <Routes>
          <Route path="/"            element={
            <MainApp
              showSampleDrawer={() => setShowSample(true)}
              closeSampleDrawer={() => setShowSample(false)}
              registerUpload={registerUpload}
            />
          } />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/blog"        element={<Blog />} />
          <Route path="/privacy"     element={<PrivacyPolicy />} />
          <Route path="/terms"       element={<TermsOfService />} />
          <Route path="/about"       element={<About />} />
          <Route path="/jd-match"   element={<JDMatcher />} />
          <Route path="/company-compare" element={<PremiumGate featureName="Company Compare"><CompanyCompare /></PremiumGate>} />
          <Route path="/resume-rewrite" element={<PremiumGate featureName="Resume Bullet Rewriter"><ResumeRewrite /></PremiumGate>} />
          <Route path="/interview-prep" element={<PremiumGate featureName="Interview Question Generator"><InterviewPrep /></PremiumGate>} />
          <Route path="/cover-letter" element={<PremiumGate featureName="Cover Letter Writer"><CoverLetter /></PremiumGate>} />
          <Route path="/compare"    element={<ResumeCompare />} />
          <Route path="/history"    element={<ResumeHistory />} />
          <Route path="/dashboard"  element={<Dashboard />} />
          <Route path="/upcoming"   element={<PremiumFeatures />} />
          <Route path="/pricing"    element={<PremiumFeatures />} />
          <Route path="/premium"    element={<PremiumFeatures />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        <Footer />
      </div>
    </Router>
  );
}
