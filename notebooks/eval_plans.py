"""Live quality check for AI plans. Calls real Gemini (needs GEMINI_API_KEY and GEMINI_MODEL in .env).

Runs a fixed set of accounts with different profiles across the three example scenarios, saves every
response to cache/eval/<prompt_version>/, and prints a check table:
  actions   number of actions returned
  adjusted  actions whose amount the app reduced to fit the data
  dropped   actions the app rejected (bad category, unknown ref, no basis)
  no_evid   actions with empty evidence
  improves  plan runway >= runway after the event
  secs      request time

Run from the project root: python -m notebooks.eval_plans
"""
import json
import time

import pandas as pd

from src import service
from src.ai import PROMPT_VERSION, AIUnavailable
from src.details import load_details
from src.features import ROOT, load_features

SCENARIOS = {
    "ei": "I lost my job and only receive 55% of my income in EI benefits for 6 months.",
    "repair": "My car broke down and cost $3500 to fix.",
    "bills": "My rent and utility bills went up 15%.",
}


def pick_accounts() -> dict[str, int]:
    f, a = load_features(), load_details()["accounts"]
    cash = a["share12_cash_withdrawals_genuine"]
    return {
        "cash_heavy_deficit": int(a[(cash > 0.7) & (a["savings_rate12"] < 0)].index[0]),
        "loan_in_arrears": int(a[a["loan_status"] == "D"].index[1]),
        "pensioner": int(a["inshare12_pension_in"].idxmax()),
        "no_bills": int(f[f["flag_no_bills"] & ~f["flag_short_history"]].index[1]),
        "high_income": int(f["I"].idxmax()),
        "typical": 20134,
    }


def main():
    out_dir = ROOT / "cache" / "eval" / PROMPT_VERSION
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for profile, acc in pick_accounts().items():
        for key, text in SCENARIOS.items():
            t0 = time.time()
            try:
                res = service.plan_scenario(acc, text)
            except AIUnavailable as e:
                rows.append({"profile": profile, "account": acc, "scenario": key, "error": str(e)})
                continue
            secs = time.time() - t0
            (out_dir / f"{acc}_{key}.json").write_text(json.dumps(res, indent=2))
            acts = res["plan"]["actions"]
            rows.append({
                "profile": profile, "account": acc, "scenario": key,
                "actions": len(acts),
                "adjusted": sum(a["status"] == "adjusted" for a in acts),
                "dropped": sum(a["status"] == "dropped" for a in acts),
                "advice": sum(a["status"] == "advice" for a in acts),
                "no_evid": sum(not a["evidence"].strip() for a in acts),
                "improves": res["plan"]["result"]["runway_months"] >= res["impact"]["result"]["runway_months"],
                "runway": f"{res['impact']['result']['runway_label']} -> {res['plan']['result']['runway_label']}",
                "secs": round(secs, 1),
            })
    df = pd.DataFrame(rows)
    print(df.to_string(index=False))
    ok = df.get("error") is None or df["error"].isna().all()
    ok = ok and (df["no_evid"] == 0).all() and df["improves"].all()
    print(f"\n{'PASS' if ok else 'CHECK'}: saved {len(df)} responses to {out_dir}")


if __name__ == "__main__":
    main()
