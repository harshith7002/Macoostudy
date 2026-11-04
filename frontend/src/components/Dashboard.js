import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getUser, getVisitorId } from "../utils/storage";
import { apiFetch } from "../utils/api";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const user = getUser();

  useEffect(() => {
    const userId = user?.user_id || getVisitorId();
    apiFetch(`/api/dashboard?user_id=${encodeURIComponent(userId)}`, { timeout: 12000 })
      .then(d => { setData(d); setLoading(false); })
      .catch(requestError => { setError(requestError.message); setLoading(false); });
  }, []);

  const handleCopyLink = () => {
    const link = `${window.location.origin}/?ref=${user?.user_id || getVisitorId()}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (loading) return (
    <div className="page-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh" }}>
      <div style={{ textAlign: "center" }}>
        <div className="pulsing-dot" style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--fire)", margin: "0 auto 16px" }} />
        <div style={{ color: "var(--cream-60)", fontSize: "0.95rem", fontWeight: 500, letterSpacing: "0.5px" }}>Loading your dashboard analytics...</div>
      </div>
    </div>
  );

  const stats = [
    { label: "Resumes Roasted", value: data?.total_analyses ?? 0, icon: "🔥", color: "var(--fire)" },
    { label: "Avg ATS Score", value: data?.avg_ats_score ? `${data.avg_ats_score}%` : "—", icon: "🎯", color: "var(--emerald)" },
    { label: "JD Matches Run", value: data?.jd_matches_count ?? 0, icon: "⚡", color: "var(--gold)" },
    { label: "Avg JD Match", value: data?.avg_jd_match ? `${data.avg_jd_match}%` : "—", icon: "🧠", color: "var(--sapphire)" },
  ];

  return (
    <div className="page-wrap" style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 20px" }}>
      <div className="dashboard-page">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--fire)", letterSpacing: "1.5px", textTransform: "uppercase" }}>ANALYTICS HUB</span>
            <h1 style={{ fontSize: "2.2rem", fontWeight: 850, color: "#fff", marginTop: "4px" }}>Your Career Dashboard</h1>
          </div>
        </div>
        
        {/* ── User Profile & Credits status ── */}
        <div className="profile-banner" style={{ 
          background: "linear-gradient(135deg, rgba(28, 30, 38, 0.6) 0%, rgba(18, 19, 26, 0.8) 100%)", 
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 255, 255, 0.05)", 
          padding: "24px", 
          borderRadius: "16px", 
          marginBottom: "24px", 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          flexWrap: "wrap",
          gap: "20px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)"
        }}>
          <div>
            <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "var(--cream-30)", letterSpacing: "1px" }}>ACCOUNT PROFILE</span>
            <p style={{ margin: "4px 0 8px", color: "#fff", fontWeight: 750, fontSize: "1.1rem" }}>{user?.email || "Anonymous Guest Session"}</p>
            <div style={{ display: "flex", gap: "16px", fontSize: "0.85rem", color: "var(--cream-60)", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.03)", padding: "4px 10px", borderRadius: "100px", border: "1px solid var(--border)" }}>
                Tier: <strong style={{ color: user?.tier && user.tier !== "free" ? "var(--gold)" : "var(--cream)" }}>{(user?.tier || "free").toUpperCase()}</strong>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.03)", padding: "4px 10px", borderRadius: "100px", border: "1px solid var(--border)" }}>
                Credits: <strong style={{ color: user?.tier && user.tier !== "free" ? "var(--emerald)" : "var(--cream)" }}>{user?.tier && user.tier !== "free" ? "Unlimited ⚡" : `${user?.credits || 1} Remaining`}</strong>
              </span>
            </div>
          </div>
          {(!user?.tier || user.tier === "free") && (
            <Link to="/pricing" className="fire-btn" style={{ 
              padding: "12px 24px", 
              borderRadius: "10px", 
              textDecoration: "none", 
              fontSize: "0.9rem",
              fontWeight: 700,
              boxShadow: "0 4px 20px rgba(255, 138, 61, 0.25)"
            }}>
              🚀 Upgrade to Copilot Pro
            </Link>
          )}
        </div>

        {/* ── Referral System ── */}
        <div className="referral-banner" style={{ 
          background: "linear-gradient(135deg, rgba(255, 138, 61, 0.03) 0%, rgba(28, 30, 38, 0.4) 100%)", 
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 138, 61, 0.15)", 
          padding: "24px", 
          borderRadius: "16px", 
          marginBottom: "32px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)"
        }}>
          <h3 style={{ margin: "0 0 6px", color: "#fff", fontSize: "1.05rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
            <span>🎁</span> Invite Friends, Earn Bonus Credits!
          </h3>
          <p style={{ fontSize: "0.85rem", color: "var(--cream-60)", margin: "0 0 16px", lineHeight: 1.5 }}>
            Share your unique referral link. When they sign up, both of you get **+3 bonus credits** instantly!
          </p>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              readOnly
              value={`${window.location.origin}/?ref=${user?.user_id || getVisitorId()}`}
              style={{
                flex: 1,
                minWidth: "240px",
                padding: "12px 14px",
                borderRadius: "10px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--border)",
                color: "#fff",
                fontSize: "0.85rem",
                outline: "none",
                fontFamily: "monospace"
              }}
            />
            <button
              onClick={handleCopyLink}
              className="fire-btn"
              style={{ 
                padding: "12px 20px", 
                borderRadius: "10px", 
                fontSize: "0.88rem", 
                fontWeight: 700,
                background: copied ? "var(--emerald)" : "var(--fire)",
                borderColor: copied ? "var(--emerald)" : "var(--fire)",
                boxShadow: copied ? "0 4px 15px rgba(16, 185, 129, 0.25)" : "0 4px 15px rgba(255, 138, 61, 0.25)",
                transition: "all 0.25s"
              }}
            >
              {copied ? "Copied! 📋" : "Copy Referral Link"}
            </button>
          </div>
        </div>

        {error && <div className="notice" style={{ background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.2)", color: "#ff4757", padding: "12px 16px", borderRadius: "10px", marginBottom: "24px", fontSize: "0.85rem" }} role="status">Stats are temporarily offline. Your local reports remain safe.</div>}

        <div className="stat-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px", marginBottom: "32px" }}>
          {stats.map((s, i) => (
            <div key={i} className="stat-card" style={{ 
              background: "var(--bg2)", 
              border: "1px solid var(--border)", 
              borderTop: `4px solid ${s.color}`, 
              padding: "24px", 
              borderRadius: "14px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              transition: "transform 0.2s, box-shadow 0.2s",
              cursor: "default"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.boxShadow = `0 10px 25px rgba(0,0,0,0.3), 0 0 15px ${s.color}15`;
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.15)";
            }}
            >
              <div className="stat-icon" style={{ fontSize: "1.5rem", marginBottom: "12px" }}>{s.icon}</div>
              <div className="stat-value" style={{ color: s.color, fontSize: "2rem", fontWeight: 900, fontFamily: "monospace" }}>{s.value}</div>
              <div className="stat-label" style={{ color: "var(--cream-60)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700, marginTop: "4px" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {data?.ats_trend?.length > 1 && (
          <div className="chart-card" style={{ background: "var(--bg2)", border: "1px solid var(--border)", padding: "24px", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.15)", marginBottom: "32px" }}>
            <h3 style={{ color: "#fff", fontSize: "1.05rem", fontWeight: 700, marginBottom: "20px" }}>ATS Score Progression</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.ats_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.08)" />
                <XAxis dataKey="date" stroke="var(--cream-30)" tick={{ fontSize: 10, fill: "var(--cream-60)" }} />
                <YAxis domain={[0, 100]} stroke="var(--cream-30)" tick={{ fontSize: 10, fill: "var(--cream-60)" }} />
                <Tooltip contentStyle={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, color: "#fff", fontSize: "0.8rem" }} />
                <Line type="monotone" dataKey="score" stroke="var(--fire)" strokeWidth={3} dot={{ r: 5, fill: "var(--fire)", stroke: "var(--bg2)", strokeWidth: 2 }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {(!data || data.total_analyses === 0) && (
          <div className="dashboard-cta" style={{ textAlign: "center", padding: "48px 24px", background: "rgba(255,255,255,0.01)", border: "1px dashed var(--border)", borderRadius: "16px" }}>
            <p style={{ color: "var(--cream-60)", fontSize: "0.92rem", marginBottom: "16px" }}>No resume uploads or matches found on this account yet.</p>
            <Link to="/roast" className="fire-btn" style={{ padding: "10px 20px", borderRadius: "8px", textDecoration: "none", fontSize: "0.85rem", fontWeight: 700 }}>
              🔥 Run Your First Roast
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
