#!/usr/bin/env python3
"""
Acceptance test: does the extracted budget reproduce the production
accountant's hot cost by hand?

For every named crew member the extractor found, compare:
  · the derived daily rate            against the hot cost RATE column
  · the derived prep day cost         against a PRESHOOT sheet's BUDGET/DAY
  · the derived shoot day cost        against a shoot sheet's BUDGET/DAY

The prep/shoot comparison is the point. A single day cost per person is wrong —
crew work shorter guaranteed hours in prep, and sometimes at a lower rate, so
the budgeted day differs by phase. If both columns match, the extractor has
preserved that.

    python verify_against_hotcost.py budget.json HOTCOST.xls
"""

from __future__ import annotations

import argparse
import json
import sys

try:
    import xlrd
except ImportError:  # pragma: no cover
    sys.exit("xlrd is required:  pip install xlrd")

COL_NAME, COL_POSITION, COL_RATE, COL_BUDGET_DAY = 1, 2, 4, 16
TOLERANCE = 0.02


def normalise(name: str) -> str:
    return "".join(ch for ch in (name or "").upper() if ch.isalnum())


def load_hotcost(path: str, sheet: str) -> dict[str, tuple[str, float, float]]:
    book = xlrd.open_workbook(path)
    if sheet not in book.sheet_names():
        raise SystemExit(f"sheet {sheet!r} not in {book.sheet_names()}")
    ws = book.sheet_by_name(sheet)
    crew: dict[str, tuple[str, float, float]] = {}
    for row in range(ws.nrows):
        name = ws.cell_value(row, COL_NAME)
        rate = ws.cell_value(row, COL_RATE)
        budget_day = ws.cell_value(row, COL_BUDGET_DAY)
        if (isinstance(name, str) and name.strip()
                and isinstance(rate, float) and rate > 0
                and isinstance(budget_day, float)):
            position = ws.cell_value(row, COL_POSITION)
            crew[normalise(name)] = (
                str(position).strip(), rate, budget_day)
    return crew


def phase_day_costs(detail: dict) -> dict[str, float]:
    """Best day cost per phase, ignoring zero-quantity placeholder rows."""
    out: dict[str, float] = {}
    for phase in detail["phases"]:
        cost, qty = phase.get("day_cost"), phase.get("qty")
        if cost is None or not qty:
            continue
        out.setdefault(phase["phase"], cost)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("budget_json")
    ap.add_argument("hotcost_xls")
    ap.add_argument("--prep-sheet", default="101317 PRESHOOT")
    ap.add_argument("--shoot-sheet", default="102017")
    args = ap.parse_args(argv)

    data = json.load(open(args.budget_json))
    prep = load_hotcost(args.hotcost_xls, args.prep_sheet)
    shoot = load_hotcost(args.hotcost_xls, args.shoot_sheet)

    records = [d for a in data["accounts"] for d in a["details"] if d.get("person")]
    by_name = {normalise(d["person"]): d for d in records}

    rate_ok = rate_n = shoot_ok = shoot_n = prep_ok = prep_n = 0
    misses: list[str] = []

    print(f"{'PERSON':<21}{'POSITION':<19}{'RATE':>16}{'PREP DAY':>18}{'SHOOT DAY':>18}")
    print("-" * 92)

    for key, detail in sorted(by_name.items()):
        if key not in shoot and key not in prep:
            continue
        position, hc_rate, hc_shoot_day = shoot.get(key, ("", None, None))
        _, _, hc_prep_day = prep.get(key, ("", None, None))
        costs = phase_day_costs(detail)
        derived_rate = detail.get("rate_value")
        basis = detail.get("rate_basis")
        if derived_rate is not None and basis == "week":
            derived_rate = derived_rate / 5.0

        def cell(derived, actual) -> tuple[str, bool | None]:
            if actual is None or not actual:
                return "—", None
            if derived is None:
                return f"?  /{actual:,.2f}", False
            good = abs(derived - actual) < TOLERANCE
            return f"{derived:,.2f}/{actual:,.2f}{' ✓' if good else ' ✗'}", good

        rate_cell, rate_good = cell(derived_rate, hc_rate)
        prep_cell, prep_good = cell(costs.get("prep"), hc_prep_day)
        shoot_cell, shoot_good = cell(costs.get("shoot"), hc_shoot_day)

        for good, counters in ((rate_good, "rate"), (prep_good, "prep"),
                               (shoot_good, "shoot")):
            if good is None:
                continue
            if counters == "rate":
                rate_n += 1
                rate_ok += bool(good)
            elif counters == "prep":
                prep_n += 1
                prep_ok += bool(good)
            else:
                shoot_n += 1
                shoot_ok += bool(good)

        if False in (rate_good, prep_good, shoot_good):
            misses.append(f"{detail['person']} — rate as written: "
                          f"{detail.get('rate_raw')!r}")

        print(f"{detail['person'][:20]:<21}{position[:18]:<19}"
              f"{rate_cell:>16}{prep_cell:>18}{shoot_cell:>18}")

    print("-" * 92)

    def pct(ok: int, n: int) -> str:
        return f"{ok}/{n}" + (f"  ({ok / n * 100:.0f}%)" if n else "")

    print(f"daily rate matches      {pct(rate_ok, rate_n)}")
    print(f"PREP day cost matches   {pct(prep_ok, prep_n)}")
    print(f"SHOOT day cost matches  {pct(shoot_ok, shoot_n)}")

    if misses:
        print(f"\nunmatched ({len(misses)}) — these are the records needing a human:")
        for m in misses[:10]:
            print(f"   · {m}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
