import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useDocTitle } from "./Shell";
import { GapBadge, Icon, LabelBadge, StatusBadge } from "./ui";

/* Illustrative sample used only on this marketing page; every instance is labelled "Sample". */
const SAMPLE = [
  { id: "clm_1d4a", text: "Built a Flask REST API with PostgreSQL for refund processing used by 3 internal teams", status: "SUPPORTED", score: 90,
    competency: "Backend engineering", q: "You mentioned an idempotency key. What happens when the payment provider times out mid-refund?",
    a: "We retried with the same idempotency key so the refund couldn't apply twice; I found the original bug from the logs and added an alert.",
    ev: "We retried with the same idempotency key so the refund couldn't apply twice", crit: [["Failure handling & debugging", "demonstrated"], ["Trade-off awareness", "demonstrated"], ["Validation & measurement", "not_demonstrated", "insufficient_evidence"]] },
  { id: "clm_8811", text: "Reduced p95 latency of the order lookup endpoint by 40% by adding Redis caching", status: "PARTIALLY SUPPORTED", score: 55,
    competency: "Databases", q: "How did you decide what to cache, and how do stale entries get invalidated?",
    a: "We cached order lookups with a 60 second TTL. I'm not sure how invalidation worked on updates.",
    ev: "We cached order lookups with a 60 second TTL.", crit: [["Implementation detail", "demonstrated"], ["Data modelling & queries", "partial", "weak_articulation"], ["Failure handling & debugging", "not_demonstrated", "knowledge_gap"]] },
  { id: "clm_f3fe", text: "Developed a React dashboard with Recharts to visualise resume scores for 2,000 users", status: "INSUFFICIENT EVIDENCE", score: 20,
    competency: "Frontend engineering", q: "Where did the dashboard state live, and what triggered re-renders?",
    a: "I don't remember exactly, a teammate set that part up.",
    ev: null, crit: [["State & rendering", "not_demonstrated", "knowledge_gap"], ["Implementation detail", "not_demonstrated", "knowledge_gap"]] },
];
const TONE = { "SUPPORTED": "good", "PARTIALLY SUPPORTED": "mid", "INSUFFICIENT EVIDENCE": "low" };

function SampleTag() {
  return <span className="ca-sample"><Icon name="eye" size={12} />Sample data, for illustration</span>;
}

