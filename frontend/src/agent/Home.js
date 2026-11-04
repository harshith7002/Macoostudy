import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDocTitle } from "./Shell";
import { GapBadge, Icon, LabelBadge, StatusBadge, TONE_HEX } from "./ui";
import "./agent.css";
import "./home.css";

/* ──────────────────────────────────────────────────────────────────────
   Illustrative sample. Every place it renders is labelled as such.
   Points use the real backend rubric weights (career_agent/rubric.py):
   demonstrated = 100%, partial = 50%, not shown = 0.
   ────────────────────────────────────────────────────────────────────── */
const TRACES = [
  {
    key: "supported",
    claim: "Implemented idempotent webhook handling for Razorpay payment events to prevent double credits",
    claimId: "clm_03fb", line: 8, competency: "Backend engineering", skills: ["razorpay", "webhook"],
    question: "What happens when Razorpay delivers the same payment event twice?",
    answer: "Each event id goes into a table with a unique index, so a retried delivery fails the insert and we skip it. I replayed the same event in a unit test to prove we only credit once.",
    excerpt: "a retried delivery fails the insert and we skip it",
    criterion: "Failure handling & debugging",
    label: "demonstrated", status: "SUPPORTED", score: 85,
    ledger: [["Implementation detail", 25, "demonstrated"], ["Design rationale", 15, "demonstrated"], ["Trade-off awareness", 20, "partial"],
      ["Failure handling & debugging", 20, "demonstrated"], ["Validation & measurement", 10, "demonstrated"], ["API & data contracts", 10, "partial"]],
  },
  {
    key: "partial",
    claim: "Reduced p95 latency of the order lookup endpoint by 40% by adding Redis caching",
    claimId: "clm_8811", line: 7, competency: "Databases", skills: ["redis", "caching"],
    question: "How did you decide what to cache, and how do stale entries get invalidated?",
    answer: "We cached order lookups with a 60 second TTL, which cut most repeat reads. I'm not sure how invalidation worked when an order changed.",
    excerpt: "We cached order lookups with a 60 second TTL",
    criterion: "Data modelling & queries",
    label: "partial", status: "PARTIALLY SUPPORTED", score: 55,
    ledger: [["Implementation detail", 25, "demonstrated"], ["Design rationale", 15, "demonstrated"], ["Trade-off awareness", 20, "partial"],
      ["Failure handling & debugging", 20, "not_demonstrated"], ["Validation & measurement", 10, "not_demonstrated"], ["Data modelling & queries", 10, "partial"]],
  },
  {
    key: "insufficient",
    claim: "Developed a React dashboard with Recharts to visualise resume scores for 2,000 users",
    claimId: "clm_f3fe", line: 10, competency: "Frontend engineering", skills: ["react"],
    question: "Where did the dashboard's state live, and what triggered a re-render?",
    answer: "I don't remember exactly. A teammate set that part up and I mostly styled the charts.",
    excerpt: "I don't remember exactly.",
    criterion: "State & rendering",
    label: "not_demonstrated", status: "INSUFFICIENT EVIDENCE", score: 10,
    ledger: [["Implementation detail", 25, "not_demonstrated"], ["Design rationale", 15, "not_demonstrated"], ["Trade-off awareness", 20, "not_demonstrated"],
      ["Failure handling & debugging", 20, "partial"], ["Validation & measurement", 10, "not_demonstrated"], ["State & rendering", 10, "not_demonstrated"]],
  },
];
const W = { demonstrated: 1, partial: 0.5, not_demonstrated: 0 };
const TONE = { SUPPORTED: "good", "PARTIALLY SUPPORTED": "mid", "INSUFFICIENT EVIDENCE": "low" };
const STEPS = ["Claim", "Question", "Answer", "Evidence", "Verdict"];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return undefined;
    setReduced(mq.matches);
    const on = (e) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

function Illustrative({ children = "Illustrative sample" }) {
  return <span className="hx-illus"><Icon name="eye" size={12} />{children}</span>;
}

function Answer({ t }) {
  const i = t.answer.indexOf(t.excerpt);
  if (i < 0) return t.answer;
  return <>{t.answer.slice(0, i)}<mark className={`hx-mark hx-mark--${TONE[t.status]}`}>{t.excerpt}</mark>{t.answer.slice(i + t.excerpt.length)}</>;
}

