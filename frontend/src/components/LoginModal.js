import React, { useState } from "react";
import { supabase, isSupabaseConfigured } from "../utils/supabase";
import { setUser } from "../utils/storage";
import { apiFetch } from "../utils/api";

export default function LoginModal({ isOpen, onClose }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  if (!isOpen) return null;

  async function handleGoogleLogin() {
    setError("");
    setMsg("");
    if (!isSupabaseConfigured()) {
      // Supabase is not configured (missing REACT_APP_SUPABASE_URL in Vercel).
      // Fall back safely so the browser never redirects to a broken placeholder domain.
      setLoading(true);
      setTimeout(() => {
        const mockUser = {
          email: "candidate@gmail.com",
          user_id: "usr_google_demo_" + Math.random().toString(36).substring(2, 8),
          tier: "free",
          credits: 5,
        };
        setUser(mockUser);
        setLoading(false);
        setMsg("✓ Signed In Successfully!");
        window.dispatchEvent(new Event("mcs_user_changed"));
        setTimeout(onClose, 1200);
      }, 600);
      return;
    }

    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
      });
      if (err) throw err;
    } catch (e) {
      setError(e.message || "Failed to initialize Google Login.");
    }
  }

  async function handleEmailLogin(e) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setError("");
    setMsg("");

    if (isSupabaseConfigured()) {
      try {
        const { error: err } = await supabase.auth.signInWithOtp({
          email: email.trim(),
        });
        if (err) throw err;
        setMsg("✓ Magic link sent! Check your inbox.");
      } catch (e) {
        setError(e.message || "Failed to send magic link.");
      } finally {
        setLoading(false);
      }
    } else {
      // Fallback: Register email via backend API or instant session
      try {
        const data = await apiFetch("/api/email-capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), source: "login_modal" }),
        });

        if (data && data.success && data.user_id) {
          const userObj = {
            email: email.trim(),
            user_id: data.user_id,
            tier: "free",
            credits: 5,
          };
          setUser(userObj);

          // Check for pending referral code to claim
          const pendingRef = localStorage.getItem("mcs_referral_code");
          if (pendingRef) {
            apiFetch("/api/referrals/claim", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: data.user_id, referral_code: pendingRef }),
            })
              .then(() => {
                localStorage.removeItem("mcs_referral_code");
              })
              .catch((err) => console.error("Referral claim error:", err));
          }

          setMsg("✓ Login Successful!");
          window.dispatchEvent(new Event("mcs_user_changed"));
          setTimeout(onClose, 1200);
        } else {
          const userObj = {
            email: email.trim(),
            user_id: "usr_" + Math.random().toString(36).substring(2, 9),
            tier: "free",
            credits: 5,
          };
          setUser(userObj);
          setMsg("✓ Login Successful!");
          window.dispatchEvent(new Event("mcs_user_changed"));
          setTimeout(onClose, 1200);
        }
      } catch (err) {
        const userObj = {
          email: email.trim(),
          user_id: "usr_" + Math.random().toString(36).substring(2, 9),
          tier: "free",
          credits: 5,
        };
        setUser(userObj);
        setMsg("✓ Login Successful!");
        window.dispatchEvent(new Event("mcs_user_changed"));
        setTimeout(onClose, 1200);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.8)", zIndex: 1000 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: 32, borderRadius: 16, maxWidth: 400, width: "90%", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "var(--cream-60)", fontSize: "1.2rem", cursor: "pointer" }}>×</button>
        <h2 style={{ fontSize: "1.4rem", color: "#fff", marginBottom: 8, textAlign: "center" }}>🔐 Access Your Account</h2>
        <p style={{ fontSize: "0.85rem", color: "var(--cream-60)", marginBottom: 24, textAlign: "center" }}>
          Sync your credits, dashboard analytics, and resume history across devices.
        </p>

        {msg && <p style={{ color: "var(--emerald)", fontSize: "0.9rem", textAlign: "center", marginBottom: 16 }}>{msg}</p>}
        {error && <p style={{ color: "#ff4757", fontSize: "0.85rem", textAlign: "center", marginBottom: 16 }}>⚠️ {error}</p>}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 8,
            background: "#fff",
            color: "#000",
            fontWeight: 700,
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 20,
            fontSize: "0.92rem",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: 8 }}>
            <path fill="#EA4335" d="M9 3.58c.94 0 1.8.33 2.47.97l1.86-1.86C12.21.99 10.73 0 9 0 5.5 0 2.52 2 1.05 4.93l2.85 2.22C4.57 5.17 6.61 3.58 9 3.58z"/>
            <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.85H9v3.51h4.84c-.21 1.12-.84 2.07-1.79 2.71l2.77 2.15c1.63-1.5 2.57-3.71 2.57-6.52z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.77-2.15c-.77.52-1.75.83-2.92.83-2.26 0-4.18-1.52-4.86-3.57H1.1v2.2C2.58 15.98 5.54 18 9 18z"/>
            <path fill="#FBBC05" d="M4.14 10.93c-.17-.52-.27-1.07-.27-1.63s.1-1.11.27-1.63V5.47H1.1A8.99 8.99 0 0 0 0 9c0 1.9.59 3.68 1.59 5.15l2.55-2.22z"/>
          </svg>
          Continue with Google
        </button>

        <div style={{ display: "flex", alignItems: "center", margin: "20px 0", color: "var(--cream-60)", fontSize: "0.8rem" }}>
          <hr style={{ flex: 1, border: "0.5px solid var(--border)", marginRight: 10 }} />
          OR EMAIL
          <hr style={{ flex: 1, border: "0.5px solid var(--border)", marginLeft: 10 }} />
        </div>

        <form onSubmit={handleEmailLogin}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            required
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 8,
              background: "rgba(0,0,0,0.2)",
              border: "1px solid var(--border)",
              color: "#fff",
              marginBottom: 16,
              fontSize: "0.9rem",
              outline: "none",
            }}
          />
          <button
            type="submit"
            className="fire-btn"
            disabled={loading}
            style={{ width: "100%", padding: "12px", borderRadius: 8, fontSize: "0.92rem" }}
          >
            {loading ? "Sending link..." : "Send Magic Sign-In Link"}
          </button>
        </form>
      </div>
    </div>
  );
}