function ProductPreview() {
  const [sel, setSel] = useState(0);
  const c = SAMPLE[sel];
  return (
    <div className="ca-preview" aria-label="Product preview with sample data">
      <div className="ca-preview__bar">
        <span className="ca-mono">Assessment · Backend Engineer</span>
        <SampleTag />
      </div>
      <div className="ca-preview__body">
        <div className="ca-preview__resume">
          <div className="ca-preview__line ca-mono">resume.pdf · extracted claims</div>
          {SAMPLE.map((s, i) => (
            <button key={s.id} type="button" onClick={() => setSel(i)} aria-pressed={sel === i}
                    className="ca-card" style={{ textAlign: "left", padding: 10, cursor: "pointer", color: "inherit", font: "inherit",
                      borderColor: sel === i ? "var(--accent-line)" : undefined, background: sel === i ? "var(--bg-3)" : undefined }}>
              <div className="ca-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span className="ca-claim__src">{s.id}</span>
                <StatusBadge status={s.status} small />
              </div>
              <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--tx-2)" }}>{s.text}</span>
            </button>
          ))}
        </div>
        <div className="ca-preview__thread" aria-live="polite">
          <div className="ca-row" style={{ justifyContent: "space-between" }}>
            <span className="ca-eyebrow" style={{ margin: 0 }}>{c.competency}</span>
            <span className={`ca-mono ca-t-${TONE[c.status]}`} style={{ fontWeight: 700 }}>{c.score}/100</span>
          </div>
          <div className="ca-msg ca-msg--q" key={`q${sel}`}>
            <span className="ca-msg__avatar">Q</span>
            <div className="ca-msg__body"><div className="ca-msg__meta"><strong>Interviewer</strong><span className="ca-followup-tag"><Icon name="reply" size={12} />follow-up</span></div>
              <p className="ca-msg__text" style={{ fontSize: 13 }}>{c.q}</p></div>
          </div>
          <div className="ca-msg ca-msg--a" key={`a${sel}`}>
            <span className="ca-msg__avatar">A</span>
            <div className="ca-msg__body"><div className="ca-msg__meta"><strong>Candidate</strong></div>
              <p className="ca-msg__text" style={{ fontSize: 13 }}>
                {c.ev ? <><mark className="ca-ev ca-ev--positive">{c.ev}</mark>{c.a.slice(c.ev.length)}</> : <mark className="ca-ev ca-ev--negative">{c.a}</mark>}
              </p></div>
          </div>
          <div className="ca-card" style={{ padding: 0 }}>
            {c.crit.map(([name, label, gap]) => (
              <div key={name} className="ca-row" style={{ justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
                <span>{name}</span><span className="ca-row" style={{ gap: 6 }}><LabelBadge label={label} />{gap && <GapBadge gap={gap} />}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const FLOW = [
  ["Claim", "Each resume bullet becomes a claim with a stable ID, its exact text span, linked skills and a competency."],
  ["Question", "The backend picks the rubric criterion to probe; the interviewer asks one targeted question."],
  ["Answer", "You answer in your own words. Follow-ups build on what you actually said."],
  ["Evidence", "Excerpts are quoted verbatim from your answers. Text you didn't write is discarded."],
  ["Rubric", "Each criterion is labelled demonstrated, partial or not shown, and must cite evidence."],
  ["Status", "Points are computed deterministically into Supported, Partially supported or Insufficient evidence."],
  ["Remediation", "Every gap becomes a practice task with a scenario and a follow-up question."],
];

export default function Landing() {
  useDocTitle("Prove you can defend it");
  const [heatSel, setHeatSel] = useState(1);
  const hc = SAMPLE[heatSel];

  return (
    <div className="ca-land ca-fade">
      <section className="ca-hero">
        <div>
          <div className="ca-eyebrow"><Icon name="shield" size={13} />Macoostudy Career Agent</div>
          <h1>Don't just claim the skill.<span>Prove you can defend it.</span></h1>
          <p className="ca-hero__lead">
            Upload your resume and the job you want. Macoostudy identifies your technical claims, challenges them through adaptive
            interviews, and shows exactly what your answers demonstrate.
          </p>
          <div className="ca-hero__cta">
            <Link to="/agent/new" className="ca-btn ca-btn--primary ca-btn--lg">Start Assessment<Icon name="arrowRight" /></Link>
            <a href="#how" className="ca-btn ca-btn--secondary ca-btn--lg"
               onClick={(e) => { e.preventDefault(); document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }); }}>
              Explore How It Works
            </a>
          </div>
          <p className="ca-hero__note"><Icon name="scale" size={14} />Scores are computed by fixed rubric rules, not by the model.</p>
        </div>
        <ProductPreview />
      </section>

      <section className="ca-section" aria-labelledby="problem-h">
        <div className="ca-section__head">
          <div className="ca-eyebrow">The problem</div>
          <h2 id="problem-h">A resume line is a claim. An interview is where it gets tested.</h2>
          <p>Keyword scanners reward listing a skill. Interviewers reward explaining the decision behind it. Most candidates never find out which of their claims they can actually defend until it's too late.</p>
        </div>
        <div className="ca-contrast">
          <div className="ca-card ca-contrast__col">
            <h3><Icon name="file" />What the resume says</h3>
            <ul>
              <li><Icon name="minus" size={14} className="ca-faint" />"Reduced latency by 40% with Redis caching"</li>
              <li><Icon name="minus" size={14} className="ca-faint" />"Built idempotent payment webhooks"</li>
              <li><Icon name="minus" size={14} className="ca-faint" />"Led a team of 4 engineers"</li>
            </ul>
          </div>
          <div className="ca-contrast__arrow" aria-hidden="true"><Icon name="arrowRight" size={20} /></div>
          <div className="ca-card ca-contrast__col">
            <h3><Icon name="message" />What an interviewer asks</h3>
            <ul>
              <li><Icon name="reply" size={14} className="ca-t-accent" />How did you measure the 40%, and against what baseline?</li>
              <li><Icon name="reply" size={14} className="ca-t-accent" />What happens when the same event arrives twice?</li>
              <li><Icon name="reply" size={14} className="ca-t-accent" />Which decision was yours, and who disagreed?</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="ca-section" id="how" aria-labelledby="how-h">
        <div className="ca-section__head">
          <div className="ca-eyebrow">How it works</div>
          <h2 id="how-h">The Claim-to-Evidence Engine</h2>
          <p>Every verdict is traceable: from a resume line, to the question asked, to the exact words you used, to the rubric points they earned.</p>
        </div>
        <ol className="ca-flow ca-flow-wrap">
          {FLOW.map(([t, d], i) => (
            <li key={t}><span className="ca-flow__n">{String(i + 1).padStart(2, "0")}</span><div><strong>{t}</strong><p>{d}</p></div></li>
          ))}
        </ol>
      </section>

      <section className="ca-section ca-feature" aria-labelledby="int-h">
        <div className="ca-feature__text">
          <div className="ca-eyebrow">Adaptive technical interview</div>
          <h2 id="int-h">Questions a senior engineer would ask, not a quiz</h2>
          <p>Each question targets one rubric criterion of one claim. Follow-ups pick up a specific thing you said, and a question is never repeated.</p>
          <ul className="ca-checks">
            <li><Icon name="check" />Probes implementation, design rationale, trade-offs and failure scenarios</li>
            <li><Icon name="check" />Moves on when the evidence is already there, or after two "I don't know" answers</li>
            <li><Icon name="check" />Live provisional status per claim while you answer</li>
          </ul>
        </div>
        <div className="ca-card">
          <div className="ca-card__head"><span className="ca-card__title"><Icon name="message" />Interview room</span><SampleTag /></div>
          <div className="ca-thread" style={{ maxHeight: "none" }}>
            <div className="ca-msg ca-msg--q"><span className="ca-msg__avatar">Q</span><div className="ca-msg__body">
              <div className="ca-msg__meta"><strong>Interviewer</strong><span>Implementation detail</span></div>
              <p className="ca-msg__text">Walk me through how you implemented the refund API. Which part did you build yourself?</p></div></div>
            <div className="ca-msg ca-msg--a"><span className="ca-msg__avatar">A</span><div className="ca-msg__body">
              <div className="ca-msg__meta"><strong>Candidate</strong></div>
              <p className="ca-msg__text">I wrote the Flask endpoint and the Postgres schema. We needed transactions, so I used an <mark className="ca-ev ca-ev--positive">idempotency key</mark> per refund…</p></div></div>
            <div className="ca-msg ca-msg--q"><span className="ca-msg__avatar">Q</span><div className="ca-msg__body">
              <div className="ca-msg__meta"><strong>Interviewer</strong><span className="ca-followup-tag"><Icon name="reply" size={12} />Following up on "idempotency key"</span></div>
              <p className="ca-msg__text">What's the most likely way that part fails in production, and how would you notice?</p></div></div>
          </div>
        </div>
      </section>

      <section className="ca-section ca-feature ca-feature--rev" aria-labelledby="heat-h">
        <div className="ca-feature__text">
          <div className="ca-eyebrow">Resume heatmap</div>
          <h2 id="heat-h">See which lines of your resume hold up</h2>
          <p>Your resume text with every extracted claim highlighted by verdict. Select a claim to open the evidence inspector: the questions, your answers, the rubric and what's missing.</p>
          <div className="ca-legend" style={{ marginTop: 18 }}>
            <span><i className="ca-sw ca-sw--good" />Supported</span><span><i className="ca-sw ca-sw--mid" />Partially supported</span><span><i className="ca-sw ca-sw--low" />Insufficient evidence</span>
          </div>
        </div>
        <div className="ca-heatdemo">
          <div className="ca-doc">
            <div className="ca-doc__bar"><span>resume.pdf · reconstructed text</span><span>Sample</span></div>
            <div className="ca-doc__page" style={{ fontSize: 12.5, padding: "20px 22px" }}>
              <span className="ca-doc__line--heading">Experience</span>{"\n"}
              {SAMPLE.map((s, i) => (
                <React.Fragment key={s.id}>
                  <button type="button" className={`ca-hl ca-hl--${TONE[s.status]}${heatSel === i ? " is-selected" : ""}`} onClick={() => setHeatSel(i)}
                          aria-pressed={heatSel === i}>{s.text}</button>{"\n"}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="ca-card" aria-live="polite">
            <div className="ca-insp__head"><div><div className="ca-eyebrow" style={{ marginBottom: 6 }}>{hc.competency}</div><StatusBadge status={hc.status} /></div>
              <div className="ca-insp__score">{hc.score}<small>/100</small></div></div>
            <div className="ca-insp__sec"><div className="ca-insp__h">Missing criteria</div>
              <ul className="ca-missing">
                {hc.crit.filter(([, l]) => l !== "demonstrated").map(([n, l, g]) => <li key={n}><span>{n}</span><GapBadge gap={g} /></li>)}
                {hc.crit.every(([, l]) => l === "demonstrated") && <li className="ca-faint">None</li>}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="ca-section ca-feature" aria-labelledby="score-h">
        <div className="ca-feature__text">
          <div className="ca-eyebrow">Transparent scoring</div>
          <h2 id="score-h">The model labels. The rubric scores.</h2>
          <p>Each competency has fixed criteria worth 100 points in total. The model can only mark a criterion demonstrated, partial or not shown, and it must cite a verbatim excerpt. Anything without evidence is downgraded before scoring.</p>
          <ul className="ca-checks">
            <li><Icon name="check" />Same labels always produce the same score</li>
            <li><Icon name="check" />Knowledge gaps, weak articulation and insufficient evidence are reported separately</li>
            <li><Icon name="check" />A low score means "not explained yet", never "dishonest"</li>
          </ul>
        </div>
        <div className="ca-card ca-card__body ca-stack">
          <div className="ca-formula">
            <div><span className="ca-faint">Demonstrated</span><strong className="ca-t-good">100%</strong></div>
            <div><span className="ca-faint">Partial</span><strong className="ca-t-mid">50%</strong></div>
            <div><span className="ca-faint">Not shown</span><strong className="ca-t-low">0%</strong></div>
          </div>
          <div className="ca-formula">
            <div><span className="ca-faint">Supported</span><strong>≥ 70</strong></div>
            <div><span className="ca-faint">Partially supported</span><strong>≥ 35</strong></div>
            <div><span className="ca-faint">Insufficient</span><strong>&lt; 35</strong></div>
          </div>
          <p className="ca-method">Example backend criteria: implementation 25, trade-offs 20, failure handling 20, design rationale 15, validation 10, domain-specific 10.</p>
        </div>
      </section>

      <section className="ca-section ca-feature ca-feature--rev" aria-labelledby="rem-h">
        <div className="ca-feature__text">
          <div className="ca-eyebrow">Targeted remediation</div>
          <h2 id="rem-h">Every gap becomes a practice task</h2>
          <p>Each task names the gap, explains why it matters, gives a realistic engineering scenario and the criteria a strong answer meets, then a follow-up question to rehearse.</p>
        </div>
        <div className="ca-card ca-task">
          <div className="ca-task__head"><div><div className="ca-task__title">Walk through a failure scenario</div>
            <div className="ca-task__claim">Reduced p95 latency … by adding Redis caching</div></div><GapBadge gap="knowledge_gap" /></div>
          <div className="ca-task__grid">
            <div className="ca-task__cell"><h4>Practical task</h4><p>Write the incident timeline for a cache outage: detect, diagnose, mitigate, prevent.</p></div>
            <div className="ca-task__cell"><h4>A strong answer</h4><ul><li><Icon name="check" size={13} />Names a specific failure mode</li><li><Icon name="check" size={13} />Explains detection</li></ul></div>
          </div>
          <div className="ca-task__fq"><h4 className="ca-insp__h" style={{ margin: "0 0 4px", color: "var(--accent-2)" }}>Follow-up question</h4><p>What happens to order lookups when Redis is unavailable?</p></div>
          <div className="ca-card__foot"><SampleTag /></div>
        </div>
      </section>

      <section className="ca-final">
        <div>
          <h2>Find out which claims you can defend.</h2>
          <p>Takes one resume, one job description and about ten answers.</p>
        </div>
        <Link to="/agent/new" className="ca-btn ca-btn--primary ca-btn--lg">Start Assessment<Icon name="arrowRight" /></Link>
      </section>
    </div>
  );
}
