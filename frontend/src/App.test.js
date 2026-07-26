// Define TextEncoder and TextDecoder globally for JSDOM compatibility (runs first)
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Import modules via require to prevent ES module hoisting
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { BrowserRouter } = require('react-router-dom');
const App = require('./App').default;
const api = require('./utils/api');

// Mock recharts as it uses canvas and causes SVG/DOM sizing errors in Jest JSDOM
jest.mock('recharts', () => {
  return {
    ResponsiveContainer: ({ children }) => require('react').createElement('div', { className: 'recharts-responsive-container-mock' }, children),
  };
});

// Mock apiFetch utility to run tests locally without calling backend routes
jest.mock('./utils/api', () => ({
  ...jest.requireActual('./utils/api'),
  apiFetch: jest.fn(),
}));

describe('Frontend DOM and Submission Integration Tests', () => {
  let container = null;
  let root = null;

  beforeEach(() => {
    // Set up a DOM element as a render target
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up on exiting
    act(() => {
      root.unmount();
    });
    container.remove();
    container = null;
  });

  test('renders the main title "ROAST MY RESUME" in the viewport', () => {
    act(() => {
      root.render(
        React.createElement(App)
      );
    });

    // Check that title containing "ROAST MY RESUME" is rendered
    const titleElements = container.querySelectorAll('h1, span, div, a');
    let found = false;
    titleElements.forEach(el => {
      if (el.textContent && el.textContent.includes('ROAST MY RESUME')) {
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  test('submission button is disabled when no file is uploaded (blank context)', () => {
    act(() => {
      root.render(
        React.createElement(App)
      );
    });

    // Find the correct submission button by scanning text content
    const buttons = Array.from(container.querySelectorAll('.fire-btn'));
    const button = buttons.find(b => b.textContent && b.textContent.includes('ROAST MY RESUME'));
    expect(button).toBeDefined();
    expect(button.disabled).toBe(true);
  });

  test('uploading mock file context enables the button and activates submission workflow', async () => {
    // Mock apiFetch response to bypass network requests
    api.apiFetch.mockResolvedValue({
      success: true,
      roast: "Mock roast feedback: Good experience points.",
      ats_score: 85,
      category_scores: { keywords: 80, experience: 85 },
      analysis_id: "test-analysis-uuid",
      resume_text: "Mocked text context extracted from pdf file.",
    });

    act(() => {
      root.render(
        React.createElement(App)
      );
    });

    const fileInput = container.querySelector('input[type="file"]');
    const buttons = Array.from(container.querySelectorAll('.fire-btn'));
    const button = buttons.find(b => b.textContent && b.textContent.includes('ROAST MY RESUME'));

    // Create a mock File instance
    const file = new File(['mock pdf content'], 'resume.pdf', { type: 'application/pdf' });
    
    // Simulate selecting a file on the input
    act(() => {
      const filesList = {
        0: file,
        length: 1,
        item: (index) => file,
      };
      Object.defineProperty(fileInput, 'files', {
        value: filesList,
        writable: true,
      });
      const event = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(event);
    });

    // The submit button should now be enabled
    expect(button.disabled).toBe(false);

    // Simulate clicking the submission button
    act(() => {
      button.click();
    });

    // Verify that the apiFetch was called
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(api.apiFetch).toHaveBeenCalled();
  });
});
