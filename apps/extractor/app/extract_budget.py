#!/usr/bin/env python3
"""
Extract a Movie Magic style production budget PDF into structured JSON.

The output is the input to cash flow and hot cost generation. Two things this
parser is deliberately careful about, because both are easy to flatten and both
change the money:

  1. Phase-specific cost. A crew member does not cost the same in prep as in
     shoot. The budget states guaranteed units per phase (Prep 10hrs = 55
     units/wk, Shoot 13hrs = 77.5 units/wk) and sometimes a different rate per
     phase as well. Day cost is therefore computed PER PHASE, never once per
     person.

  2. Duration outside the shoot window. Equipment is frequently rented before
     the shoot starts (a crane wanted a week early for prep and setup) or held
     after wrap. Each phase line keeps its own quantity and unit so a spread can
     honour the real rental period instead of snapping to the shoot weeks.

Usage:
    python extract_budget.py BUDGET.pdf -o budget.json
    python extract_budget.py BUDGET.pdf --summary
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import date, datetime
from typing import Any, Iterable

try:
    import pdfplumber
except ImportError:  # pragma: no cover
    sys.exit("pdfplumber is required:  pip install pdfplumber")


# Fallback column boundaries, used only until a page states its own. Movie Magic
# prints a header row — "Acct# Description Amt Units X Rate SubT Total" — on every
# detail page, so the layout is self-describing and these are a last resort. The
# reference film budget puts Amt at x=379; a television budget from the same
# software puts it at x=321, which is exactly why these cannot be fixed.
COL_ACCT_MAX = 55.0     # account codes sit hard left
COL_QTY_MIN = 330.0     # "Amt" column and everything right of it is numeric
COL_UNIT_MIN = 400.0
COL_X_MIN = 432.0
COL_RATE_MIN = 458.0
COL_AMOUNT_MIN = 495.0

# The header labels that mark each numeric column, in print order.
COLUMN_HEADERS = ("Amt", "Units", "X", "Rate", "SubT", "Total")

DAYS_PER_WEEK = 5.0

# Lines that are page furniture rather than budget content.
NOISE = re.compile(
    r"""^(
        Acct\#?Description | Acct\# |
        ContinuationofAccount\d* |
        [A-Z][a-z]{2}\d{1,2},\d{4}\d{2}:\d{2}:\d{2}[AP]M |
        Page\d+
    )""",
    re.VERBOSE,
)

UNIT_WORDS = {"week", "weeks", "day", "days", "hour", "hours", "hr", "hrs",
              "month", "months", "each", "allow", "flat", "fee", "ea"}

PHASE_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^prep", re.I), "prep"),
    (re.compile(r"^(pre-?prod|preprod)", re.I), "prep"),
    (re.compile(r"^(fitting|rehears|test|scout)", re.I), "prep"),
    (re.compile(r"^shoot", re.I), "shoot"),
    (re.compile(r"^(prod|principal)", re.I), "shoot"),
    (re.compile(r"^(wrap|strike)", re.I), "wrap"),
    (re.compile(r"^post", re.I), "post"),
    (re.compile(r"^(hold|hiatus)", re.I), "hold"),
    (re.compile(r"^(travel|airfare|hotel|perdiem|per diem)", re.I), "travel"),
    (re.compile(r"^(unworked|holiday|coa|completion)", re.I), "other"),
]


# Signals that separate a television budget from a feature. Weighted, because no
# single one is decisive — a feature can mention a pilot in a note, and a TV
# budget can carry a feature-style top sheet. Detected rather than asked, since
# the document already knows.
PRODUCTION_TYPE_SIGNALS: list[tuple[re.Pattern[str], str, int, str]] = [
    (re.compile(r"TotalBelow-The-Line(Production|Other)"), "television", 3,
     "splits below-the-line into Production and Other"),
    (re.compile(r"\b(\d{1,2})\s?Eps\b|Episodes?\b", re.I), "television", 3,
     "counts episodes"),
    (re.compile(r"\bPattern\b|\bAmort(iz|is)", re.I), "television", 3,
     "pattern or amortised budget"),
    (re.compile(r"\bPilot\b", re.I), "television", 2, "pilot"),
    (re.compile(r"\bSeason\s?\d|\bEpisodic\b|\bSVOD\b", re.I), "television", 2,
     "season or episodic"),
    (re.compile(r"^5100\b", re.M), "television", 2,
     "editorial at 5100 rather than 4500"),
    (re.compile(r"TOTALPRODUCTIONPERIOD", re.I), "feature", 3,
     "single production-period block"),
    (re.compile(r"^4500\s*EDITORIAL", re.M | re.I), "feature", 2,
     "editorial at 4500"),
    (re.compile(r"TOTALPOSTPRODUCTION", re.I), "feature", 1,
     "discrete post-production block"),
    (re.compile(r"\bTOTALSHOOTDAYS\b", re.I), "feature", 1,
     "states total shoot days"),
]


def detect_production_type(text: str) -> dict[str, Any]:
    """Feature or television, decided from the budget rather than asked.

    The two need different cash flow models — television is episodic with
    pattern and amortised costs and no single shoot block — so the answer
    changes what the generator should do. It is also one fewer question, which
    is always the better trade.
    """
    scores = {"feature": 0, "television": 0}
    evidence: dict[str, list[str]] = {"feature": [], "television": []}
    for pattern, kind, weight, description in PRODUCTION_TYPE_SIGNALS:
        if pattern.search(text):
            scores[kind] += weight
            evidence[kind].append(description)

    total = scores["feature"] + scores["television"]
    if total == 0:
        return {"type": "unknown", "confidence": 0.0, "evidence": [],
                "counter_evidence": []}
    kind = max(scores, key=scores.get)
    other = "feature" if kind == "television" else "television"
    return {
        "type": kind,
        "confidence": round(scores[kind] / total, 2),
        "evidence": evidence[kind],
        "counter_evidence": evidence[other],
    }


def classify_phase(label: str) -> str:
    for pattern, name in PHASE_RULES:
        if pattern.search(label):
            return name
    return "allowance"


# Production vocabulary, longest first, for splitting all-caps runs where a
# case-change heuristic has nothing to work with ("PRODUCTIONSTAFF").
VOCAB = sorted([
    "PRODUCTION", "TRANSPORTATION", "CONSTRUCTION", "ASSISTANT", "ASSISTANTS",
    "SUPERVISOR", "COORDINATOR", "PHOTOGRAPHY", "EQUIPMENT", "OPERATIONS",
    "DEPARTMENT", "ADDITIONAL", "PUBLICITY", "INSURANCE", "MATERIALS",
    "PURCHASES", "EXPENSES", "EXPENSE", "PERSONNEL", "FACILITIES", "EDITORIAL",
    "SPECIAL", "EFFECTS", "PICTURE", "VEHICLES", "ANIMALS", "GENERAL",
    "STUDIO", "RENTALS", "RENTAL", "DRESSING", "PROPERTY", "WARDROBE",
    "LIGHTING", "CAMERA", "SOUND", "STAFF", "TALENT", "EXTRA", "STUNTS",
    "STUNT", "CASTING", "DIRECTORS", "DIRECTOR", "PRODUCERS", "PRODUCER",
    "WRITING", "RIGHTS", "STORY", "CAST", "DESIGN", "STRIKE", "SET",
    "MAKEUP", "MAKE-UP", "HAIR", "GRIP", "ELECTRIC", "LOCATIONS", "LOCATION",
    "STAGE", "TESTS", "TEST", "SECOND", "UNIT", "TITLES", "MUSIC", "POST",
    "VISUAL", "DIGITAL", "LABOR", "LABOUR", "FRINGE", "FRINGES", "TOTAL",
    "SUBTOTAL", "DEPOSITS", "MISC", "OTHER", "FILM", "LAB", "AND", "THE",
], key=len, reverse=True)


def _split_caps(run: str) -> str:
    """Greedy longest-match split of an all-caps run against the vocabulary."""
    words, i = [], 0
    while i < len(run):
        for word in VOCAB:
            if run.startswith(word, i) and len(word) > 2:
                words.append(word)
                i += len(word)
                break
        else:
            if words and not words[-1].isupper() or not words:
                words.append(run[i])
            else:
                words.append(run[i])
            i += 1
    # Re-glue single characters the vocabulary could not place.
    out, buffer = [], ""
    for token in words:
        if len(token) == 1:
            buffer += token
        else:
            if buffer:
                out.append(buffer)
                buffer = ""
            out.append(token)
    if buffer:
        out.append(buffer)
    return " ".join(out)


def respace(text: str) -> str:
    """Movie Magic PDFs drop intra-word spaces. Restore a readable form.

    Cosmetic only — matching and derivation always use the raw string.
    """
    if not text:
        return text
    out = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)
    out = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", out)
    out = re.sub(r"(?<=[.,])(?=[A-Za-z])", " ", out)
    out = re.sub(r"[A-Z]{6,}", lambda m: _split_caps(m.group(0)), out)
    return re.sub(r"\s+", " ", out).strip()


def to_float(token: str | None) -> float | None:
    if token is None:
        return None
    cleaned = token.replace("$", "").replace(",", "").strip()
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    if not re.fullmatch(r"-?\d*\.?\d+", cleaned or ""):
        return None
    return float(cleaned)


def parse_date(token: str) -> str | None:
    # Start dates carry annotations: "09/22/17(NonConsec)", "10/09/17*".
    m = re.match(r"\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", token or "")
    if m:
        token = m.group(1)
    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%m-%d-%y", "%m-%d-%Y"):
        try:
            return datetime.strptime(token, fmt).date().isoformat()
        except ValueError:
            continue
    return None


@dataclass
class PhaseLine:
    """One quantity row beneath a detail record."""
    label: str
    label_display: str
    phase: str
    hours_per_day: float | None
    qty: float | None
    unit: str | None
    multiplier: float | None      # the "X" column: guaranteed units, or headcount
    rate: float | None
    amount: float | None
    # derived
    days: float | None = None
    weekly_cost: float | None = None
    day_cost: float | None = None
    multiplier_recovered: bool = False
    reconciles: bool | None = None

    def _recover_multiplier(self) -> None:
        """Rebuild a multiplier the PDF mangled, and check every row that has one.

        The row states qty, X, rate and amount, so amount = qty * X * rate must
        hold. When a page break truncates the X column ("86...."), that identity
        recovers it exactly; when X parsed fine, the identity is a free per-row
        validation.
        """
        if self.qty in (None, 0) or self.rate in (None, 0) or self.amount is None:
            return
        implied = self.amount / (self.qty * self.rate)
        if self.multiplier is None:
            self.multiplier = round(implied, 4)
            self.multiplier_recovered = True
            self.reconciles = True
            return
        expected = self.qty * self.multiplier * self.rate
        # Movie Magic rounds each printed amount to the dollar.
        self.reconciles = abs(expected - self.amount) <= max(1.5, abs(self.amount) * 0.002)
        if not self.reconciles and abs(implied - round(implied, 2)) < 0.005:
            # The stated multiplier disagrees with the arithmetic; the amount is
            # the figure the top sheet was built from, so trust it.
            self.multiplier = round(implied, 4)
            self.multiplier_recovered = True

    def derive(self) -> None:
        """Per-phase day cost, which is the whole point of keeping phases apart.

        Weeks:  day_cost = (multiplier * rate) / 5
        Days:   day_cost =  multiplier * rate
        Verified against the reference hot cost to the cent for both flat-rate
        and hourly crew, in prep and in shoot.
        """
        self._recover_multiplier()
        if self.qty is None or not self.unit:
            return
        unit = self.unit.lower().rstrip("s")
        if unit == "week":
            self.days = self.qty * DAYS_PER_WEEK
        elif unit == "day":
            self.days = self.qty
        elif unit in ("month",):
            self.days = self.qty * 21.67
        else:
            self.days = None

        if self.multiplier is None or self.rate is None:
            return
        if unit == "week":
            self.weekly_cost = self.multiplier * self.rate
            self.day_cost = self.weekly_cost / DAYS_PER_WEEK
        elif unit == "day":
            self.day_cost = self.multiplier * self.rate
            self.weekly_cost = self.day_cost * DAYS_PER_WEEK


@dataclass
class DetailRecord:
    """A named person or a purchasable thing, with its phase breakdown."""
    sub: str | None = None
    sub_display: str | None = None
    person: str | None = None
    loanout: str | None = None
    rate_raw: str | None = None
    rate_value: float | None = None
    rate_basis: str | None = None       # week | hour | day | flat
    rate_source: str | None = None      # rate_line | scale_line
    scale: str | None = None
    union: str | None = None
    start_date: str | None = None
    notes: list[str] = field(default_factory=list)
    phases: list[PhaseLine] = field(default_factory=list)
    subtotal: float | None = None
    flat_amount: float | None = None    # fringes and lump sums carry no phases

    @property
    def is_labour(self) -> bool:
        return bool(self.person or self.scale or self.union
                    or any(p.hours_per_day for p in self.phases))

    @property
    def is_fringe(self) -> bool:
        text = f"{self.sub or ''} {' '.join(self.notes)}".upper()
        return "FRINGE" in text

    def computed_total(self) -> float:
        """Phase amounts when present; otherwise the stated lump sum.

        Never both — a record whose phases are itemised already reconciles to
        its own subtotal, and adding the subtotal again is the double-count
        that broke the app's department figures.
        """
        if self.phases:
            return sum(p.amount or 0.0 for p in self.phases)
        if self.flat_amount is not None:
            return self.flat_amount
        return self.subtotal or 0.0


@dataclass
class FringeLine:
    """One statutory or union fringe, with the wage base it is charged on.

    Worth keeping separate from wages: fringes are remitted on their own
    calendar, so in a cash flow they belong in a different week from the
    payroll that generated them.
    """
    code: str
    code_display: str
    rate_pct: float | None
    base: float | None
    amount: float | None


@dataclass
class Account:
    acct: str
    name: str
    name_display: str
    page: int | None = None
    details: list[DetailRecord] = field(default_factory=list)
    fringes: list[FringeLine] = field(default_factory=list)
    total: float | None = None
    is_fringe_account: bool = False

    def computed_total(self) -> float:
        if self.fringes:
            return sum(f.amount or 0.0 for f in self.fringes)
        return sum(d.computed_total() for d in self.details)


@dataclass
class TopSheetRow:
    acct: str
    name: str
    name_display: str
    page: int | None
    total: float


class BudgetParser:
    def __init__(self, path: str) -> None:
        self.path = path
        self.accounts: list[Account] = []
        self.topsheet: list[TopSheetRow] = []
        self.production: dict[str, Any] = {}
        self.totals: dict[str, float | None] = {}
        self.department_totals: dict[str, float] = {}
        self.warnings: list[str] = []
        self.columns: dict[str, Any] | None = None
        self.inputs_required: list[dict[str, Any]] = []

    # ---------- line assembly -------------------------------------------------

    def _rows(self) -> Iterable[tuple[int, list[dict[str, Any]]]]:
        """Yield (page_number, words-in-one-visual-row) preserving x positions."""
        with pdfplumber.open(self.path) as pdf:
            for pageno, page in enumerate(pdf.pages, start=1):
                words = page.extract_words(keep_blank_chars=False)
                buckets: dict[float, list[dict[str, Any]]] = {}
                for w in words:
                    key = round(w["top"] / 3.0) * 3.0   # tolerate baseline jitter
                    buckets.setdefault(key, []).append(w)
                for key in sorted(buckets):
                    yield pageno, sorted(buckets[key], key=lambda w: w["x0"])

    # ---------- top sheet -----------------------------------------------------

    def _parse_topsheet_row(self, words: list[dict[str, Any]]) -> None:
        text = "".join(w["text"] for w in words)
        m = re.match(r"^(\d{3,4})(.+?)(\d{1,3})?\$([\d,]+)$", text)
        if m:
            acct, name, page, amount = m.groups()
            self.topsheet.append(TopSheetRow(
                acct=acct, name=name, name_display=respace(name),
                page=int(page) if page else None,
                total=float(amount.replace(",", "")),
            ))
            return
        for label, key in (("TOTALABOVETHELINE", "above_the_line"),
                           ("TotalAbove-The-Line", "above_the_line"),
                           ("TotalBelow-The-Line", "below_the_line"),
                           ("GrandTotal", "grand_total"),
                           ("TotalAboveandBelow-The-Line", "above_and_below")):
            if text.startswith(label):
                value = to_float(text[len(label):])
                if value is not None:
                    self.totals.setdefault(key, value)
                return

    def _parse_production_header(self, words: list[dict[str, Any]]) -> None:
        """The header is two columns; join each side separately or the fields merge."""
        left = "".join(w["text"] for w in words if w["x0"] < 400)
        right = "".join(w["text"] for w in words if w["x0"] >= 400)

        # The show's own name, printed in quotes above everything else, with the
        # company beneath it. Both reference budgets do this. Worth reading:
        # without it a production is filed under its production number, and
        # "M 10.10246" is not what anybody calls the film.
        if "title" not in self.production:
            m = re.match(r'^"(.+?)"$', (left or right).strip())
            if m:
                self.production["title"] = respace(m.group(1))
                return
        elif "company" not in self.production:
            candidate = (left or "").strip()
            # A company line carries no field label and no figures; anything
            # with a colon or a digit is a header field or a top sheet row.
            if candidate and not re.search(r"[:\d]", candidate):
                self.production["company"] = respace(candidate)
                return

        for side in (left, right):
            if side:
                self._match_header_fields(side)

    def _match_header_fields(self, text: str) -> None:
        pairs = [
            (r"PRODUCTIONNUMBER:(\S+)", "production_number"),
            (r"TOTALSHOOTDAYS:(\d+)days", "shoot_days"),
            (r"PRODUCER\(S\):(.+)", "producers"),
            (r"EXECPRODUCER:(.+)", "executive_producer"),
            (r"DIRECTOR:(.+)", "director"),
            (r"STARTPRODUCTION:(.+)", "start_production"),
            (r"FINISHPRODUCTION:(.+)", "finish_production"),
            (r"POSTSCHEDULE\(([^)]*)\):(\d+)wks", "post_weeks"),
            (r"BUDGETDATE:(\S+)", "budget_date"),
            (r"PREPAREDBY:(.+)", "prepared_by"),
            (r"SCRIPT:(.+)", "script"),
        ]
        for pattern, key in pairs:
            m = re.search(pattern, text)
            if not m:
                continue
            value = m.groups()[-1]
            if key == "shoot_days":
                self.production[key] = int(value)
            elif key == "post_weeks":
                self.production[key] = int(value)
                self.production["post_location"] = respace(m.group(1))
            elif key in ("start_production", "finish_production"):
                self.production[key] = respace(value)
            elif key == "budget_date":
                self.production[key] = parse_date(value) or value
            else:
                self.production[key] = respace(value)

    # ---------- detail pages --------------------------------------------------

    def _detect_type(self) -> None:
        """Read enough of the document to tell a feature from a television budget."""
        import pdfplumber as _pp
        with _pp.open(self.path) as pdf:
            sample = "\n".join((p.extract_text() or "") for p in pdf.pages[:6])
        self.production_type = detect_production_type(sample)

    def _adopt_column_layout(self, words: list[dict[str, Any]]) -> bool:
        """Learn this template's column boundaries from its own header row.

        Movie Magic reprints "Acct# Description Amt Units X Rate SubT Total" on
        every detail page. Reading the x-position of each label makes the parser
        independent of the template, which matters because the same software
        lays a television budget out 50 points to the left of a feature.
        """
        centres = {w["text"]: (w["x0"] + w["x1"]) / 2 for w in words}
        if not all(label in centres for label in ("Amt", "Units", "Rate")):
            return False
        present = [label for label in COLUMN_HEADERS if label in centres]
        if len(present) < 4:
            return False
        self.columns = {
            "centres": [(label, centres[label]) for label in present],
            "qty_min": centres[present[0]] - 34.0,
        }
        return True

    def _split_columns(self, words: list[dict[str, Any]]) -> tuple[str, list[str | None]]:
        """Return (left-hand label, [qty, unit, x, rate, amount])."""
        layout = getattr(self, "columns", None)
        if layout:
            # Headers print left-aligned while figures print right-aligned, so a
            # value's x0 can sit either side of its own column label. Assigning
            # each value to the nearest header centre survives that; hard
            # boundaries do not.
            centres, qty_min = layout["centres"], layout["qty_min"]
            label_parts: list[str] = []
            slots: dict[str, str] = {}
            for w in words:
                text = w["text"]
                if w["x0"] < qty_min:
                    label_parts.append(text)
                    continue
                middle = (w["x0"] + w["x1"]) / 2
                nearest = min(centres, key=lambda c: abs(c[1] - middle))[0]
                slots[nearest] = text
            # SubT and Total are alternative homes for the same figure.
            amount = slots.get("Total") or slots.get("SubT")
            return "".join(label_parts), [slots.get("Amt"), slots.get("Units"),
                                          slots.get("X"), slots.get("Rate"), amount]

        label_parts, qty, unit, mult, rate, amount = [], None, None, None, None, None
        for w in words:
            x, text = w["x0"], w["text"]
            if x < COL_QTY_MIN:
                label_parts.append(text)
            elif x < COL_UNIT_MIN:
                qty = text
            elif x < COL_X_MIN:
                unit = text
            elif x < COL_RATE_MIN:
                mult = text
            elif x < COL_AMOUNT_MIN:
                rate = text
            else:
                amount = text
        return "".join(label_parts), [qty, unit, mult, rate, amount]

    @staticmethod
    def _parse_fringe_row(words: list[dict[str, Any]]) -> FringeLine | None:
        """e.g.  1FICA1 | 6.2% | 110,731.54 | 6,865   ->  FICA at 6.2% on the base."""
        if not words:
            return None
        # The code runs up to the rate. Templates differ on whether the fringe's
        # sequence number is glued to its name ("1FICA1") or printed as its own
        # word ("1 FICA 1"), so split on the rate rather than on the first word.
        pct_at = next((i for i, w in enumerate(words)
                       if w["text"].endswith("%")), None)
        if pct_at is not None:
            code_words, rest = words[:pct_at], words[pct_at:]
        else:
            # A flat fringe states units instead of a rate ("ASA NON-MARYLAND
            # 114 Days 58,482"). Fall back to the first number.
            num_at = next((i for i, w in enumerate(words)
                           if i and to_float(w["text"]) is not None), None)
            if num_at is None:
                return None
            code_words, rest = words[:num_at], words[num_at:]
        code = "".join(w["text"] for w in code_words)
        if not re.match(r"^\d*[A-Z]", code):
            return None
        rate = None
        numbers: list[float] = []
        for w in rest:
            text = w["text"]
            if text.endswith("%"):
                rate = to_float(text[:-1])
                continue
            if text.startswith("$"):     # the department total, handled separately
                continue
            value = to_float(text)
            if value is not None:
                numbers.append(value)
        if rate is None and len(numbers) < 2:
            return None
        base = numbers[0] if len(numbers) >= 2 else None
        amount = numbers[-1] if numbers else None
        return FringeLine(code=code, code_display=respace(code),
                          rate_pct=rate, base=base, amount=amount)

    def _attach_attribute(self, rec: DetailRecord, text: str) -> bool:
        if text.startswith("Name:"):
            rec.person = respace(text[5:]) or None
            return True
        if text.startswith("Loanout:"):
            rec.loanout = respace(text[8:])
            return True
        if text.upper().startswith("RATE"):
            rec.rate_raw = text.split(":", 1)[1].strip() if ":" in text else text
            amounts = [to_float(a) for a in re.findall(r"\$([\d,]+(?:\.\d+)?)", text)]
            amounts = [a for a in amounts if a is not None]
            if amounts:
                # "A+B=C" states the loaded rate as C; "A+B/hr" means A+B.
                rec.rate_value = amounts[-1] if "=" in text else (
                    sum(amounts) if len(amounts) > 1 else amounts[0])
            low = text.lower()
            rec.rate_source = "rate_line"
            rec.rate_basis = ("hour" if "/hr" in low or "hour" in low else
                              "week" if "/wk" in low or "week" in low else
                              "day" if "/day" in low else None)
            return True
        m = re.match(r"^(?:L\.A\.|Local|Distant)?Hire-?StartDate:?(\S+)?", text)
        if m and "StartDate" in text:
            token = m.group(1)
            if token:
                rec.start_date = parse_date(token) or token
            return True
        if re.search(r"(Local\d+|DGA|SAG|AFTRA|IATSE|Teamster|Scale|Tier)", text):
            rec.scale = respace(text)
            u = re.search(r"(Local\s?\d+|DGA|SAG-?AFTRA|SAG|IATSE|Teamsters?)", text)
            if u:
                rec.union = u.group(1)
            # A rate written as "Key Scale" or "2nd Scale" names the scale rather
            # than stating a number; the number is on this line. Take it, and
            # record that it came from the scale so the provenance is visible.
            if rec.rate_value is None:
                scale_rate = re.search(r"Scale:?\s?\$([\d,]+(?:\.\d+)?)", text)
                if scale_rate:
                    rec.rate_value = to_float(scale_rate.group(1))
                    rec.rate_source = "scale_line"
                    low = text.lower()
                    rec.rate_basis = ("hour" if "/hr" in low else
                                      "week" if "/wk" in low else rec.rate_basis)
            return True
        return False

    def parse(self) -> None:
        self._detect_type()
        current_account: Account | None = None
        current_detail: DetailRecord | None = None
        in_topsheet = True

        for pageno, words in self._rows():
            joined = "".join(w["text"] for w in words)
            # The column header both marks page furniture and states the layout.
            if joined.startswith(("Acct#Description", "Acct#")):
                # The detail header states the money columns; the top sheet's
                # does not. Adopting a layout is therefore the moment the top
                # sheet ends — not the end of page 1, which only held because
                # the first budget seen had a top sheet that fitted on one page.
                if self._adopt_column_layout(words):
                    in_topsheet = False
                continue
            if not joined or NOISE.match(joined):
                continue

            if in_topsheet:
                self._parse_production_header(words)
                self._parse_topsheet_row(words)
                continue

            # "AccountTotalfor1100 $239,411" — the department roll-up, authoritative.
            m = re.match(r"^AccountTotalfor(\d{3,4})\$?([\d,]+)$", joined)
            if m:
                self.department_totals[m.group(1)] = float(m.group(2).replace(",", ""))
                continue

            # The closing summary block belongs to the document, not to whichever
            # account happened to be open when we reached it.
            m = re.match(r"^(TotalAbove-The-Line|TotalBelow-The-Line|"
                         r"TotalAboveandBelow-The-Line|GrandTotal)\$?([\d,]+)$", joined)
            if m:
                key = {"TotalAbove-The-Line": "above_the_line",
                       "TotalBelow-The-Line": "below_the_line",
                       "TotalAboveandBelow-The-Line": "above_and_below",
                       "GrandTotal": "grand_total"}[m.group(1)]
                self.totals[key] = float(m.group(2).replace(",", ""))
                current_account = None
                current_detail = None
                continue

            label, (qty, unit, mult, rate, amount) = self._split_columns(words)

            # An account header: code hard left, description beside it.
            first = words[0]
            if (first["x0"] < COL_ACCT_MAX
                    and re.fullmatch(r"\d{3,4}", first["text"])
                    and len(words) > 1):
                rest = "".join(w["text"] for w in words[1:])
                zero = re.match(r"^(.*?)\$?([\d,]+)$", rest)
                name = rest
                total = None
                if zero:
                    name, total = zero.group(1), to_float(zero.group(2))
                current_account = Account(
                    acct=first["text"], name=name, name_display=respace(name),
                    page=pageno, total=total,
                    is_fringe_account=bool(re.match(r"^Total\s?Fringes?$", name, re.I)),
                )
                self.accounts.append(current_account)
                current_detail = None
                continue

            if current_account is None:
                continue

            # Inside a "Total Fringes" block: code, rate %, wage base, amount,
            # and on the final row the department's fringe total.
            if current_account.is_fringe_account:
                fringe = self._parse_fringe_row(words)
                if fringe:
                    current_account.fringes.append(fringe)
                    trailing = [to_float(w["text"]) for w in words
                                if w["x0"] >= 535 and w["text"].startswith("$")]
                    if trailing and trailing[-1] is not None:
                        current_account.total = trailing[-1]
                    continue

            # A detail record header, e.g. "*001/UPM".
            if label.startswith("*"):
                current_detail = DetailRecord(sub=label, sub_display=respace(label))
                current_account.details.append(current_detail)
                continue

            if current_detail is None:
                current_detail = DetailRecord()
                current_account.details.append(current_detail)

            # "Subtotal" closes a detail record; "Total" closes the account.
            # Conflating them is what produces a doubled department figure.
            if label.startswith("Subtotal"):
                current_detail.subtotal = to_float(amount) or to_float(
                    label.split("$")[-1])
                continue
            if label.startswith("Total"):
                value = to_float(amount) or to_float(label.split("$")[-1])
                if value is not None:
                    current_account.total = value
                    # Fringes and lump sums state their amount here and carry no
                    # phase lines, so record it on the detail for spreading.
                    if not current_detail.phases and current_detail.subtotal is None:
                        current_detail.flat_amount = value
                continue

            if self._attach_attribute(current_detail, label):
                continue

            # A page break can fuse the unit and multiplier columns into one
            # token ("Weeks86.25"), which would otherwise drop the whole row.
            if unit and unit.lower().rstrip("s") not in UNIT_WORDS:
                fused = re.match(r"^([A-Za-z]+)([\d,.]+)$", unit)
                if fused and fused.group(1).lower().rstrip("s") in UNIT_WORDS:
                    unit = fused.group(1)
                    if mult is None:
                        mult = fused.group(2).rstrip(".")

            qty_v = to_float(qty)
            if qty_v is None or not unit or unit.lower().rstrip("s") not in UNIT_WORDS:
                if label and not any(ch.isdigit() for ch in label[:3]):
                    current_detail.notes.append(respace(label))
                continue

            hours = None
            hm = re.search(r"\((\d+(?:\.\d+)?)hrs?\)", label)
            if hm:
                hours = float(hm.group(1))
            clean_label = re.sub(r"\([^)]*\)", "", label).strip() or label

            phase = PhaseLine(
                label=label,
                label_display=respace(clean_label),
                phase=classify_phase(clean_label),
                hours_per_day=hours,
                qty=qty_v,
                unit=unit,
                multiplier=to_float(mult),
                rate=to_float(rate),
                amount=to_float(amount),
            )
            phase.derive()
            current_detail.phases.append(phase)

        self._infer_rate_bases()
        self._validate()

    @staticmethod
    def _backfill_rate_from_phases(detail: DetailRecord) -> None:
        """Take the rate from the phase rows when the RATE line is a reference.

        A budget states rates two ways: as a number ("$3,500/wk") or by pointing
        at another line ("Key Scale", "2nd Scale", "Key + $1"). The second kind
        cannot be read on its own — but every phase row underneath already
        carries the resolved numeric rate the budget actually used. So the
        reference never needs resolving; it only needs reading one line lower.

        The stated form is preserved in rate_raw for provenance.
        """
        rates = {p.rate for p in detail.phases if p.rate}
        if not rates:
            return
        # A single rate across phases is unambiguous. Where phases differ (a
        # lower prep rate, say), the working rate is the one used in shoot.
        if len(rates) == 1:
            resolved = next(iter(rates))
        else:
            shoot = [p.rate for p in detail.phases
                     if p.phase == "shoot" and p.rate]
            resolved = max(shoot) if shoot else max(rates)

        stated = detail.rate_value
        if stated is None or (detail.rate_source != "rate_line"
                              and abs(stated - resolved) > 0.01) or (
                detail.rate_source == "rate_line" and stated < resolved * 0.5):
            # "Key+$1" parses to 1.0, which is a reference fragment, not a rate.
            detail.rate_value = resolved
            detail.rate_source = "phase_rows"
            if detail.rate_basis is None:
                multipliers = [p.multiplier for p in detail.phases
                               if p.multiplier is not None]
                detail.rate_basis = ("hour" if multipliers and max(multipliers) > 1
                                     else "week")

    def _infer_rate_bases(self) -> None:
        """Fill in a missing rate basis from how the phase lines are quantified.

        A rate written as "IN: $4,370 + $948 = $5,318" never says "per week",
        but its phase lines are quantified in Weeks with a multiplier of 1 —
        which makes it weekly. Hourly lines carry a multiplier of many units.
        """
        for account in self.accounts:
            for detail in account.details:
                self._backfill_rate_from_phases(detail)
                if detail.rate_basis or detail.rate_value is None:
                    continue
                units = {(p.unit or "").lower().rstrip("s") for p in detail.phases}
                multipliers = [p.multiplier for p in detail.phases
                               if p.multiplier is not None]
                if "week" in units and multipliers and max(multipliers) <= 1.0:
                    detail.rate_basis = "week"
                elif "week" in units and multipliers and max(multipliers) > 1.0:
                    detail.rate_basis = "hour"
                elif "day" in units:
                    detail.rate_basis = "day"

    # ---------- validation ----------------------------------------------------

    def department_rollup(self) -> dict[str, float]:
        """Sum accounts into their department (1101, 1102 -> 1100).

        Uses each account's own stated Total, which is the figure Movie Magic
        prints and the one the top sheet is built from. Phase amounts are for
        shaping the spread, not for totalling.
        """
        rollup: dict[str, float] = {}
        for a in self.accounts:
            if a.acct.endswith("00") and not a.details:
                continue  # department header row, not a spendable account
            rollup.setdefault(a.acct[:2] + "00", 0.0)
            rollup[a.acct[:2] + "00"] += a.total if a.total is not None else \
                a.computed_total()
        return rollup

    def _validate(self) -> None:
        rollup = self.department_rollup()
        # Rows the detail pages do not account for. Movie Magic prints a
        # percentage-derived line ("INSURANCE :1.3%") on the top sheet and
        # nowhere else, so this money is real, has no detail to spread from,
        # and needs a payment schedule from someone who knows the policy.
        self.unbacked_rows: list[dict[str, Any]] = []
        # A department can occupy more than one top sheet row, so compare the
        # rollup against their sum rather than against whichever row came first.
        stated_by_acct: dict[str, float] = {}
        rows_by_acct: dict[str, list[TopSheetRow]] = {}
        for row in self.topsheet:
            stated_by_acct[row.acct] = stated_by_acct.get(row.acct, 0.0) + row.total
            rows_by_acct.setdefault(row.acct, []).append(row)
        for acct, stated in stated_by_acct.items():
            computed = rollup.get(acct, 0.0)
            if stated - computed <= max(2.0, stated * 0.005):
                continue
            rows = rows_by_acct[acct]
            pct = [r for r in rows if re.search(r"\d+(\.\d+)?\s*%", r.name)]
            self.unbacked_rows.append({
                "acct": acct,
                "name_display": (pct[0] if pct else rows[0]).name_display,
                "amount": round(stated - computed, 2),
                "states_percentage": bool(pct),
            })
        for acct, stated in stated_by_acct.items():
            computed = rollup.get(acct, 0.0)
            row = rows_by_acct[acct][0]
            tolerance = max(2.0, stated * 0.005)
            if abs(computed - stated) > tolerance:
                self.warnings.append(
                    f"department {row.acct} ({row.name_display}): extracted detail "
                    f"sums to {computed:,.0f} against a top sheet {stated:,.0f} "
                    f"(off by {computed - row.total:,.0f})")

        top_total = sum(r.total for r in self.topsheet)
        grand = self.totals.get("grand_total")
        if grand and abs(top_total - grand) > 2:
            self.warnings.append(
                f"top sheet rows sum to {top_total:,.0f} against a stated grand "
                f"total of {grand:,.0f}")
        self.totals["topsheet_sum"] = top_total
        self.totals["detail_sum"] = round(sum(rollup.values()), 2)
        if grand:
            self.totals["extraction_coverage"] = round(
                self.totals["detail_sum"] / grand, 4)

        self._collect_inputs_required()

    def _collect_inputs_required(self) -> None:
        """Emit the questions a human must answer, and nothing more.

        The aim is not to eliminate human input — it is to make the ask small,
        specific and answerable, so nobody is handed a 545-line grid to check.
        """
        def ask(key: str, question: str, why: str, **extra: Any) -> None:
            self.inputs_required.append(
                {"key": key, "question": question, "why": why, **extra})

        # 1. Calendar. Mostly prefillable from the budget header.
        ask("calendar",
            "Confirm shoot start, shoot days, and the prep / wrap / post week counts.",
            "Phase quantities in the budget are durations, not dates. They need a "
            "calendar before they become weeks in a cash flow.",
            prefill={
                "shoot_start": self.production.get("start_production"),
                "shoot_finish": self.production.get("finish_production"),
                "shoot_days": self.production.get("shoot_days"),
                "post_weeks": self.production.get("post_weeks"),
            })

        # 2. Cash timing. Not derivable from a budget at all.
        ask("payment_timing",
            "Payroll lag in days, default vendor terms, and what is paid up front.",
            "The budget states when cost is incurred. Cash leaves on different "
            "dates, and only you know the terms.",
            prefill={"payroll_lag_days": None, "vendor_terms": "net30",
                     "prepaid": ["insurance premium", "bond fee", "deposits"],
                     # Measured: moving payroll lag alone from 7 to 21 days took
                     # correlation with a real cash flow from 0.901 to 0.957 on
                     # one production and left another unchanged. It is the
                     # single highest-leverage answer here, and it is per-show.
                     "departments": {}},
            departments_available=[{"acct": r.acct, "name": r.name_display}
                                   for r in self.topsheet])

        # 2b. Money the top sheet states but no detail page carries. Nothing in
        # the document says when it is paid, and on a real budget it is not small.
        unbacked = getattr(self, "unbacked_rows", [])
        if unbacked:
            total = sum(r["amount"] for r in unbacked)
            ask("unbacked_lines",
                f"Give a payment schedule for {len(unbacked)} top sheet "
                f"line(s) totalling {total:,.0f} that have no detail behind them.",
                "These are stated as a percentage or a lump on the top sheet, so "
                "the budget carries no phase, duration or date for them. Without a "
                "schedule they can only be spread by department archetype, which "
                "for an insurance premium or a bond fee is certainly wrong.",
                amount_at_stake=round(total, 2),
                lines=unbacked,
                answer_format={
                    "acct": "6700",
                    "instalments": [{"pay_on": "YYYY-MM-DD", "share": 0.5}],
                })

        # 2c. Payments the budget prices but triggers rather than dates. These
        # drive the largest single timing error measured against a real cash flow.
        triggers = []
        for a in self.accounts:
            for d in a.details:
                for phase in d.phases:
                    label = phase.label_display or ""
                    if re.search(r"bonus|deliver|commenc|principal photog|release|"
                                 r"payable|milestone", label, re.I) and phase.amount:
                        triggers.append({
                            "acct": a.acct,
                            "account_name": a.name_display,
                            "person": d.person,
                            "description": label,
                            "amount": phase.amount,
                        })
        if triggers:
            triggers.sort(key=lambda t: -(t["amount"] or 0))
            total = sum(t["amount"] or 0 for t in triggers)
            ask("milestone_payments",
                f"Date {len(triggers)} payment(s) totalling {total:,.0f} that the "
                "budget ties to an event rather than a week.",
                "A bonus payable on delivery, or a fee on commencement, is priced "
                "by the budget but not scheduled by it. Spread across the shoot it "
                "lands months early — this was the largest timing error found "
                "against a real production's cash flow.",
                amount_at_stake=round(total, 2),
                count=len(triggers),
                examples=triggers[:25],
                answer_format={"acct": "1101", "description": "Sole Credit Bonus",
                               "pay_on": "YYYY-MM-DD"})

        # 2d. A production already under way has spent money the grid must not
        # re-forecast. The budget marks these lines but cannot date the cut-off.
        ctd_hits = sum(1 for a in self.accounts for d in a.details
                       if re.search(r"\bCTD\b", " ".join(
                           [d.sub_display or ""] + list(d.notes)
                           + [p.label_display or "" for p in d.phases])))
        if ctd_hits:
            ask("cost_to_date",
                "State the cost-to-date cut-off week and amount, if this "
                "production has already started spending.",
                "The budget carries CTD markers, so some of this money is already "
                "out of the door. Forecasting it again double-counts the front of "
                "the schedule.",
                ctd_marked_records=ctd_hits,
                answer_format={"as_of": "YYYY-MM-DD", "amount": 0})

        # 3. Funding. Required for a net position.
        ask("funding",
            "Funding sources and expected draw dates, including when the tax "
            "incentive realistically lands.",
            "Without inflows there is no weekly net position, and the net "
            "position is the point of a cash flow.")

        # 4. Missing financing lines — verified absent, not assumed.
        missing = [name for name, pattern in
                   (("contingency", r"contingenc"),
                    ("completion bond fee", r"completion|bond"),
                    ("financing / interest", r"financ|interest"))
                   if not any(re.search(pattern, r.name, re.I) for r in self.topsheet)]
        if missing:
            ask("financing_lines",
                f"Provide {', '.join(missing)} — absent from this budget.",
                "A schedule built from direct costs alone understates the "
                "financing ask. Contingency is customarily 10% and a bond fee "
                "2–3% of the total.",
                missing=missing,
                direct_cost_total=self.totals.get("grand_total"))

        # 5. Rates the budget states by reference rather than by value.
        unresolved = []
        for a in self.accounts:
            for d in a.details:
                if d.rate_raw and d.rate_value is None:
                    unresolved.append({
                        "acct": a.acct,
                        "person": d.person,
                        "position": d.sub_display,
                        "rate_as_written": d.rate_raw,
                    })
        if unresolved:
            ask("relative_rates",
                f"Resolve {len(unresolved)} rates stated by reference "
                f"(e.g. 'Key Scale', 'Key + $1').",
                "These point at another line rather than stating a number. "
                "Resolving them is the one part of rate extraction that needs "
                "judgement.",
                count=len(unresolved), examples=unresolved[:10])

        # 6. Anything that failed to reconcile is a question, not a silent gap.
        unreconciled = [w for w in self.warnings if w.startswith("department")]
        if unreconciled:
            ask("unreconciled_departments",
                f"Review {len(unreconciled)} departments where the extracted "
                f"detail does not match the top sheet.",
                "Every dollar must be placed before a schedule can be trusted. "
                "These are the only lines needing a human eye.",
                count=len(unreconciled), detail=unreconciled[:15])

    # ---------- output --------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": {"file": self.path, "parser_version": "budget-extract-1.0"},
            "production": {**self.production,
                           "production_type": getattr(self, "production_type", None)},
            "totals": self.totals,
            "department_totals": self.department_totals,
            "department_rollup": {k: round(v, 2)
                                  for k, v in sorted(self.department_rollup().items())},
            "inputs_required": self.inputs_required,
            "topsheet": [asdict(r) for r in self.topsheet],
            "accounts": [
                {
                    "acct": a.acct,
                    "name": a.name,
                    "name_display": a.name_display,
                    "page": a.page,
                    "total": a.total,
                    "computed_total": round(a.computed_total(), 2),
                    "is_fringe_account": a.is_fringe_account,
                    "fringes": [asdict(f) for f in a.fringes],
                    "details": [
                        {
                            **{k: v for k, v in asdict(d).items() if k != "phases"},
                            "is_labour": d.is_labour,
                            "phases": [asdict(p) for p in d.phases],
                        }
                        for d in a.details
                    ],
                }
                for a in self.accounts
            ],
            "warnings": self.warnings,
        }


# ---------- reporting ---------------------------------------------------------

def print_summary(data: dict[str, Any]) -> None:
    prod = data["production"]
    detected = prod.get("production_type") or {}
    if detected:
        print(f"\ndetected: {detected.get('type', '?').upper()}  "
              f"(confidence {detected.get('confidence', 0):.0%})")
        for reason in detected.get("evidence", [])[:4]:
            print(f"   + {reason}")
        for reason in detected.get("counter_evidence", [])[:2]:
            print(f"   - {reason}")
    print(f"\n{prod.get('production_number', '—')}  "
          f"{prod.get('shoot_days', '?')} shoot days  ·  "
          f"post {prod.get('post_weeks', '?')} wks  ·  "
          f"budget dated {prod.get('budget_date', '—')}")
    print(f"start {prod.get('start_production', '—')}   "
          f"finish {prod.get('finish_production', '—')}")

    t = data["totals"]
    print(f"\n{'grand total (stated)':<32}{t.get('grand_total') or 0:>14,.0f}")
    print(f"{'top sheet rows sum':<32}{t.get('topsheet_sum') or 0:>14,.0f}")
    print(f"{'detail lines sum':<32}{t.get('detail_sum') or 0:>14,.0f}")

    accounts = data["accounts"]
    details = [d for a in accounts for d in a["details"]]
    phases = [p for d in details for p in d["phases"]]
    labour = [d for d in details if d["is_labour"]]
    print(f"\n{len(accounts)} accounts · {len(details)} detail records "
          f"({len(labour)} labour) · {len(phases)} phase lines")

    counts: dict[str, int] = {}
    for p in phases:
        counts[p["phase"]] = counts.get(p["phase"], 0) + 1
    print("phase mix: " + "  ".join(f"{k}={v}" for k, v in
                                    sorted(counts.items(), key=lambda x: -x[1])))

    # The two things that must not be flattened.
    multi = [d for d in labour
             if len({round(p["day_cost"], 2) for p in d["phases"]
                     if p["day_cost"]}) > 1]
    print(f"\nlabour records whose day cost CHANGES between phases: "
          f"{len(multi)} of {len(labour)}")
    for d in multi[:6]:
        name = d["person"] or d["sub_display"] or "—"
        bits = "  ".join(
            f"{p['phase']}={p['day_cost']:,.2f}"
            for p in d["phases"] if p["day_cost"])
        print(f"   {name[:26]:<28}{bits}")

    outside = [(d, p) for d in details for p in d["phases"]
               if p["phase"] not in ("shoot",) and p["days"] and p["days"] > 25
               and not d["is_labour"]]
    print(f"\nnon-labour phase lines running beyond a 25-day shoot: {len(outside)}")
    for d, p in sorted(outside, key=lambda x: -(x[1]["amount"] or 0))[:6]:
        print(f"   {p['label_display'][:30]:<32}{p['qty']:>6g} {p['unit']:<7}"
              f"{p['amount'] or 0:>11,.0f}")

    if data["warnings"]:
        print(f"\nwarnings ({len(data['warnings'])}):")
        for w in data["warnings"][:12]:
            print(f"   · {w}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", help="budget PDF")
    ap.add_argument("-o", "--out", help="write JSON here")
    ap.add_argument("--summary", action="store_true", help="print a summary")
    args = ap.parse_args(argv)

    parser = BudgetParser(args.pdf)
    parser.parse()
    data = parser.to_dict()

    if args.out:
        with open(args.out, "w") as fh:
            json.dump(data, fh, indent=2)
        print(f"wrote {args.out}", file=sys.stderr)
    elif not args.summary:
        json.dump(data, sys.stdout, indent=2)

    if args.summary:
        print_summary(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
