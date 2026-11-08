"""Detail cache (src/details.py), account summary (src/summary.py) and guidance loading (src/guidance.py).

Detail values are recomputed from the raw CSVs with the stdlib, independent of pandas.
"""
import csv
import statistics as st
from pathlib import Path

import pytest

from src.details import load_details
from src.features import load_features
from src.guidance import load_insights
from src.summary import format_account_summary

DATA = Path(__file__).resolve().parents[1] / "data" / "data"


@pytest.fixture(scope="module")
def details():
    return load_details(rebuild=True)


@pytest.fixture(scope="module")
def features():
    return load_features()


def _last12(account_id):
    rows = sorted((r for r in csv.DictReader(open(DATA / "monthly_summary.csv")) if r["account_id"] == str(account_id)),
                  key=lambda r: r["month"])
    last = rows[-1]["month"]
    y, m = int(last[:4]), int(last[5:])
    start = f"{y - 1}-{m + 1:02d}" if m < 12 else f"{y}-01"
    return [r for r in rows if r["month"] >= start]


@pytest.mark.parametrize("account_id", [20111, 20133, 20134])
def test_twelve_month_medians_match_raw_csv(details, account_id):
    rows = _last12(account_id)
    a = details["accounts"].loc[account_id]
    assert a["months_window"] == len(rows) == 12
    for col in ("cash_withdrawals_genuine", "household_bills", "money_out", "money_in"):
        vals = [float(r[col]) for r in rows]
        assert a[f"med12_{col}"] == pytest.approx(st.median(vals)), col
        assert a[f"avg12_{col}"] == pytest.approx(sum(vals) / len(vals)), col
    assert a["deficit_months12"] == sum(float(r["money_out"]) > float(r["money_in"]) for r in rows)


def test_every_account_has_details(details, features):
    assert set(details["accounts"].index) == set(features.index)


def test_orders_match_standing_orders_csv(details):
    raw = [r for r in csv.DictReader(open(DATA / "standing_orders.csv")) if r["account_id"] == "20134"]
    got = details["orders"][details["orders"]["account_id"] == 20134]
    assert sorted(got["order_id"]) == sorted(int(r["order_id"]) for r in raw)


def test_payees_exclude_placeholder_partner(details):
    assert not (details["payees"]["partner_account"] == "0").any()


def test_summary_has_refs_for_standing_orders_and_loan(features, details):
    text, refs = format_account_summary(20134, features, details)
    assert {"SO-771074", "SO-546065", "loan-634677"} <= set(refs)
    for ref in refs:
        assert f"[{ref}]" in text
    assert refs["loan-634677"]["amount"] == pytest.approx(features.loc[20134, "P"])


def test_summary_omits_empty_sections_and_flags_missing_bills(features, details):
    text, refs = format_account_summary(20111, features, details)  # loan in debt, no household bills
    assert "household_bills:" not in text
    assert "no household bills recorded" in text
    assert "status D" in text


def test_summary_is_bounded_and_deterministic(features, details):
    for acc in list(features.index[:300]):
        text, _ = format_account_summary(acc, features, details)
        assert len(text.splitlines()) <= 80
    assert format_account_summary(20134, features, details) == format_account_summary(20134, features, details)


def test_summary_unknown_account_raises(features, details):
    with pytest.raises(KeyError):
        format_account_summary(1, features, details)


def test_insights_empty_folder_and_order(tmp_path):
    assert load_insights(tmp_path / "missing") == ""
    assert load_insights(tmp_path) == ""
    (tmp_path / "b.md").write_text("second")
    (tmp_path / "a.md").write_text("first")
    (tmp_path / "README.md").write_text("skip me")
    assert load_insights(tmp_path) == "first\n\nsecond"


def test_insights_are_truncated(tmp_path):
    (tmp_path / "a.md").write_text("line\n" * 5000)
    text = load_insights(tmp_path)
    assert len(text) <= 6000 + len("\n[truncated]") and text.endswith("[truncated]")
