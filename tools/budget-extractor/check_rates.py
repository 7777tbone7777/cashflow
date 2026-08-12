#!/usr/bin/env python3
"""
Check budgeted crew rates against union scale.

    python check_rates.py budget.json rates.json

Below-scale is a liability, not a saving — it surfaces later as a grievance and
a retroactive payment nobody has flowed. This finds it before the schedule is
built, which is the cheapest moment to find it.

Matching is deliberately conservative. A rate card lists "First Assistant" where
a budget says '1st AC "A" Camera', so the two are matched on normalised token
overlap and anything below a firm threshold is reported as **unmatched rather
than guessed**. A false match here would either invent a compliance problem or
hide a real one, and both are worse than an honest gap.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from typing import Any

DAYS_PER_WEEK = 5.0
MATCH_FLOOR = 0.60          # token overlap below this is not a match
TOLERANCE = 0.005           # within half a percent of scale counts as at-scale

# Vocabulary the two documents spell differently.
SYNONYMS = {
    "1st": "first", "2nd": "second", "3rd": "third",
    "asst": "assistant", "ac": "assistant", "dp": "director photography",
    "op": "operator", "opr": "operator", "bb": "best boy",
    "dit": "digital imaging technician", "mixer": "sound mixer",
    "photog": "photographer", "coord": "coordinator", "mgr": "manager",
    "supv": "supervisor", "elec": "electrician", "hair": "hairstylist",
}
NOISE_WORDS = {"a", "b", "c", "the", "of", "and", "camera_letter"}


def normalise(text: str) -> set[str]:
    text = (text or "").lower()
    text = re.sub(r'"[a-z]"', " ", text)          # drop '"A" Camera' letters
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    tokens: list[str] = []
    for token in text.split():
        token = SYNONYMS.get(token, token)
        tokens.extend(token.split())
    return {t for t in tokens if t not in NOISE_WORDS and len(t) > 1}


def similarity(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def local_of(union: str | None) -> str | None:
    if not union:
        return None
    m = re.search(r"(\d{2,4})", union)
    if m:
        return f"IATSE Local {m.group(1)}"
    for name in ("DGA", "WGA", "SAG", "Teamster"):
        if name.lower() in union.lower():
            return "SAG-AFTRA" if name == "SAG" else (
                "Teamsters Local 399" if name == "Teamster" else name)
    return None


REGION_HINTS = {
    "eastern region": {"new york", "ny", "nyc", "east", "atlanta", "boston"},
    "western region": {"los angeles", "la", "california", "ca", "west"},
    "central region": {"chicago", "illinois", "central"},
}


def region_matches(card_region: str | None, production_region: str | None) -> bool:
    """Only compare a rate to a card that governs where the show shoots.

    Scale is regional. The reference production shot in Los Angeles; the rate
    cards to hand are Eastern Region and Canadian. Comparing across that
    boundary manufactures compliance findings out of nothing, which is worse
    than reporting no coverage.
    """
    if not card_region:
        return False
    if not production_region:
        return False
    card = card_region.lower()
    where = production_region.lower()
    for name, places in REGION_HINTS.items():
        if name in card:
            return any(place in where for place in places)
    return card.split()[0] in where


def build_index(rates: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Scale rates grouped by local, trusted cards only."""
    index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for card in rates["cards"]:
        if not card.get("trusted"):
            continue
        for rate in card["rates"]:
            entry = dict(rate)
            entry["_card"] = card["source"]
            entry["_region"] = card.get("region")
            entry["_effective"] = card.get("effective_from")
            entry["_tokens"] = normalise(rate["classification"])
            index[card.get("local") or "—"].append(entry)
    return index


