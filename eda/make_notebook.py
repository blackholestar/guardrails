"""Generates notebooks/eda.ipynb (run once; then open/edit the notebook directly)."""
from pathlib import Path

import nbformat as nbf

md, code = nbf.v4.new_markdown_cell, nbf.v4.new_code_cell
cells = [
    md("# How we found it: exploring the Tangerine data\n"
       "We started with no theory. We built one profile per customer with the judges' formulas, then plotted "
       "everything and followed whatever looked odd. This notebook is that trail, in order: **what we asked, the "
       "graph, what we saw, and the question it raised next.**\n\n"
       "The trail ends at the findings that drive Guardrails. The tested versions, with confidence intervals and "
       "holdout checks, are in `findings/findings_walkthrough.ipynb`.\n\n"
       "Run top to bottom (`Run All`). Run it from this `eda/` folder. Every number uses the formulas in `eda_engine/`, so it matches the README formulas."),
    code("""import sys; sys.path.insert(0, '.')
import numpy as np, pandas as pd, matplotlib.pyplot as plt, matplotlib.ticker as mtick
from eda_engine.core import load, build_profiles, apply_shock, runway_number, PRESETS
pd.set_option('display.width', 160)
%matplotlib inline

# chart style (reference palette, light)
SURFACE, INK, INK2, MUTED, GRID, BASE = '#fcfcfb', '#0b0b0b', '#52514e', '#898781', '#e1e0d9', '#c3c2b7'
BLUE, ORANGE = '#2a78d6', '#eb6834'
plt.rcParams.update({'font.family': ['Helvetica Neue', 'Arial', 'DejaVu Sans'], 'font.size': 11,
    'axes.edgecolor': BASE, 'axes.labelcolor': INK2, 'xtick.color': INK2, 'ytick.color': MUTED,
    'figure.facecolor': SURFACE, 'axes.facecolor': SURFACE, 'figure.dpi': 110})

def frame(ax, title, subtitle, pct=False, top=None):
    ax.set_title(title, loc='left', fontsize=14, fontweight='bold', color=INK, pad=24)
    ax.text(0, 1.03, subtitle, transform=ax.transAxes, fontsize=10, color=INK2)
    for s in ['top', 'right', 'left']: ax.spines[s].set_visible(False)
    ax.grid(axis='y', color=GRID, linewidth=0.8); ax.set_axisbelow(True)
    ax.tick_params(axis='both', length=0)
    if pct: ax.yaxis.set_major_formatter(mtick.PercentFormatter(1.0, decimals=0))
    if top is not None: ax.set_ylim(0, top)

def labels(ax, bars, fmt):
    for b in bars:
        ax.text(b.get_x()+b.get_width()/2, b.get_height(), fmt(b.get_height()), ha='center', va='bottom',
                fontsize=10, color=INK, fontweight='bold')

def bars(ax, names, values, color=BLUE, width=0.55):
    return ax.bar(names, values, color=color, width=width, edgecolor=SURFACE, linewidth=2)"""),

    md("## Step 1. One row per customer\n"
       "4,500 accounts of monthly money in and out. We turned each into the judges' figures: income (I), spending (S), "
       "savings (B), bills (H), loan payment (P), and runway after a job loss on EI."),
    code("""D = '../data/data'
ms, loans = load(D)
prof = build_profiles(ms, loans)
clients = pd.read_csv(f'{D}/clients.csv', parse_dates=['birth_date'])
disp = pd.read_csv(f'{D}/dispositions.csv'); districts = pd.read_csv(f'{D}/districts.csv')
cards = pd.read_csv(f'{D}/cards.csv')

owner = disp[disp.type == 'owner'].merge(clients, on='client_id')
owner['age'] = ((pd.Timestamp('2025-12-31') - owner.birth_date).dt.days / 365.25).astype(int)
x = prof.join(owner.set_index('account_id')[['gender', 'age', 'district_id']])
x = x.reset_index().merge(districts[['district_id','region','average_salary','unemployment_rate_2023']], on='district_id', how='left').set_index('account_id')
x['card'] = disp.merge(cards, on='disposition_id').groupby('account_id').card_type.first().reindex(x.index).fillna('none')
x['loan'] = loans.set_index('account_id').status.reindex(x.index).fillna('none')
g = ms.groupby('account_id')
x['pension_share'] = (g.pension_in.sum() / g.money_in.sum()).reindex(x.index)
x['retiree'] = x.pension_share > 0.5
x['savings_rate'] = (x.I_income - x.S_spending) / x.I_income.where(x.I_income > 0)
x['buffer_months'] = x.B_buffer / x.S_spending
x['ei_runway'] = [runway_number(apply_shock(p, PRESETS['job_loss_ei'])['runway_after']) for _, p in prof.iterrows()]
x['survives_ei_6m'] = x.ei_runway >= 6
print(f'{len(x):,} accounts | {len(ms):,} account-months | {len(loans)} loans | retirees: {x.retiree.sum()}')
x[['I_income','S_spending','B_buffer','base_runway','ei_runway','age','loan']].head()"""),

    md("## Step 2. First look: who are these people?\n"
       "**We asked:** before any shock, what do age, income and savings look like?"),
    code("""fig, axes = plt.subplots(1, 3, figsize=(14, 4))
axes[0].hist(x.age, bins=30, color=BLUE, edgecolor=SURFACE); frame(axes[0], 'Age', 'Account owners')
axes[1].hist(x.I_income.clip(upper=40000), bins=40, color=BLUE, edgecolor=SURFACE); frame(axes[1], 'Typical monthly income', 'Median money in, $ (capped at 40k)')
axes[2].hist(x.buffer_months.clip(upper=24), bins=40, color=BLUE, edgecolor=SURFACE); frame(axes[2], 'Savings in months of spending', 'Buffer / spending (capped at 24)')
plt.tight_layout(); plt.show()
print('median income $%.0f | median spending $%.0f | median buffer $%.0f' % (x.I_income.median(), x.S_spending.median(), x.B_buffer.median()))
print('spend more than they earn in a typical month: %.1f%%' % (100*(x.savings_rate < 0).mean()))"""),
    md("**What we saw:** income and savings are both long-tailed, and savings measured in *months of spending* "
       "are thin for many people. That made us ask how many would actually make it through a shock."),

    md("## Step 2b. Our first round of plots\n"
       "**We asked:** with no theory yet, what does the money actually do? We plotted five things and kept the ones that looked odd."),
    code("""fig, axes = plt.subplots(2, 2, figsize=(14, 9))
# a. money in vs money out
ax = axes[0, 0]
ax.scatter(x.I_income.clip(lower=1), x.S_spending.clip(lower=1), s=5, alpha=0.3, color=BLUE)
lim = [100, 2e5]; ax.plot(lim, lim, color=INK2, linewidth=1); ax.set_xscale('log'); ax.set_yscale('log')
ax.set_xlabel('Typical monthly income ($, log)'); ax.set_ylabel('Typical monthly spending ($, log)')
frame(ax, 'Most people spend about what they earn', 'Each dot is a customer; the line is spending = income')
# b. where the money goes
ax = axes[0, 1]
cats = ['cash_withdrawals_genuine', 'transfers_out_other', 'household_bills', 'loan_payments', 'card_withdrawals', 'insurance', 'bank_fees']
share = (ms.groupby('account_id')[cats].sum().div(ms.groupby('account_id').money_out.sum(), axis=0)).median().sort_values()
nice = {'cash_withdrawals_genuine': 'Cash', 'transfers_out_other': 'Other transfers', 'household_bills': 'Household bills', 'loan_payments': 'Loan', 'card_withdrawals': 'Card', 'insurance': 'Insurance', 'bank_fees': 'Bank fees'}
ax.barh([nice[c] for c in share.index], share.values, color=BLUE, edgecolor=SURFACE, linewidth=2)
for i, v in enumerate(share.values): ax.text(v, i, f' {v:.0%}', va='center', fontsize=10, color=INK, fontweight='bold')
frame(ax, 'Cash is where the money goes', 'Median share of money out, per customer'); ax.grid(axis='x', color=GRID); ax.grid(axis='y', visible=False)
ax.xaxis.set_major_formatter(mtick.PercentFormatter(1.0, decimals=0))
# c. how often people are overdrawn
ax = axes[1, 0]
od = (ms.days_below_zero > 0).groupby(ms.account_id).sum()
ax.hist(od.clip(upper=24), bins=25, color=BLUE, edgecolor=SURFACE)
frame(ax, 'Few customers are ever overdrawn', 'Months overdrawn per customer (capped at 24)')
# d. which simple signal tracks runway after a job loss?
ax = axes[1, 1]
sig = pd.DataFrame({'Income': x.I_income, 'Spending': x.S_spending, 'Savings ($)': x.B_buffer, 'Savings (months)': x.buffer_months,
                    'Lowest balance': ms.groupby('account_id').min_balance.min().reindex(x.index), 'Age': x.age})
rho = sig.apply(lambda c: c.corr(x.ei_runway, method='spearman')).sort_values()
ax.barh(rho.index, rho.values, color=[ORANGE if v < 0 else BLUE for v in rho.values], edgecolor=SURFACE, linewidth=2)
for i, v in enumerate(rho.values): ax.text(v, i, f' {v:+.2f}', va='center', ha='left' if v >= 0 else 'right', fontsize=10, color=INK, fontweight='bold')
ax.axvline(0, color=BASE); frame(ax, 'Income runs the wrong way', 'Spearman correlation with runway after a job loss'); ax.grid(axis='y', visible=False)
plt.tight_layout(); plt.show()
print('overdrawn at least once: %.0f%% of customers' % (100 * (od > 0).mean()))
print('correlations:', rho.round(2).to_dict())"""),
    md("**What we saw:**\n"
       "- Most people spend close to what they earn, so a drop in income turns into a gap almost at once.\n"
       "- For the typical customer, about two thirds of money out is cash and a fifth is household bills. Cash is the one big "
       "flexible line, which is why we later asked what people cut in a crash.\n"
       "- Only about 6% of customers were ever overdrawn, so overdrafts are a rare outcome that we would have to predict early.\n"
       "- Runway after a job loss tracks *savings in months* almost one for one (that is close to how runway is defined). "
       "The surprise was income: it runs the **wrong way** (−0.68), because spending rises with it (−0.79). "
       "That one bar set up Steps 3 to 5."),

    md("## Step 3. Hit everyone with the brief's shocks\n"
       "**We asked:** with the README formulas, how many run out of savings within 6 months under each shock?"),
    code("""rows = []
for key, shock in PRESETS.items():
    r = [runway_number(apply_shock(p, shock)['runway_after']) for _, p in prof.iterrows()]
    rows.append((shock.label, np.mean(np.array(r) < 6)))
base = [runway_number(v) for v in prof.base_runway]
rows.insert(0, ('No shock', np.mean(np.array(base) < 6)))
s = pd.DataFrame(rows, columns=['scenario', 'out_within_6m']).set_index('scenario')
fig, ax = plt.subplots(figsize=(10, 4.5))
b = bars(ax, [t.replace(' (', '\\n(').replace(' + ', '\\n+ ') for t in s.index], s.out_within_6m)
labels(ax, b, lambda v: f'{v:.0%}')
frame(ax, 'One job loss puts a third of customers at risk', 'Share of customers who run out of money within 6 months', pct=True, top=0.5)
plt.tight_layout(); plt.show()"""),
    md("**What we saw:** a single job loss on EI puts about a third of customers out of money within 6 months. "
       "Our first guess was that these would be the low earners. So we checked."),

    md("## Step 4. Surprise: higher earners survive *less* often\n"
       "**We asked:** does survival rise with income? Working customers only (retirees removed, because a job loss can't cut a pension)."),
    code("""w = x[~x.retiree].copy()
w['q'] = pd.qcut(w.I_income, 4, labels=['Lowest 25%', '2nd', '3rd', 'Highest 25%'])
t = w.groupby('q', observed=True).agg(median_income=('I_income','median'), buffer_months=('buffer_months','median'),
                                     savings_rate=('savings_rate','median'), survives=('survives_ei_6m','mean'))
display(t.round(2))
fig, axes = plt.subplots(1, 2, figsize=(14, 4.5))
labels(axes[0], bars(axes[0], t.index.astype(str), t.survives), lambda v: f'{v:.0%}')
frame(axes[0], 'Higher earners survive less often', 'Share whose savings last 6 months on EI', pct=True, top=1.05)
labels(axes[1], bars(axes[1], t.index.astype(str), t.buffer_months), lambda v: f'{v:.1f} mo')
frame(axes[1], 'Because savings cover fewer months', 'Median savings in months of own spending', top=t.buffer_months.max()*1.2)
plt.tight_layout(); plt.show()
print('Spearman corr, income vs EI runway (workers): %.2f' % w[['I_income','ei_runway']].corr(method='spearman').iloc[0,1])"""),
    md("**What we saw:** the opposite of our guess. Higher earners spend more, so the same savings cover fewer months. "
       "Before believing it, we needed to rule out a data quirk."),

    md("## Step 5. Is it real?\n**Check before claiming:** do the lowest-income accounts look like *real* low earners, or like accounts "
       "where most money arrives elsewhere? A side account would show small income *and* small spending."),
    code("""q1 = w[w.q == 'Lowest 25%']
print('Lowest 25%%: median income $%.0f, median spending $%.0f, median buffer $%.0f' % (q1.I_income.median(), q1.S_spending.median(), q1.B_buffer.median()))
print('share with buffer > 12 months of spending: %.0f%%' % (100*(q1.buffer_months > 12).mean()))
fig, ax = plt.subplots(figsize=(7, 4.5))
ax.scatter(w.I_income, w.B_buffer, s=6, alpha=0.35, color=BLUE)
ax.set_xscale('log'); ax.set_yscale('log'); ax.set_xlabel('Typical monthly income ($, log)'); ax.set_ylabel('Buffer ($, log)')
frame(ax, 'Income vs savings', 'Each dot is a working customer')
plt.tight_layout(); plt.show()"""),
    md("**What we saw:** the low earners look like real low earners, not side accounts. The pattern held. "
       "If income level doesn't tell you who gets into trouble, what does? Loans gave us a real outcome to test against."),

    md("## Step 6. What predicts loan default?\n"
       "**We asked:** which signals, measured *before* a loan started, separate the loans that defaulted? 615 loans with at least 6 months of history; signals measured in the 12 months **before** the loan."),
    code("""from sklearn.metrics import roc_auc_score
ms['m'] = pd.to_datetime(ms.month)
feat = []
for _, l in loans.iterrows():
    h = ms[(ms.account_id == l.account_id) & (ms.m < pd.Timestamp(l.loan_start).to_period('M').to_timestamp())].tail(12)
    if len(h) < 6: continue
    feat.append({'defaulted': l.defaulted, 'income': h.money_in.median(),
                 'income_volatility': h.money_in.std() / max(h.money_in.mean(), 1),
                 'worst_day_balance': h.min_balance.min(),
                 'buffer_months': h.avg_daily_balance.tail(6).mean() / max(h.money_out.median(), 1)})
L = pd.DataFrame(feat)
auc = {c: max(roc_auc_score(L.defaulted, L[c]), 1 - roc_auc_score(L.defaulted, L[c])) for c in ['worst_day_balance','income_volatility','buffer_months','income']}
print(f'{len(L)} loans, {int(L.defaulted.sum())} defaults')
pd.Series(auc, name='AUC (0.5 = coin flip)').round(3).to_frame()"""),
    md("**What we saw:** the lowest balance of the year and how unsteady income is both beat income level. "
       "We split the loans to see it plainly."),
    code("""L['level'] = np.where(L.income > L.income.median(), 'Higher income', 'Lower income')
L['steady'] = L.income_volatility < 0.5
t = L.groupby(['level','steady']).defaulted.mean().unstack().loc[['Lower income','Higher income']]
L['worst'] = pd.cut(L.worst_day_balance, [-1e9, 500, 2000, 5000, 1e9], labels=['Below $500','$500-2k','$2k-5k','Above $5k'])
d = L.groupby('worst', observed=True).defaulted.agg(['mean','size'])

fig, axes = plt.subplots(1, 2, figsize=(14, 4.8))
pos = np.arange(2); wd = 0.32
labels(axes[0], axes[0].bar(pos-wd/2-0.01, t[True], wd, color=BLUE, label='Steady income', edgecolor=SURFACE, linewidth=2), lambda v: f'{v:.1%}')
labels(axes[0], axes[0].bar(pos+wd/2+0.01, t[False], wd, color=ORANGE, label='Unsteady income', edgecolor=SURFACE, linewidth=2), lambda v: f'{v:.1%}')
axes[0].set_xticks(pos, t.index); axes[0].legend(frameon=False, labelcolor=INK2)
frame(axes[0], 'Steady income beats high income', 'Loan default rate', pct=True, top=0.32)
labels(axes[1], bars(axes[1], [f'{k}\\n{n} loans' for k, n in zip(d.index.astype(str), d['size'])], d['mean']), lambda v: f'{v:.1%}')
frame(axes[1], 'Your worst day predicts trouble', 'Default rate by lowest balance in the prior 12 months', pct=True, top=0.27)
plt.tight_layout(); plt.show()"""),

    md("**What we saw:** steady income matters more than high income, and a dip below $500 marks the loans that went bad. "
       "Those two signals became guardrails: a low-balance alert, and an early talk with the lender."),

    md("## A lead we dropped: \"income crashes cluster in January\"\n"
       "**Why we believed it.** To study real shocks, we found every account whose income fell to half of normal or less "
       "for 3 months in a row (569 accounts) and took the *first* crash for each. Almost one in five of those started in "
       "January, more than twice the share of any other month. January is also when spending spikes, so the story fit."),
    code("""names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
first, every = [], []
for acc, g in ms.sort_values(['account_id', 'month']).groupby('account_id'):
    mi, mo, got = g.money_in.values, g.month.values, False
    for i in range(12, len(g) - 3):
        base = np.median(mi[i-12:i])
        if base > 0 and (mi[i:i+3] <= 0.5 * base).all():
            every.append(int(mo[i][5:]))
            if not got: first.append(int(mo[i][5:])); got = True
ms['mon'] = ms.month.str[5:].astype(int)
low = ms.money_in < 0.5 * ms.groupby('account_id').money_in.transform('median')
views = [(pd.Series(first).value_counts(normalize=True).reindex(range(1, 13), fill_value=0), f'First crash per account ({len(first)})', 'What we saw first'),
         (pd.Series(every).value_counts(normalize=True).reindex(range(1, 13), fill_value=0), f'Every crash start ({len(every)})', 'Count every crash, not just the first'),
         (low.groupby(ms.mon).mean(), 'Share of all months with income under half of normal', 'Look at every low month')]
fig, axes = plt.subplots(1, 3, figsize=(15, 4.2), sharey=False)
for ax, (v, sub, title) in zip(axes, views):
    ax.bar(names, v.values, color=[ORANGE if k == 0 else BLUE for k in range(12)], edgecolor=SURFACE, linewidth=2)
    frame(ax, title, sub, pct=True, top=max(v.max() * 1.25, 0.12)); ax.tick_params(axis='x', labelsize=8)
plt.tight_layout(); plt.show()
print('January share: first crash %.0f%% | every crash start %.0f%% | all low months %.1f%% (other months %.1f%%-%.1f%%)' % (
    100 * views[0][0][1], 100 * views[1][0][1], 100 * views[2][0][1], 100 * views[2][0].drop(1).min(), 100 * views[2][0].drop(1).max()))
sea = ms.groupby('mon').money_out.median()
print('January median spending $%.0f vs February $%.0f (this part is real)' % (sea[1], sea[2]))"""),
    md("**Why we dropped it.** The spike came from *how we picked* crashes, not from January. Keeping only the first crash "
       "per account favours whichever month a long slump happens to start in. Count every crash and January is level with "
       "February; count every low-income month and each calendar month has about the same share. So crashes do not cluster "
       "in January, and nothing in Guardrails uses that claim. The January *spending* spike is real and stays in the data story.\n\n"
       "**Lesson we kept:** before believing a pattern, change how it is counted. If it moves, it was the counting."),

    md("## Step 7. Scan every other segment\n"
       "**We asked:** what else moves survival? We cut the EI result by age, retirement, loans, cards, district and gender."),
    code("""def seg(col, bins=None, lab=None):
    k = pd.cut(x[col], bins, labels=lab) if bins else x[col]
    return x.groupby(k, observed=True).agg(n=('ei_runway','size'), survives_EI_6m=('survives_ei_6m','mean'), median_EI_runway=('ei_runway','median')).round(2)
for name, args in [('Age', ('age', [0,30,45,60,120], ['<30','30-44','45-59','60+'])), ('Retiree', ('retiree',)),
                   ('Loan status (A repaid, B defaulted, C running OK, D running in debt)', ('loan',)),
                   ('Card', ('card',)), ('District unemployment 2023', ('unemployment_rate_2023', [0,2,4,6,20])), ('Gender', ('gender',))]:
    print(f'--- {name}'); display(seg(*args))"""),

    md("**What we saw:** retirees almost all make it (a job loss cannot cut a pension), and borrowers are much more fragile: 16% of loans running in debt survive vs 70% of customers with no loan. District and gender make little difference.\n\n"
       "## Where the trail led\n"
       "| What we noticed here | Tested in `findings/findings_walkthrough.ipynb` | Guardrail it became |\n"
       "|---|---|---|\n"
       "| A third run out within 6 months on EI | Runway from 2024 data predicts who was overdrawn in 2025 (AUC 0.78) | The runway itself, and the goal line |\n"
       "| High earners survive less often | Their savings cover fewer months (2.9 → 1.8) | Plans cut spending, not just look at income |\n"
       "| Worst-day balance predicts trouble | Lowest balance predicts 2025 overdrafts, AUC 0.90; a $0–500 near-miss comes a median 13 months first | Low-balance alert at $500 |\n"
       "| Unsteady income predicts default | Odds ratio 4.7 [2.5–8.8], controlling for income, savings and loan size | Loan deferral request |\n"
       "| (next step) What do people cut in a crash? | In 569 income crashes, cash fell 59%; bills and loans didn't move | Lower cash limit |\n\n"
       "Caveat: this is the PKDD'99 research dataset (a 1990s Czech bank, converted to CAD with shifted dates)."),
]
nb = nbf.v4.new_notebook(cells=cells, metadata={"kernelspec": {"name": "python3", "display_name": "Python 3"}})
nbf.write(nb, Path(__file__).with_name("eda.ipynb"))
print("wrote eda.ipynb")
