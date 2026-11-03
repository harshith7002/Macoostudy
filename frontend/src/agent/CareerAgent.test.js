// Same approach as App.test.js: react-dom + act, no extra testing dependency.
if (typeof global.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("util");
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react-dom/test-utils");
const { MemoryRouter } = require("react-router-dom");
const Landing = require("./Landing").default;
const { Modal, Ring, StatusBadge } = require("./ui");

const h = React.createElement;
let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("landing page shows the headline, primary CTA and labels its sample data", () => {
  act(() => root.render(h(MemoryRouter, null, h(Landing))));
  expect(container.querySelector("h1").textContent).toBe("Don't just claim the skill.Prove you can defend it.");
  const cta = [...container.querySelectorAll("a")].find(a => a.textContent.includes("Start Assessment"));
  expect(cta.getAttribute("href")).toBe("/agent/new");
  expect(container.textContent).toContain("Sample data, for illustration");
});

test("product preview switches claims when selected", () => {
  act(() => root.render(h(MemoryRouter, null, h(Landing))));
  const claim = [...container.querySelectorAll(".ca-preview button")].find(b => b.textContent.includes("React dashboard"));
  expect(claim.getAttribute("aria-pressed")).toBe("false");
  act(() => claim.click());
  expect(claim.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector(".ca-preview__thread").textContent).toContain("Frontend engineering");
});

test("status badge and score ring expose accessible text", () => {
  act(() => root.render(h(React.Fragment, null, h(StatusBadge, { status: "PARTIALLY SUPPORTED", provisional: true }), h(Ring, { value: 64, label: "Readiness" }))));
  expect(container.textContent).toContain("Partially supported · live");
  expect(container.querySelector('[role="img"]').getAttribute("aria-label")).toBe("Readiness 64 out of 100");
});

test("modal closes on Escape", () => {
  const onClose = jest.fn();
  act(() => root.render(h(Modal, { open: true, title: "End the interview now?", onClose, actions: h("button", null, "Keep going") }, h("p", null, "Body"))));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(onClose).toHaveBeenCalled();
});
