#!/usr/bin/env python3
"""
The override layer: what a human corrects after the pipeline has decided.

Inputs are what the system does not know. Overrides are what it *decided* — and
on the reference budget it decides a great deal without being asked: 420 phase
lines whose timing is a guess, 218 inferred rate bases, 31 multipliers rebuilt
arithmetically. Every one of those needs an escape hatch.

Three rules hold this together.

  1. **Reconciliation is sacred.** The whole trust argument is "this sums to the
     budget". So a `redistribute` override may change *when* money lands and
     never how much, and the total is asserted afterwards. Changing an amount is
     an `amend`, which is versioned, carries a reason, and is reported as a
     departure from the budget rather than hidden inside it.

  2. **Key on identity, never on position.** Overrides have to survive re-import
     because the product is the weekly reforecast. Budgets re-version underneath
     you — 30 of 35 departments moved between two versions of this production
     while the total held — so row numbers are useless as keys.

  3. **A correction is not an override.** "The parser got it wrong" is a bug
     report; "I know something no document states" is permanent knowledge. They
     look identical at the moment of editing and diverge completely over time.

Usage:
    from overrides import OverrideSet
    overrides = OverrideSet.load("overrides.json")
    value = overrides.resolve("timing", target, default=computed)
    overrides.report()
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

# Most specific first — the order in which a target's keys are tried.
SCOPES = ("line", "account", "department", "production", "company")

REDISTRIBUTE = "redistribute"   # changes timing; total preserved
AMEND = "amend"                 # changes an amount; total moves

CORRECTION = "correction"       # the parser was wrong — a bug with a repro
JUDGEMENT = "judgement"         # the human knows what no document states


@dataclass
class Override:
    field: str                        # timing | phase | rate_basis | day_cost | ...
    value: Any
    scope: str                        # one of SCOPES
    key: str                          # the identity this applies to
    kind: str = REDISTRIBUTE          # REDISTRIBUTE | AMEND
    origin: str = JUDGEMENT           # CORRECTION | JUDGEMENT
    reason: str | None = None
    author: str | None = None
    created: str | None = None        # ISO date, supplied by the caller

    def matches(self, field: str, keys: dict[str, str]) -> bool:
        return self.field == field and keys.get(self.scope) == self.key


def target_keys(*, department: str | None = None, account: str | None = None,
                sub: str | None = None, person: str | None = None,
                production: str | None = None,
                company: str | None = None) -> dict[str, str]:
    """Identity for a thing an override can attach to, most specific first.

    Degrades deliberately: a line key falls back to its account, then its
    department. A user who says "Camera preps two weeks earlier" should not have
    to repeat themselves for every person in Camera.
    """
    keys: dict[str, str] = {}
    if account and (sub or person):
        keys["line"] = f"{account}|{sub or ''}|{(person or '').strip().upper()}"
    if account:
        keys["account"] = account
    if department:
        keys["department"] = department
    if production:
        keys["production"] = production
    if company:
        keys["company"] = company
    return keys


@dataclass
class OverrideSet:
    overrides: list[Override] = field(default_factory=list)
    applied: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    unused: list[Override] = field(default_factory=list)
    amendments: list[Override] = field(default_factory=list)

    # ---------- loading ------------------------------------------------------

    @classmethod
    def load(cls, path: str | Path | None) -> "OverrideSet":
        if not path or not Path(path).exists():
            return cls()
        payload = json.loads(Path(path).read_text())
        entries = [Override(**{k: v for k, v in item.items()
                               if k in Override.__dataclass_fields__})
                   for item in payload.get("overrides", [])]
        bad = [o for o in entries if o.scope not in SCOPES]
        if bad:
            raise SystemExit(
                f"unknown scope(s): {sorted({o.scope for o in bad})}; "
                f"expected one of {SCOPES}")
        return cls(overrides=entries)

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(
            {"overrides": [asdict(o) for o in self.overrides]}, indent=2))

    # ---------- resolution ---------------------------------------------------

    def resolve(self, field_name: str, keys: dict[str, str], default: Any = None,
                *, allow_amend: bool = False) -> Any:
        """Most specific override wins; otherwise the computed default stands."""
        for scope in SCOPES:
            if scope not in keys:
                continue
            for override in self.overrides:
                if override.scope != scope or not override.matches(field_name, keys):
                    continue
                if override.kind == AMEND and not allow_amend:
                    # An amendment changes an amount, so it cannot be applied
                    # silently inside a redistribution pass.
                    self.amendments.append(override)
                    continue
                self.applied[f"{field_name}@{scope}"] += 1
                return override.value
        return default

    # ---------- integrity ----------------------------------------------------

    def collect_amendments(self) -> list[Override]:
        """Surface every amendment, whether or not a resolver asked for it.

        An amendment changes an amount, so it cannot be applied inside a
        redistribution pass — but it must never be silently dropped either. If
        nothing in the pipeline consults that field, the user has still asked
        for a change and is owed an answer.
        """
        seen = {id(o) for o in self.amendments}
        for override in self.overrides:
            if override.kind == AMEND and id(override) not in seen:
                self.amendments.append(override)
        return self.amendments

    def find_orphans(self, live_keys: set[str]) -> list[Override]:
        """Overrides pointing at something the current budget no longer has.

        Dropping these silently produces a wrong number nobody can see; keeping
        them silently is worse. They are surfaced and left for a human.
        """
        self.unused = [o for o in self.overrides if o.key not in live_keys]
        return self.unused

    @staticmethod
    def assert_total_preserved(before: float, after: float,
                               tolerance: float = 1.0) -> None:
        """Redistribution must not move the total. Fail loudly if it did."""
        if abs(before - after) > tolerance:
            raise SystemExit(
                f"redistribution changed the total by {after - before:,.2f} "
                f"({before:,.2f} -> {after:,.2f}). A redistribute override may "
                f"change when money lands, never how much. Use kind='amend' if "
                f"the amount really is changing.")

    # ---------- reporting ----------------------------------------------------

    def report(self) -> None:
        if not self.overrides:
            print("\nno overrides loaded")
            return
        corrections = sum(1 for o in self.overrides if o.origin == CORRECTION)
        judgements = len(self.overrides) - corrections
        print(f"\noverrides: {len(self.overrides)} loaded · "
              f"{sum(self.applied.values())} applied")
        print(f"   {judgements} judgement (permanent), "
              f"{corrections} correction (parser bug — should trend to zero)")
        for key, count in sorted(self.applied.items(), key=lambda x: -x[1]):
            print(f"   {key:<34}{count:>4}")
        if self.amendments:
            print(f"\n{len(self.amendments)} AMENDMENT(S) — these change amounts, "
                  f"so they are reported and NOT applied. Each needs a versioned "
                  f"budget amendment before it can affect the schedule:")
            for o in self.amendments[:6]:
                print(f"   {o.scope}:{o.key} {o.field} → {o.value}"
                      f"   {o.reason or 'no reason given'}")
        if self.unused:
            print(f"\n{len(self.unused)} ORPHANED — the budget no longer has "
                  f"what these point at:")
            for o in self.unused[:6]:
                print(f"   {o.scope}:{o.key} {o.field}"
                      f"   ({o.author or 'unknown'}, {o.created or 'undated'})")


def example() -> dict[str, Any]:
    """A worked example, which is also the file format."""
    return {
        "overrides": [
            {"field": "prep_lead_weeks", "value": 2, "scope": "department",
             "key": "3300", "kind": REDISTRIBUTE, "origin": JUDGEMENT,
             "reason": "Camera preps two weeks ahead on this show",
             "author": "line producer", "created": "2017-09-05"},
            {"field": "phase_window", "value": "prep", "scope": "account",
             "key": "2519", "kind": REDISTRIBUTE, "origin": JUDGEMENT,
             "reason": "crane wanted a week early for rigging",
             "author": "key grip", "created": "2017-09-12"},
            {"field": "rate_basis", "value": "hour", "scope": "line",
             "key": "3302|*002/\"B\"CAMERAOP|CRAIG BAUER", "kind": REDISTRIBUTE,
             "origin": CORRECTION,
             "reason": "parser read the loaded weekly figure as the rate",
             "author": "accountant", "created": "2017-09-18"},
            {"field": "amount", "value": 42000, "scope": "account",
             "key": "2400", "kind": AMEND, "origin": JUDGEMENT,
             "reason": "set strike re-quoted after the location change",
             "author": "UPM", "created": "2017-10-02"},
        ]
    }


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--example":
        print(json.dumps(example(), indent=2))
    else:
        print(__doc__)
