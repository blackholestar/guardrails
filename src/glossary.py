"""Plain-language explanations of each number. Served by the API so any front end shows the same text."""

GLOSSARY = {
    "I": {"label": "Typical monthly income (I)", "help": "How much money usually comes into this account each month."},
    "F": {"label": "Typical fixed costs (F)", "help": "The bills this customer has to pay every month no matter what: household bills, insurance and loan payments."},
    "S": {"label": "Typical monthly spending (S)", "help": "How much money usually goes out of this account each month, on everything."},
    "B": {"label": "Savings buffer (B)", "help": "About how much money the customer has sitting in the account lately. This is their cushion if income drops."},
    "H": {"label": "Household bills (H)", "help": "What they usually pay each month for things like rent and utilities."},
    "P": {"label": "Loan payment (P)", "help": "What they pay each month on a loan they still owe. $0 if they have no loan or have finished paying it."},
    "gap": {"label": "Monthly gap (S - I)", "help": "How much more they spend than they earn in a typical month. A negative number means they usually have money left over."},
    "runway": {"label": "Runway", "help": "How many months their cushion would last if they kept spending the same way. 'No shortfall' means their income already covers their spending."},
}

FLAG_TEXT = {
    "short_history": "Fewer than 6 months of history; numbers may be unreliable.",
    "no_income": "No income recorded; runway is based on spending only.",
    "no_bills": "No labelled household bills; bill shocks will have no effect.",
    "negative_buffer": "Average balance is zero or negative; runway is 0.",
}