/* ── Hero: the claim → evidence trace ─────────────────────────────────── */
function Trace() {
  const reduced = usePrefersReducedMotion();
  const [sel, setSel] = useState(0);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const t = TRACES[sel];
  const tone = TONE[t.status];

  useEffect(() => {
    if (reduced || paused) return undefined;
    const id = setInterval(() => setStep(s => (s + 1) % (STEPS.length + 2)), 1100);
    return () => clearInterval(id);
  }, [reduced, paused]);

  const lit = (i) => reduced || paused || step >= i;
  const pick = (i) => { setSel(i); setStep(0); };

  return (
    <figure className="hx-trace" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} aria-label="Claim to evidence trace, illustrative sample">
      <div className="hx-trace__bar">
        <div className="hx-trace__title"><span className="hx-dotrow" aria-hidden="true"><i /><i /><i /></span>claim-trace</div>
        <div className="hx-tabs" role="tablist" aria-label="Sample claims">
          {TRACES.map((x, i) => (
            <button key={x.key} role="tab" aria-selected={sel === i} onClick={() => pick(i)} className="hx-tab">
              <i className={`ca-sw ca-sw--${TONE[x.status]}`} />{x.status === "SUPPORTED" ? "Supported" : x.status === "PARTIALLY SUPPORTED" ? "Partial" : "Insufficient"}
            </button>
          ))}
        </div>
        <Illustrative />
      </div>

      <ol className="hx-chain" key={t.key}>
        <li className={`hx-node${lit(0) ? " is-lit" : ""}`}>
          <span className="hx-node__k">01 · Claim</span>
          <p className="hx-node__resume"><span className="hx-node__ln">{t.line}</span><span className="hx-hlclaim">{t.claim}</span></p>
          <div className="hx-node__meta"><span className="ca-mono">{t.claimId}</span><span>{t.competency}</span></div>
        </li>
        <li className={`hx-node${lit(1) ? " is-lit" : ""}`}>
          <span className="hx-node__k">02 · Question</span>
          <p className="hx-node__q">{t.question}</p>
          <div className="hx-node__meta"><span>Probing {t.criterion.toLowerCase()}</span></div>
        </li>
        <li className={`hx-node${lit(2) ? " is-lit" : ""}`}>
          <span className="hx-node__k">03 · Answer</span>
          <p className="hx-node__a"><Answer t={t} /></p>
        </li>
        <li className={`hx-node${lit(3) ? " is-lit" : ""}`}>
          <span className="hx-node__k">04 · Evidence</span>
          <blockquote className={`hx-ev hx-ev--${tone}`}>“{t.excerpt}”</blockquote>
          <div className="hx-node__meta hx-node__meta--wrap"><span>{t.criterion}</span><LabelBadge label={t.label} /></div>
        </li>
        <li className={`hx-node hx-node--verdict${lit(4) ? " is-lit" : ""}`}>
          <span className="hx-node__k">05 · Verdict</span>
          <div className="hx-verdict">
            <span className={`hx-verdict__n ca-t-${tone}`}>{t.score}</span><span className="hx-verdict__of">/100</span>
          </div>
          <div className="hx-meter" aria-hidden="true"><span style={{ width: `${t.score}%`, background: TONE_HEX[tone] }} /><i style={{ left: "35%" }} /><i style={{ left: "70%" }} /></div>
          <StatusBadge status={t.status} />
        </li>
      </ol>
      <figcaption className="hx-trace__cap">
        The excerpt in <b>03</b> is quoted verbatim in <b>04</b>; the rubric turns labelled evidence into the score in <b>05</b>.
      </figcaption>
    </figure>
  );
}

