"""UI-agnostic service layer.

Returns plain JSON-serializable dicts so any front end can use it: Streamlit
today, or a React app later by wrapping `get_account` in a FastAPI route
(e.g. GET /accounts/{id}?income_multiplier=0.55&...).
"""
import math

from .engine import Shock, compute
from .features import load_features

_features = None


def _get_features():
    global _features
    if _features is None:
        _features = load_features()
    return _features


def _clean(obj):
    """Make values JSON-safe (numpy scalars, NaN)."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if hasattr(obj, "item"):  # numpy scalar
        obj = obj.item()
    if isinstance(obj, float) and math.isnan(obj):
        return None
    return obj


def list_account_ids() -> list[int]:
    return [int(i) for i in _get_features().index]


def get_account(account_id: int, shock: dict | None = None) -> dict:
    """Profile + baseline + shocked runway for one account."""
    s = Shock(**shock) if shock else Shock()
    return _clean(compute(int(account_id), s, features=_get_features()))
