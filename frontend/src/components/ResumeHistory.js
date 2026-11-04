import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api";
import { getAnalysisCache, getUser, getVisitorId, removeAnalysisCache } from "../utils/storage";

function parseResult(analysis) {
  if (analysis.result) return analysis.result;
  try { return JSON.parse(analysis.result_json || "{}"); } catch { return {}; }
}

export default function ResumeHistory() {
  const [analyses, setAnalyses] = useState(() => getAnalysisCache());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let active = true;
    const userId = getUser()?.user_id || getVisitorId();
    apiFetch(`/api/history?user_id=${encodeURIComponent(userId)}`, { timeout: 12000 })
      .then(data => {
        if (!active) return;
        const local = getAnalysisCache();
        const merged = [...(data.analyses || []), ...local].filter((item, index, all) =>
          all.findIndex(other => (other.id || other.cached_at) === (item.id || item.cached_at)) === index
        );
        setAnalyses(merged.sort((a, b) => new Date(b.created_at || b.cached_at) - new Date(a.created_at || a.cached_at)));
      })
      .catch(() => { if (active) { setError("Cloud history is unavailable. Showing history saved on this device."); setAnalyses(getAnalysisCache()); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return analyses;
    return analyses.filter(item => `${item.filename || ""} ${item.verdict || ""} ${item.type || ""}`.toLowerCase().includes(query));
  }, [analyses, search]);

  function removeLocal(id) {
    removeAnalysisCache(id);
    setAnalyses(items => items.filter(item => item.id !== id));
  }

  return (
    <main className="page-wrap">
      <div className="history-page">
        <header className="history-header">
          <div><span className="section-kicker">YOUR PROGRESS</span><h1>Analysis History</h1></div>
          <label className="history-search"><span className="sr-only">Search analysis history</span><input type="search" placeholder="Search resumes…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        </header>
        <div className="notice" role="note" style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <span>📋</span>
          <span><strong>Your resume file is never stored</strong> — only your scores and feedback are saved (tied to this device) so you can revisit them here.</span>
        </div>

        {error && <div className="notice" role="status">{error}</div>}
        {loading && analyses.length === 0 && <div className="history-loading" aria-live="polite">Loading your history…</div>}
        {!loading && filtered.length === 0 && (
          <div className="history-empty-state"><h2>{search ? "No matching analyses" : "No analyses yet"}</h2><p>{search ? "Try a different search." : "Your completed roasts, JD matches, and comparisons will appear here."}</p><Link className="btn-primary" to="/roast">Analyze a resume</Link></div>
        )}
        <div className="history-list">
          {filtered.map(analysis => {
            const id = analysis.id || analysis.cached_at;
            const result = parseResult(analysis);
            const isExpanded = expanded === id;
            return (
              <article className={`history-item ${isExpanded ? "expanded" : ""}`} key={id}>
                <button className="hi-header" type="button" aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? null : id)}>
                  <div className="hi-left"><span className="hi-type" aria-hidden="true">{analysis.type === "jd_match" ? "🎯" : analysis.type === "compare" ? "↔" : "🔥"}</span><div><div className="hi-filename">{analysis.filename || "Resume analysis"}</div><time className="hi-date">{new Date(analysis.created_at || analysis.cached_at).toLocaleString()}</time></div></div>
                  <div className="hi-right">{analysis.ats_score != null && <span className="hi-score">{analysis.ats_score} score</span>}<span className="hi-chevron" aria-hidden="true">{isExpanded ? "−" : "+"}</span></div>
                </button>
                {isExpanded && <div className="hi-body">{analysis.verdict && <p><strong>{analysis.verdict}</strong></p>}{result.summary && <p>{result.summary}</p>}{result.roast && <pre className="hi-roast-text">{result.roast}</pre>}{result.recommendation && <p>{result.recommendation}</p>}{String(id).startsWith("local_") || analysis.cached_at ? <button className="history-delete" type="button" onClick={() => removeLocal(id)}>Remove from this device</button> : null}</div>}
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
