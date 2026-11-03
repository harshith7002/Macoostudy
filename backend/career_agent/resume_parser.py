"""ResumeParser: PDF bytes -> normalised text + addressable lines with sections."""
import io
import re

from pypdf import PdfReader

MAX_PDF_BYTES = 10 * 1024 * 1024
MIN_TEXT_CHARS = 80

SECTION_HEADINGS = {
    "experience": ("experience", "work experience", "professional experience", "employment", "internship",
                   "internships", "work history"),
    "projects": ("projects", "personal projects", "academic projects", "key projects", "selected projects"),
    "skills": ("skills", "technical skills", "core skills", "technologies", "tech stack", "tools"),
    "education": ("education", "academics", "academic background"),
    "achievements": ("achievements", "awards", "honors", "honours", "certifications", "accomplishments"),
    "summary": ("summary", "profile", "objective", "about", "about me"),
    "leadership": ("leadership", "extracurricular", "activities", "volunteering", "positions of responsibility"),
}

_BULLET = re.compile(r"^[\s•●▪◦‣∙·\-\*–—]+")


class ResumeParseError(ValueError):
    pass


def extract_pdf_text(pdf_bytes):
    if not pdf_bytes:
        raise ResumeParseError("The uploaded PDF is empty.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise ResumeParseError("The PDF must be smaller than 10 MB.")
    if not pdf_bytes.lstrip()[:5].startswith(b"%PDF"):
        raise ResumeParseError("That file is not a valid PDF.")
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as exc:
        raise ResumeParseError("We could not read that PDF. Try exporting it again.") from exc
    return "\n".join(pages)


def _heading_for(line):
    key = re.sub(r"[^a-z ]", "", line.lower()).strip()
    if not key or len(key) > 40:
        return None
    for section, names in SECTION_HEADINGS.items():
        if key in names:
            return section
    return None


def parse_text(raw_text):
    """Normalise text into lines; returns {"text", "lines"}.

    Each line has an index, its section, and [start, end) offsets into "text",
    so claims can be highlighted exactly where they appear.
    """
    raw_lines = [re.sub(r"[ \t ]+", " ", l).strip() for l in (raw_text or "").replace("\r", "\n").split("\n")]
    # Re-join wrapped bullet continuations: a line that starts lowercase continues the previous one.
    merged = []
    for line in raw_lines:
        if not line:
            continue
        if merged and line[:1].islower() and not _BULLET.match(line) and not merged[-1].endswith(":"):
            merged[-1] = merged[-1] + " " + line
        else:
            merged.append(line)

    text_parts, lines, offset, section = [], [], 0, "summary"
    for i, line in enumerate(merged):
        heading = _heading_for(line)
        if heading:
            section = heading
        clean = _BULLET.sub("", line).strip() or line
        start = offset
        text_parts.append(clean)
        offset += len(clean) + 1
        lines.append({"index": i, "text": clean, "section": "heading" if heading else section,
                      "start": start, "end": start + len(clean), "bullet": bool(_BULLET.match(line))})
    text = "\n".join(text_parts)
    if len(text.strip()) < MIN_TEXT_CHARS:
        raise ResumeParseError("We could not find enough text in that PDF. Scanned/image-only resumes are not supported yet.")
    return {"text": text, "lines": lines}


def parse_pdf(pdf_bytes):
    return parse_text(extract_pdf_text(pdf_bytes))
