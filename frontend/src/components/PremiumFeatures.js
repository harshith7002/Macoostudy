import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getUser, getVisitorId, setUser } from "../utils/storage";
import { apiFetch } from "../utils/api";
import { openRazorpayCheckout } from "../utils/razorpay";
import LoginModal from "./LoginModal";

export default function PremiumFeatures() {
  const [user, setLocalUser] = useState(getUser());
  const [loading, setLoading] = useState(false);
  const [activeTier, setActiveTier] = useState(null); // 'pro' or 'pro_plus'
  const [loginOpen, setLoginOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  // Sync state with storage
  useEffect(() => {
    const handleUserChange = () => setLocalUser(getUser());
    window.addEventListener("mcs_user_changed", handleUserChange);
    return () => window.removeEventListener("mcs_user_changed", handleUserChange);
  }, []);

  async function handleCheckout(tier) {
    setError("");
    setActiveTier(tier);

    // If no user is logged in, open the standard login modal
    if (!user || !user.email) {
      setLoginOpen(true);
      return;
    }

    try {
      setLoading(true);
      await openRazorpayCheckout({
        tier,
        userId: user.user_id || getVisitorId(),
        email: user.email,
        name: user.name || "",
        onPaymentSuccess: (res) => {
          setSuccess(true);
          setUser({
            ...user,
            tier: res.tier,
            credits: res.credits,
          });
          setTimeout(() => {
            navigate("/dashboard");
          }, 3000);
        },
        onPaymentError: (err) => {
          setError(err.message || "Payment process interrupted.");
          setLoading(false);
        },
        onDismiss: () => {
          setLoading(false);
          setActiveTier(null);
        },
      });
    } catch (err) {
      setError(err.message || "Could not launch checkout.");
      setLoading(false);
    }
  }

  return (
    <main className="page-wrap premium-page" style={{ maxWidth: 960, margin: "0 auto", padding: "60px 20px" }}>
      <div className="premium-hero" style={{ marginBottom: 54, textAlign: "center" }}>
        <span className="coming-soon" style={{ 
          color: "var(--fire)", 
          background: "rgba(255, 138, 61, 0.12)", 
          padding: "6px 16px", 
          borderRadius: "100px", 
          fontSize: "0.72rem", 
          fontWeight: 800,
          letterSpacing: "1.5px",
          border: "1px solid rgba(255,138,61,0.2)",
          textTransform: "uppercase"
        }}>
          TRANSPARENT PRICING
        </span>
        <h1 style={{ fontSize: "clamp(2.2rem, 6vw, 3.2rem)", margin: "16px 0 10px", color: "#fff", fontWeight: 900, letterSpacing: "-1px" }}>
          Premium SaaS Plans
        </h1>
        <p style={{ color: "var(--cream-60)", maxWidth: 580, margin: "0 auto", fontSize: "0.98rem", lineHeight: 1.6 }}>
          Accelerate your job search and stand out. Select a plan to instantly unlock advanced features.
        </p>
      </div>

      {success ? (
        <div style={{ 
          textAlign: "center", 
          padding: "50px 40px", 
          background: "rgba(16,185,129,0.06)", 
          border: "1px solid var(--emerald)", 
          borderRadius: 20, 
          marginBottom: 40,
          boxShadow: "0 8px 32px rgba(16,185,129,0.15)"
        }}>
          <span style={{ fontSize: "3.5rem" }}>🎉</span>
          <h2 style={{ color: "var(--emerald)", marginTop: 16, fontWeight: 800 }}>Upgrade Successful!</h2>
          <p style={{ color: "var(--cream-60)", margin: "8px 0 24px" }}>
            Your account tier and credits are synced. Redirecting you to the dashboard...
          </p>
        </div>
      ) : (
        <>
          {/* Plans Overview Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", marginBottom: "48px", alignItems: "stretch" }}>
            
            {/* Free Plan */}
            <div style={{ 
              background: "var(--bg2)", 
              border: "1px solid var(--border)", 
              padding: "36px 28px", 
              borderRadius: "18px", 
              display: "flex", 
              flexDirection: "column",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              transition: "transform 0.25s, border-color 0.25s"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
            >
              <h3 style={{ color: "#fff", fontSize: "1.25rem", fontWeight: 800, marginBottom: "4px" }}>Free</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--cream-60)", marginBottom: "20px" }}>Basic screening test</p>
              <div style={{ fontSize: "2.2rem", fontWeight: 950, color: "#fff", marginBottom: "24px", fontFamily: "monospace" }}>₹0</div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "0 0 28px", fontSize: "0.85rem", color: "var(--cream-60)", textAlign: "left" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>ATS Score Gauge</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>Resume Roast (1/day)</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Target Company Fit</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Download PDF Export</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>AI Cover Letter Generator</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Career Copilot Chat</span></div>
              </div>

              <button onClick={() => navigate("/roast")} className="btn-secondary" style={{ 
                width: "100%", 
                padding: "12px", 
                borderRadius: "10px", 
                background: "rgba(255,255,255,0.03)", 
                border: "1px solid var(--border)", 
                color: "#fff", 
                cursor: "pointer", 
                marginTop: "auto",
                fontWeight: 700,
                transition: "background 0.2s"
              }}
              onMouseOver={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
              onMouseOut={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
              >
                Get Started
              </button>
            </div>

            {/* Pro Lite Plan */}
            <div style={{ 
              background: "var(--bg2)", 
              border: "1px solid var(--border)", 
              padding: "36px 28px", 
              borderRadius: "18px", 
              display: "flex", 
              flexDirection: "column",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              transition: "transform 0.25s, border-color 0.25s"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
            >
              <h3 style={{ color: "#fff", fontSize: "1.25rem", fontWeight: 800, marginBottom: "4px" }}>Pro Lite</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--cream-60)", marginBottom: "20px" }}>Detailed ATS insights</p>
              <div style={{ fontSize: "2.2rem", fontWeight: 950, color: "#fff", marginBottom: "24px", fontFamily: "monospace" }}>₹49</div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "0 0 28px", fontSize: "0.85rem", color: "var(--cream-60)", textAlign: "left" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>ATS Score Gauge</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>Resume Roast (Unlimited)</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>Target Company Fit</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>Download PDF Export</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>AI Cover Letter Generator</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", opacity: 0.35 }}><span style={{ color: "var(--fire)" }}>✕</span> <span>Career Copilot Chat</span></div>
              </div>

              <button 
                onClick={() => handleCheckout("pro")} 
                disabled={loading}
                className="btn-secondary" 
                style={{ 
                  width: "100%", 
                  padding: "12px", 
                  borderRadius: "10px", 
                  background: "rgba(255,255,255,0.03)", 
                  border: "1px solid var(--border)", 
                  color: "#fff", 
                  cursor: loading ? "not-allowed" : "pointer", 
                  marginTop: "auto", 
                  opacity: loading ? 0.7 : 1,
                  fontWeight: 700,
                  transition: "background 0.25s"
                }}
                onMouseOver={(e) => { if(!loading) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                onMouseOut={(e) => { if(!loading) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              >
                {loading && activeTier === "pro" ? "Launching Checkout..." : "Buy Pro Lite"}
              </button>
            </div>

            {/* Pro Lifetime Plan */}
            <div style={{ 
              background: "var(--bg3)", 
              border: "2px solid var(--fire)", 
              padding: "36px 28px", 
              borderRadius: "18px", 
              display: "flex", 
              flexDirection: "column", 
              position: "relative", 
              transform: "scale(1.02)", 
              boxShadow: "0 15px 45px rgba(255, 138, 61, 0.16)",
              transition: "transform 0.25s"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "scale(1.04) translateY(-2px)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "scale(1.02) translateY(0)";
            }}
            >
              <span style={{ 
                position: "absolute", 
                top: "-13px", 
                right: "24px", 
                background: "var(--fire)", 
                color: "#fff", 
                fontSize: "0.68rem", 
                fontWeight: 900, 
                padding: "4px 12px", 
                borderRadius: "100px",
                letterSpacing: "1px",
                boxShadow: "0 4px 10px rgba(255, 138, 61, 0.3)"
              }}>
                LIFETIME PASS
              </span>
              <h3 style={{ color: "#fff", fontSize: "1.25rem", fontWeight: 800, marginBottom: "4px" }}>Pro Lifetime</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--cream-60)", marginBottom: "20px" }}>Ultimate preparation package</p>
              <div style={{ fontSize: "2.2rem", fontWeight: 950, color: "var(--fire)", marginBottom: "24px", fontFamily: "monospace" }}>₹299</div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "0 0 28px", fontSize: "0.85rem", color: "var(--cream)", textAlign: "left" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>ATS Score Gauge</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>Resume Roast (Unlimited)</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>Target Company Fit</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>Download PDF Export</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>AI Cover Letter Generator</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><span style={{ color: "var(--emerald)", fontWeight: 700 }}>✓</span> <span>Career Copilot Chat</span></div>
              </div>

              <button 
                onClick={() => handleCheckout("pro_plus")} 
                disabled={loading}
                className="fire-btn" 
                style={{ 
                  width: "100%", 
                  padding: "12px", 
                  borderRadius: "10px", 
                  cursor: loading ? "not-allowed" : "pointer", 
                  marginTop: "auto", 
                  opacity: loading ? 0.7 : 1,
                  fontWeight: 800,
                  fontSize: "0.92rem",
                  boxShadow: "0 6px 20px rgba(255, 138, 61, 0.35)",
                  transition: "opacity 0.25s"
                }}
              >
                {loading && activeTier === "pro_plus" ? "Launching Checkout..." : "Buy Lifetime"}
              </button>
            </div>
          </div>

          {/* Comparison Table */}
          <div style={{ 
            background: "linear-gradient(135deg, rgba(28, 30, 38, 0.4) 0%, rgba(18, 19, 26, 0.6) 100%)", 
            border: "1px solid var(--border)", 
            borderRadius: "16px", 
            overflow: "hidden", 
            padding: "24px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.2)"
          }}>
            <h4 style={{ color: "#fff", fontWeight: 800, fontSize: "1.05rem", marginBottom: "18px", paddingLeft: "8px" }}>Compare Features</h4>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem", textAlign: "left", minWidth: "500px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", color: "var(--cream-60)" }}>
                    <th style={{ padding: "14px 10px", fontWeight: 700 }}>Feature</th>
                    <th style={{ padding: "14px 10px", fontWeight: 700 }}>Free</th>
                    <th style={{ padding: "14px 10px", fontWeight: 700 }}>Pro Lite</th>
                    <th style={{ padding: "14px 10px", color: "var(--fire)", fontWeight: 800 }}>Lifetime</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>Resume Roasting</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-60)" }}>✓ (1/day)</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream)" }}>✓ (Unlimited)</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓ (Unlimited)</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>ATS Score Gauge</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-60)" }}>✓</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream)" }}>✓</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>Detailed ATS Breakdown</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream)" }}>✓</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>Target Company Fit Alignment</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream)" }}>✓</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>Download PDF Export</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream)" }}>✓</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>Google XYZ Rewriter</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>Job Description Matcher</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>Cover Letter Generator</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "14px 10px", color: "#fff", fontWeight: 600 }}>Interview Prep Q&A Coach</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", color: "var(--cream-30)" }}>✕</td>
                    <td style={{ padding: "14px 10px", fontWeight: 700, color: "var(--fire)" }}>✓</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {error && <div style={{ color: "#ff4757", textAlign: "center", margin: "24px 0", fontSize: "0.9rem", fontWeight: 600 }}>⚠️ {error}</div>}
          <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
        </>
      )}

      <div style={{ textAlign: "center", marginTop: "40px" }}>
        <Link className="nav-link" to="/" style={{ textDecoration: "none", fontSize: "0.88rem", fontWeight: 600, color: "var(--cream-60)", transition: "color 0.2s" }}
        onMouseOver={(e) => e.currentTarget.style.color = "#fff"}
        onMouseOut={(e) => e.currentTarget.style.color = "var(--cream-60)"}
        >
          ← Back to analysis
        </Link>
      </div>
    </main>
  );
}