/* ── Section 2: the evaluation ledger ─────────────────────────────────── */
function Ledger() {
  const [sel, setSel] = useState(1);
  const t = TRACES[sel];
  const rows = t.ledger.map(([name, pts, label]) => ({ name, pts, label, got: pts * W[label] }));
  const total = rows.reduce((s, r) => s + r.got, 0);
  const tone = total >= 70 ? "good" : total >= 35 ? "mid" : "low";
  return (
    <div className="hx-ledger">
      <div className="hx-ledger__claims" role="tablist" aria-label="Choose a claim">
        {TRACES.map((x, i) => (
          <button key={x.key} role="tab" aria-selected={sel === i} onClick={() => setSel(i)} className="hx-lclaim">
            <span className="hx-lclaim__top"><span className="ca-mono">{x.claimId}</span><StatusBadge status={x.status} small /></span>
            <span className="hx-lclaim__t">{x.claim}</span>
          </button>
        ))}
        <Illustrative>Illustrative sample · real rubric weights</Illustrative>
      </div>
      <div className="hx-ledger__sheet" aria-live="polite">
        <div className="hx-ledger__head"><span>Criterion</span><span>Label</span><span className="hx-r">Points</span></div>
        {rows.map(r => (
          <div className="hx-ledger__row" key={r.name}>
            <span>{r.name}</span>
            <span><LabelBadge label={r.label} /></span>
            <span className="hx-r ca-mono"><span className="ca-faint">{r.pts} × {W[r.label]} =</span> <b>{r.got}</b></span>
          </div>
        ))}
        <div className="hx-ledger__total">
          <span>Claim score</span>
          <span className={`hx-ledger__score ca-t-${tone}`}>{total}<small>/100</small></span>
        </div>
        <div className="hx-ledger__rule">
          <span className={tone === "low" ? "on" : ""}>&lt; 35 Insufficient evidence</span>
          <span className={tone === "mid" ? "on" : ""}>35–69 Partially supported</span>
          <span className={tone === "good" ? "on" : ""}>≥ 70 Supported</span>
        </div>
        <p className="hx-ledger__note">The model only chooses each label, and must cite a verbatim excerpt to do it. A label without evidence is downgraded to "not shown" before the backend adds up the points.</p>
      </div>
    </div>
  );
}

/* ── Section 4: heatmap ──────────────────────────────────────────────── */
function HeatmapShowcase() {
  const [sel, setSel] = useState(0);
  const order = [TRACES[1], TRACES[0], TRACES[2]];
  const t = order[sel];
  const missing = t.ledger.filter(([, , l]) => l !== "demonstrated");
  return (
    <div className="hx-heat">
      <div className="ca-doc hx-heat__doc">
        <div className="ca-doc__bar"><span>resume.pdf · reconstructed text</span><Illustrative /></div>
        <div className="hx-heat__page">
          <p className="hx-heat__h">Experience</p>
          <p className="hx-heat__muted">Software Engineering Intern, Acme Payments · 2025</p>
          {order.slice(0, 2).map((x, i) => (
            <p key={x.key}><button type="button" className={`ca-hl ca-hl--${TONE[x.status]}${sel === i ? " is-selected" : ""}`} onClick={() => setSel(i)} aria-pressed={sel === i}>{x.claim}</button></p>
          ))}
          <p className="hx-heat__h">Projects</p>
          <p><button type="button" className={`ca-hl ca-hl--low${sel === 2 ? " is-selected" : ""}`} onClick={() => setSel(2)} aria-pressed={sel === 2}>{order[2].claim}</button></p>
          <p className="hx-heat__muted">Skills: Python, Flask, React, PostgreSQL, Redis, Docker</p>
        </div>
      </div>
      <div className="hx-insp" aria-live="polite">
        <div className="hx-insp__row"><span className="hx-node__k">Evidence inspector</span><span className={`hx-insp__score ca-t-${TONE[t.status]}`}>{t.score}<small>/100</small></span></div>
        <StatusBadge status={t.status} />
        <p className="hx-insp__claim">{t.claim}</p>
        <div className="hx-insp__sec"><span className="hx-node__k">Your answer</span><p className="hx-node__a"><Answer t={t} /></p></div>
        <div className="hx-insp__sec"><span className="hx-node__k">Missing criteria</span>
          <ul>{missing.map(([n, , l]) => <li key={n}><span>{n}</span><LabelBadge label={l} /></li>)}</ul>
        </div>
      </div>
    </div>
  );
}

/* ── Section 5: gap types ─────────────────────────────────────────────── */
const GAPS = [
  { gap: "knowledge_gap", title: "Knowledge gap", answer: "I'm not sure how invalidation worked. Someone else chose the TTL.",
    means: "The concept itself isn't solid yet. Rehearsing won't fix it; learning it will.", fix: "Study how cache invalidation strategies trade freshness against load." },
  { gap: "weak_articulation", title: "Communication gap", answer: "We used Redis and it made things a lot faster, we tuned some stuff until it worked.",
    means: "You probably did the work, but the answer has no decision, no alternative, no number.", fix: "Practise a structured answer: context, decision, alternative, result." },
  { gap: "insufficient_evidence", title: "Insufficient evidence", answer: "Not asked: the interview ended before this criterion came up.",
    means: "Nothing either way. It is not a judgement on whether the claim is true.", fix: "Prepare one concrete example you can walk through in two minutes." },
];

