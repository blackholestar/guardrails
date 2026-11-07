"""How much would trimming flexible spending improve runway? Run: python notebooks/explore_levers.py"""
import numpy as np
import pandas as pd

f = pd.read_parquet("cache/features.parquet")


def runway(B, I, S, mult=0.55):
    gap = S - mult * I
    return np.where(B <= 0, 0, np.where(gap <= 0, 120, np.minimum(B / np.where(gap <= 0, 1, gap), 120)))


f["rw0"] = runway(f.B, f.I, f.S)
at_risk = f[f.rw0 < 3]
print("at risk under EI55 (<3 months):", len(at_risk), "of", len(f))
print("their median cash withdrawals as share of S:", round((at_risk.cash_withdrawals / at_risk.S).median(), 2))
print("their median S/I:", round((at_risk.S / at_risk.I).median(), 2))

for cut in (0.10, 0.20, 0.30):
    S2 = f.S - cut * f.cash_withdrawals
    rw = runway(f.B, f.I, S2)
    moved = ((f.rw0 < 3) & (rw >= 3)).sum()
    print(f"cut cash withdrawals {int(cut*100)}%: {moved} of {len(at_risk)} at-risk accounts reach 3+ months; "
          f"median runway gain among at-risk: {np.median((rw - f.rw0)[f.rw0 < 3]):.1f} months")

# Emergency fund: months to reach 3 months of S at current surplus
surplus = (f.I - f.S).clip(lower=0)
target = 3 * f.S
months = ((target - f.B).clip(lower=0) / surplus.replace(0, np.nan))
print("\nemergency fund (3 x S):")
print("already have it:", round((f.B >= target).mean(), 3))
print("no surplus (spend >= earn) and below target:", round(((surplus == 0) & (f.B < target)).mean(), 3))
print("months to reach target at current surplus (those with surplus, below target):",
      months[(f.B < target) & (surplus > 0)].describe().round(1).to_dict())
