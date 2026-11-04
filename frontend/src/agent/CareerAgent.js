import React from "react";
import { Link, Route, Routes } from "react-router-dom";
import Analysis from "./Analysis";
import Dashboard from "./Dashboard";
import Heatmap from "./Heatmap";
import Home from "./Home";
import Interview from "./Interview";
import NewAssessment from "./NewAssessment";
import Remediation from "./Remediation";
import Report from "./Report";
import { AgentShell } from "./Shell";
import { EmptyState, ToastProvider } from "./ui";
import "./agent.css";

export default function CareerAgent() {
  return (
    <div className="ca">
      <ToastProvider>
        <Routes>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="new" element={<NewAssessment />} />
          <Route path="a/:id" element={<Analysis />} />
          <Route path="a/:id/interview" element={<Interview />} />
          <Route path="a/:id/heatmap" element={<Heatmap />} />
          <Route path="a/:id/report" element={<Report />} />
          <Route path="a/:id/remediation" element={<Remediation />} />
          <Route path="*" element={
            <AgentShell title="Not found">
              <EmptyState icon="alert" title="Page not found" action={<Link className="ca-btn ca-btn--primary" to="/agent/dashboard">Go to dashboard</Link>}>
                That Career Agent page doesn't exist.
              </EmptyState>
            </AgentShell>
          } />
        </Routes>
      </ToastProvider>
    </div>
  );
}