def daily(amount: float, basis: str) -> float | None:
    if basis == "day":
        return amount
    if basis == "week":
        return amount / DAYS_PER_WEEK
    return None                     # hourly compares hourly, not by the day


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("budget_json")
    ap.add_argument("rates_json")
    ap.add_argument("--show", type=int, default=12)
    ap.add_argument("--region", help="where the production shoots, e.g. 'Los Angeles'")
    args = ap.parse_args(argv)

    budget = json.load(open(args.budget_json))
    rates = json.load(open(args.rates_json))
    index = build_index(rates)

    region = args.region or ""
    wrong_region = 0
    checked = below = at_or_above = unmatched = no_local = 0
    findings: list[dict[str, Any]] = []

    for account in budget["accounts"]:
        for detail in account["details"]:
            if not detail.get("is_labour") or not detail.get("rate_value"):
                continue
            checked += 1
            local = local_of(detail.get("union") or detail.get("scale"))
            if not local or local not in index:
                no_local += 1
                continue

            position = detail.get("sub_display") or ""
            tokens = normalise(position.split("/")[-1])
            applicable = [c for c in index[local]
                          if region_matches(c.get("_region"), region)]
            if not applicable:
                wrong_region += 1
                continue
            best, score = None, 0.0
            for candidate in applicable:
                s = similarity(tokens, candidate["_tokens"])
                if s > score:
                    best, score = candidate, s
            if best is None or score < MATCH_FLOOR:
                unmatched += 1
                continue

            basis = detail.get("rate_basis") or "week"
            budgeted = detail["rate_value"]
            if basis == "week" and best["basis"] == "week":
                scale = best["amount"]
            elif basis == "hour" and best["basis"] == "hour":
                scale = best["amount"]
            else:
                b, s_ = daily(budgeted, basis), daily(best["amount"], best["basis"])
                if b is None or s_ is None:
                    unmatched += 1
                    continue
                budgeted, scale = b, s_

            delta = budgeted - scale
            if delta < -abs(scale) * TOLERANCE:
                below += 1
                findings.append({
                    "person": detail.get("person"), "position": position,
                    "local": local, "matched": best["classification"],
                    "match_score": round(score, 2),
                    "budgeted": round(budgeted, 2), "scale": round(scale, 2),
                    "shortfall": round(delta, 2), "basis": basis,
                    "card": best["_card"], "effective": best["_effective"],
                })
            else:
                at_or_above += 1

    print(f"{'crew records with a rate':<38}{checked:>6}")
    print(f"{'no local identified':<38}{no_local:>6}")
    print(f"{'no rate card for this region':<38}{wrong_region:>6}")
    print(f"{'no confident classification match':<38}{unmatched:>6}")
    print(f"{'checked against scale':<38}{below + at_or_above:>6}")
    print(f"{'  at or above scale':<38}{at_or_above:>6}")
    print(f"{'  BELOW scale':<38}{below:>6}")

    if findings:
        print(f"\n{'PERSON':<20}{'POSITION':<20}{'LOCAL':<18}"
              f"{'BUDGET':>10}{'SCALE':>10}{'SHORT':>10}")
        print("-" * 88)
        for f in sorted(findings, key=lambda x: x["shortfall"])[:args.show]:
            print(f"{(f['person'] or '—')[:19]:<20}"
                  f"{f['position'].split('/')[-1][:19]:<20}{f['local'][:17]:<18}"
                  f"{f['budgeted']:>10,.2f}{f['scale']:>10,.2f}{f['shortfall']:>10,.2f}")
        print("\nEach row names the rate card it was matched against; verify before "
              "acting, since classification matching is approximate.")
    else:
        print("\nNothing below scale among the records that could be matched.")

    if wrong_region:
        have = sorted({c.get("region") for card in rates["cards"]
                       if card.get("trusted") for c in [card] if c.get("region")})
        print(f"\nNo applicable rate card for {region or 'this production'}. "
              f"Cards on hand cover: {', '.join(have) or 'no stated region'}. "
              f"Scale is regional, so nothing is reported rather than comparing "
              f"across regions.")
    if unmatched + no_local > (below + at_or_above):
        print(f"\nCoverage is the limiting factor, not compliance: "
              f"{unmatched + no_local} of {checked} records could not be matched "
              f"to a trusted rate card. More rate cards, and occupation codes in "
              f"the budget, would both raise it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