export default function Home() {
  useDocTitle("Can you defend your resume?");
  const scrollTo = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return (
    <div className="ca hx">
      {/* 1 · Hero */}
      <header className="hx-hero">
        <div className="hx-wrap">
          <p className="hx-eyebrow"><span className="hx-sq" aria-hidden="true" />Your resume makes claims. We put them to the test.</p>
          <h1 className="hx-h1">Can you actually <em>defend</em> what's on your resume?</h1>
          <div className="hx-hero__grid">
            <div>
              <p className="hx-lead">Find out before the interviewer does. Macoostudy challenges your technical claims through adaptive interviews and connects every assessment to the evidence behind your answers.</p>
              <div className="hx-cta">
                <Link to="/agent/new" className="ca-btn ca-btn--primary ca-btn--lg">Test Your Skills<Icon name="arrowRight" /></Link>
                <a href="#how" onClick={scrollTo("how")} className="ca-btn ca-btn--secondary ca-btn--lg">See How It Works</a>
              </div>
            </div>
            <dl className="hx-def" aria-label="What Macoostudy is">
              <dt>Macoostudy Career Agent <span>noun</span></dt>
              <dd className="hx-def__main">An AI technical skill auditor.</dd>
              <dd><Icon name="x" size={13} className="ca-faint" />Not a resume optimizer</dd>
              <dd><Icon name="x" size={13} className="ca-faint" />Not a mock-interview chatbot</dd>
              <dd><Icon name="check" size={13} className="ca-t-accent" />Tests each claim, cites your exact words</dd>
            </dl>
          </div>
          <Trace />
        </div>
      </header>

      {/* 2 · Claim → evidence ledger */}
      <section className="hx-sec" id="how" aria-labelledby="s2">
        <div className="hx-wrap hx-split">
          <div className="hx-rail"><span className="hx-num">02</span><span className="hx-railt">Claim to evidence</span></div>
          <div>
            <h2 className="hx-h2" id="s2">Every verdict has a paper trail.</h2>
            <p className="hx-p">Pick a claim. Each rubric criterion is labelled from what you said; the points are fixed and the arithmetic is visible. Same answers, same score, every time.</p>
            <Ledger />
          </div>
        </div>
      </section>

      {/* 3 · Three steps */}
      <section className="hx-sec" aria-labelledby="s3">
        <div className="hx-wrap hx-split">
          <div className="hx-rail"><span className="hx-num">03</span><span className="hx-railt">How it works</span></div>
          <div>
            <h2 className="hx-h2" id="s3">Three steps. About ten questions.</h2>
            <ol className="hx-steps">
              <li>
                <span className="hx-steps__n">1</span>
                <div><h3>Extract your claims</h3><p>Upload your resume and the job description. Every concrete bullet becomes a claim with its exact location, its skills and the competency it implies. The ones that matter for the job go first.</p></div>
                <div className="hx-mini"><span className="ca-mono ca-faint">line 6</span><span className="hx-hlclaim">Built a Flask REST API with PostgreSQL…</span>
                  <div className="ca-tags"><span className="ca-tag ca-tag--match">flask</span><span className="ca-tag ca-tag--match">postgresql</span><span className="ca-badge ca-badge--sm">Backend engineering</span></div></div>
              </li>
              <li>
                <span className="hx-steps__n">2</span>
                <div><h3>Defend them in an adaptive interview</h3><p>Each question targets one rubric criterion: implementation, design decisions, trade-offs, failure modes. Follow-ups pick up what you actually said, and no question repeats.</p></div>
                <div className="hx-mini"><span className="hx-follow"><Icon name="reply" size={12} />Following up on “idempotency key”</span>
                  <span className="hx-mini__q">What's the most likely way that fails in production, and how would you notice?</span></div>
              </li>
              <li>
                <span className="hx-steps__n">3</span>
                <div><h3>See the evidence and fix your gaps</h3><p>A resume heatmap, a report and practice tasks. Every verdict links back to the answer behind it, and every gap gets an exercise.</p></div>
                <div className="hx-mini hx-mini--row"><StatusBadge status="SUPPORTED" small /><StatusBadge status="PARTIALLY SUPPORTED" small /><StatusBadge status="INSUFFICIENT EVIDENCE" small /></div>
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* 4 · Heatmap */}
      <section className="hx-sec" aria-labelledby="s4">
        <div className="hx-wrap hx-split">
          <div className="hx-rail"><span className="hx-num">04</span><span className="hx-railt">Resume heatmap</span></div>
          <div>
            <h2 className="hx-h2" id="s4">Your resume, line by line, marked by what you could defend.</h2>
            <p className="hx-p">Green, amber or red at the exact characters of each claim. Select one to see the answer behind the verdict and what's still missing.</p>
            <HeatmapShowcase />
          </div>
        </div>
      </section>

      {/* 5 · Gap types */}
      <section className="hx-sec" aria-labelledby="s5">
        <div className="hx-wrap hx-split">
          <div className="hx-rail"><span className="hx-num">05</span><span className="hx-railt">Gaps, separated</span></div>
          <div>
            <h2 className="hx-h2" id="s5">Not knowing and not explaining are different problems.</h2>
            <p className="hx-p">Same question, three answers, three diagnoses. Each one needs a different fix, so the report keeps them apart.</p>
            <div className="hx-q"><span className="hx-node__k">Question</span>How did you decide what to cache, and how do stale entries get invalidated?<Illustrative /></div>
            <div className="hx-gaps">
              {GAPS.map(g => (
                <article key={g.gap} className="hx-gap">
                  <GapBadge gap={g.gap} />
                  <h3>{g.title}</h3>
                  <p className="hx-gap__a">“{g.answer}”</p>
                  <dl><dt>What it means</dt><dd>{g.means}</dd><dt>What helps</dt><dd>{g.fix}</dd></dl>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 6 · Remediation */}
      <section className="hx-sec" aria-labelledby="s6">
        <div className="hx-wrap hx-split">
          <div className="hx-rail"><span className="hx-num">06</span><span className="hx-railt">Remediation</span></div>
          <div className="hx-remed">
            <div>
              <h2 className="hx-h2" id="s6">Every gap becomes a task you can practise tonight.</h2>
              <p className="hx-p">Tasks are written and spoken exercises: a realistic scenario, the criteria a strong answer meets, and a follow-up question to rehearse. Nothing runs code on our servers.</p>
            </div>
            <article className="hx-task">
              <div className="hx-task__head"><GapBadge gap="knowledge_gap" /><Illustrative /></div>
              <h3>Walk through a failure scenario</h3>
              <p className="ca-faint hx-task__from">From: Reduced p95 latency … by adding Redis caching</p>
              <div className="hx-task__grid">
                <div><span className="hx-node__k">Scenario</span><p>Redis goes down during a sale. Order lookups start timing out.</p></div>
                <div><span className="hx-node__k">Your task</span><p>Write the timeline: detect, diagnose, mitigate, prevent.</p></div>
              </div>
              <ul className="hx-task__crit">
                <li><Icon name="check" size={13} />Names a specific failure mode</li>
                <li><Icon name="check" size={13} />Explains how it is detected</li>
                <li><Icon name="check" size={13} />Gives a mitigation and a prevention step</li>
              </ul>
              <div className="hx-task__fq"><span className="hx-node__k">Follow-up question</span><p>What should order lookups do while the cache is unavailable?</p></div>
            </article>
          </div>
        </div>
      </section>

      {/* 7 · Final CTA */}
      <section className="hx-final" aria-labelledby="s7">
        <div className="hx-wrap">
          <h2 className="hx-final__h" id="s7">Find out before the<br />interviewer does.</h2>
          <div className="hx-final__row">
            <p>Upload a resume and a job description. Answer about ten questions. See which of your claims hold up and why.</p>
            <div className="hx-cta">
              <Link to="/agent/new" className="ca-btn ca-btn--primary ca-btn--lg">Test Your Skills<Icon name="arrowRight" /></Link>
              <Link to="/agent/dashboard" className="ca-btn ca-btn--ghost ca-btn--lg">Your assessments</Link>
            </div>
          </div>
          <p className="hx-final__fine">Looking for the resume roast and ATS tools? <Link to="/roast" className="ca-link">They're here.</Link></p>
        </div>
      </section>
    </div>
  );
}
