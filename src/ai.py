"""Gemini layer. Explains engine output and parses twist cards. Never does the math."""
import os

from dotenv import load_dotenv

load_dotenv()


def explain(engine_output: dict) -> str:
    """Short plain-language narrative of the result and plan. Falls back to a template on failure."""
    raise NotImplementedError


def parse_twist(text: str) -> dict:
    """Turn a typed twist card into Shock parameters using a JSON response schema."""
    raise NotImplementedError
