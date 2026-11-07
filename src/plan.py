"""Goal plan (emergency fund) and backup plan (cuts if the shock hits), from the customer's own numbers."""


def goal_plan(features_row) -> dict:
    """Emergency-fund targets (3 and 6 months of S), monthly savings from surplus, months to goal."""
    raise NotImplementedError


def backup_plan(features_row, shock_result) -> dict:
    """Ranked spending cuts with the runway gained from each."""
    raise NotImplementedError
