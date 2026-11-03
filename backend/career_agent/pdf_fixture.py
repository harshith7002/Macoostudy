"""Tiny dependency-free PDF writer used by tests and the demo sample resume."""


def _esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(lines):
    """Return bytes of a valid one-page PDF with each line drawn as text."""
    ops = ["BT", "/F1 10 Tf", "50 760 Td", "14 TL"]
    for line in lines:
        ops.append(f"({_esc(line.encode('latin-1', 'replace').decode('latin-1'))}) '")
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


SAMPLE_RESUME = [
    "Priya Sharma",
    "priya@example.com | github.com/priya",
    "Summary",
    "Backend-leaning full-stack developer who enjoys building reliable APIs.",
    "Experience",
    "Software Engineering Intern, Acme Payments (May 2025 - Aug 2025)",
    "- Built a Flask REST API with PostgreSQL for refund processing used by 3 internal teams",
    "- Reduced p95 latency of the order lookup endpoint by 40% by adding Redis caching",
    "- Implemented idempotent webhook handling for Razorpay payment events to prevent double credits",
    "Projects",
    "- Developed a React dashboard with Recharts to visualise resume scores for 2,000 users",
    "- Deployed the backend on Render with Docker and GitHub Actions CI/CD pipelines",
    "- Led a team of 4 students to ship a campus event app in 6 weeks",
    "Skills",
    "Python, Flask, React, PostgreSQL, Redis, Docker, AWS, Git",
    "Education",
    "B.S. Data Science, IIT Madras (2023 - 2027)",
]

SAMPLE_JD = ("We are hiring a Backend Engineer to build Python and Flask services on PostgreSQL. "
             "You will design REST APIs, add caching with Redis, deploy with Docker on AWS, and handle payment "
             "webhooks reliably. Experience with React is a plus.")
