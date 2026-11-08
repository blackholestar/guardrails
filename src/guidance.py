"""Optional background text for the AI plan prompt, loaded from markdown files.

docs/insights/*.md  population-level findings across all accounts (e.g. the main predictors of running
                    out of money and which levers help). Teammates add or replace files here.
docs/guides/*.md    reference guidance (e.g. Canadian EI rules, asking a lender for a deferral), with sources.

Files are read in name order; README.md is skipped. Missing or empty folders give an empty string,
so the prompt works with no files. Edits are picked up on the next request (no restart needed).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSIGHTS_DIR = ROOT / "docs" / "insights"
GUIDES_DIR = ROOT / "docs" / "guides"
MAX_CHARS = 6000  # per folder; keeps the prompt small and fast


def _load(folder: Path, max_chars: int = MAX_CHARS) -> str:
    if not folder.is_dir():
        return ""
    parts = [p.read_text(encoding="utf-8").strip() for p in sorted(folder.glob("*.md")) if p.name.lower() != "readme.md"]
    text = "\n\n".join(p for p in parts if p)
    if len(text) > max_chars:
        text = text[:max_chars].rsplit("\n", 1)[0] + "\n[truncated]"
    return text


def load_insights(folder: Path = INSIGHTS_DIR) -> str:
    return _load(folder)


def load_guides(folder: Path = GUIDES_DIR) -> str:
    return _load(folder)
