import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../utils/api";
import { getUser, getVisitorId } from "../utils/storage";

// Signed-in users use their account id; guests get a stable per-browser visitor id.
export function agentUserId() {
  return getUser()?.user_id || getVisitorId();
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ user_id: agentUserId(), ...body }),
});

// Model calls can take a while on a live provider; give them room.
const LONG = 150000;

export const agentApi = {
  provider: () => apiFetch("/api/agent/provider"),
  list: () => apiFetch(`/api/agent/assessments?user_id=${encodeURIComponent(agentUserId())}`),
  get: (id) => apiFetch(`/api/agent/assessments/${id}?user_id=${encodeURIComponent(agentUserId())}`),
  create: (form) => {
    form.append("user_id", agentUserId());
    return apiFetch("/api/agent/assessments", { method: "POST", body: form, timeout: LONG });
  },
  start: (id) => apiFetch(`/api/agent/assessments/${id}/interview/start`, { ...json({}), timeout: LONG }),
  answer: (id, questionId, answer) =>
    apiFetch(`/api/agent/assessments/${id}/interview/answer`, { ...json({ question_id: questionId, answer }), timeout: LONG }),
  end: (id) => apiFetch(`/api/agent/assessments/${id}/interview/end`, { ...json({}), timeout: LONG }),
  setTask: (id, taskId, status) =>
    apiFetch(`/api/agent/assessments/${id}/remediation/${taskId}`, { ...json({ status }), method: "PATCH" }),
};

export function useAssessment(id) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await agentApi.get(id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

export const STATUS = {
  "SUPPORTED": { tone: "good", label: "Supported" },
  "PARTIALLY SUPPORTED": { tone: "mid", label: "Partially supported" },
  "INSUFFICIENT EVIDENCE": { tone: "low", label: "Insufficient evidence" },
};

export const GAP = {
  knowledge_gap: { label: "Knowledge gap", hint: "Answers suggested the concept itself isn't solid yet." },
  weak_articulation: { label: "Weak articulation", hint: "Some understanding came through, but the explanation was vague or unstructured." },
  insufficient_evidence: { label: "Insufficient evidence", hint: "Not enough was asked or said to judge this." },
};

export const LABEL = {
  demonstrated: { label: "Demonstrated", tone: "good" },
  partial: { label: "Partial", tone: "mid" },
  not_demonstrated: { label: "Not shown", tone: "low" },
};

// Final status if evaluated, otherwise the provisional live status during the interview.
export function claimStatus(claim) {
  if (claim.status) return { status: claim.status, score: claim.score, provisional: false };
  if (claim.live) return { status: claim.live.status, score: claim.live.score, provisional: true };
  return { status: null, score: null, provisional: false };
}
