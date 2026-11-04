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
const Home = require("./Home").default;
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

test("home shows the headline, working CTAs and labels its sample data", () => {
  act(() => root.render(h(MemoryRouter, null, h(Home))));
  expect(container.querySelector("h1").textContent).toBe("Can you actually defend what's on your resume?");
  const ctas = [...container.querySelectorAll("a")].filter(a => a.textContent.includes("Test Your Skills"));
  expect(ctas.length).toBe(2);
  ctas.forEach(a => expect(a.getAttribute("href")).toBe("/agent/new"));
  expect(container.querySelector('a[href="#how"]').textContent).toContain("See How It Works");
  expect(container.querySelector("#how")).not.toBeNull();
  expect(container.textContent).toContain("Illustrative sample");
});

test("claim trace switches between sample verdicts", () => {
  act(() => root.render(h(MemoryRouter, null, h(Home))));
  const tabs = [...container.querySelectorAll(".hx-trace [role=tab]")];
  expect(tabs.map(t => t.textContent)).toEqual(["Supported", "Partial", "Insufficient"]);
  act(() => tabs[2].click());
  expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  expect(container.querySelector(".hx-chain").textContent).toContain("React dashboard");
});

test("evaluation ledger adds up rubric points to the shown score", () => {
  act(() => root.render(h(MemoryRouter, null, h(Home))));
  [...container.querySelectorAll(".hx-lclaim")].forEach((btn) => {
    act(() => btn.click());
    const pts = [...container.querySelectorAll(".hx-ledger__row b")].reduce((s, b) => s + Number(b.textContent), 0);
    expect(container.querySelector(".hx-ledger__score").textContent).toBe(`${pts}/100`);
  });
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
