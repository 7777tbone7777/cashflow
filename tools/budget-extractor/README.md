# Budget extractor

Turns a Movie Magic style production budget PDF into structured JSON — the input
for cash flow and hot cost generation.

```bash
pip install pdfplumber xlrd

python extract_budget.py "LOCKED-The Children 25 Day Los Angeles Tier 1.pdf" \
    -o budget.json --summary

python verify_against_hotcost.py budget.json "HOT COST TEMPLATE-THE CHILDREN.xls"
```

## Results on the reference budget

| Check | Result |
|---|---|
| Grand total stated | $6,062,000 |
| Top sheet rows sum | $6,062,000 |
| Extracted detail sum | **$6,062,000** |
| Departments reconciling | **34 of 34** |
| Records | 582 accounts · 443 details (141 labour) · 979 phase lines |
| Per-row arithmetic (`amount = qty × X × rate`) | 925 / 946 rows |

Cross-checked against the hot cost the production accountant actually produced:

| Derivation | Match |
|---|---|
| Daily rate | **28 / 29 (97%)** |
| **Prep** day cost | 22 / 28 (79%) — residual is a real scheduling call, see below |
| **Shoot** day cost | **25 / 27 (93%)** |

## Two things it refuses to flatten

**1. Cost is phase-specific.** A crew member does not cost the same in prep as in
shoot. The budget states guaranteed units per phase, and sometimes a different
rate per phase as well:

```
Craig Bauer, "B" Camera Op, $35 + $10/hr
  Prep (10hrs)   0.4 Weeks   55 units @ 45.00   ->  495.00 / day
  Shoot (12hrs)  4.6 Weeks   70 units @ 45.00   ->  630.00 / day
```

Both figures appear in the real hot cost, on the preshoot sheet and on a shoot
sheet respectively. 71 of 141 labour records have a day cost that changes between
phases, and 33 of 56 crew differ between the preshoot and shoot sheets — typically
by 41%. A single "budgeted day" per person is wrong.

The rule is uniform:

```
unit = Weeks :  day_cost = (multiplier × rate) / 5
unit = Days  :  day_cost =  multiplier × rate
```

**2. Duration is not the shoot window.** Equipment is routinely rented before the
shoot starts — a crane wanted a week early for prep and setup — or held past wrap.
In the reference budget, 80 non-labour phase lines run beyond the 25-day shoot and
another 88 run shorter. Each phase line keeps its own `qty` and `unit` so a spread
can honour the real rental period instead of snapping to shoot weeks.

## Fringes

Fringes are extracted as their own itemised schedule per department, with the wage
base each is charged on:

```json
{ "code": "7LAIAPHW", "rate_pct": 32.5, "base": 126710.54, "amount": 41181 }
```

They are kept separate from wages deliberately — fringes remit on their own
calendar, so in a cash flow they belong in a different week from the payroll that
generated them.

## What it asks a human

The extractor does not guess at things a budget cannot know. It emits an
`inputs_required` manifest — specific, prefilled where possible, and short:

| Key | Ask |
|---|---|
| `calendar` | Confirm shoot start, shoot days, prep/wrap/post weeks *(prefilled from the budget header)* |
| `payment_timing` | Payroll lag, default vendor terms, what is prepaid |
| `funding` | Funding sources and draw dates, including when the incentive lands |
| `financing_lines` | Contingency, bond fee, financing — verified absent from this budget |
| `relative_rates` | Rates stated by reference (`Key Scale`, `Key + $1`) |
| `unreconciled_departments` | Any department whose detail does not tie to the top sheet |

The last two are empty when the budget parses cleanly, as the reference one does.

## Output shape

```jsonc
{
  "production":  { "shoot_days": 25, "post_weeks": 16, "budget_date": "2017-10-13", ... },
  "totals":      { "grand_total": 6062000, "detail_sum": 6062000, "extraction_coverage": 1.0 },
  "department_totals": { "1100": 239411, ... },   // from AccountTotalfor lines
  "department_rollup": { "1100": 239411, ... },   // computed, for validation
  "inputs_required": [ ... ],
  "topsheet":    [ { "acct": "1100", "name_display": "STORY, RIGHTS & WRITING", "total": 239411 } ],
  "accounts": [{
    "acct": "2001", "name_display": "PRODUCTION MANAGER", "total": 55506,
    "fringes": [],
    "details": [{
      "person": "Carrie Morrow",
      "rate_raw": "IN:$4,370+$948=$5,318", "rate_value": 5318, "rate_basis": "week",
      "scale": "DGA Level 4b Scale 7/1/17 to 6/30/18", "union": "DGA",
      "start_date": "2017-09-18",
      "is_labour": true,
      "phases": [{
        "label_display": "Prep", "phase": "prep", "hours_per_day": null,
        "qty": 4, "unit": "Weeks", "multiplier": 1, "rate": 4370, "amount": 17480,
        "days": 20, "weekly_cost": 4370, "day_cost": 874
      }]
    }]
  }]
}
```

## Known limits

- **PDF is lossy.** Movie Magic drops intra-word spaces, and page breaks can split a
  record from its rate line. Prefer a Movie Magic export if one can be obtained;
  this parser exists because a PDF is what was available.
- **Relative rates turned out not to need resolving.** `Key Scale`, `Key + $1` name
  another line rather than stating a number — but every phase row underneath already
  carries the resolved numeric rate the budget used. The reference is read one line
  lower rather than chased (`rate_source: "phase_rows"`), and the stated form is kept
  in `rate_raw` for provenance. This removed relative rates from the human's list.
- **The residual prep mismatch is not a parse error.** On the reference production's
  preshoot day the accountant billed grip, props and set dressing at *shoot* hours
  because it was a rigging day, while camera and electric stayed on prep hours. Which
  crew work full hours on a given day is a scheduling decision, not something a budget
  states — so it belongs in the human input, not in the parser.
- **Phase labels vary by budget.** `classify_phase` handles the common vocabulary
  including `Prep (NonConsec)` and `Shoot Mandays`; unfamiliar labels fall through
  to `allowance` rather than being silently mis-assigned.
- Column x-positions are tuned to this template. A materially different layout will
  need `COL_*` retuned — the reconciliation assertion will fail loudly if so, which
  is the intended behaviour.

---

# Cash flow generator

```bash
python generate_cashflow.py budget.json production.json -o cashflow.json \
    --compare "Cash Flow The Children California Full 083117.xlsx"
```

`production.json` is the human input — the six answers a budget cannot contain.

## Where it stands

| Measure | Result |
|---|---|
| Reconciles to budget total | **exact**, $6,062,000 |
| Money placed from real budget detail | 50.5% |
| Money placed by archetype | 33% |
| Correlation with the accountant's curve | see below |
| Worst cumulative divergence | $1.12M (19% of total) |

### Fit, by placement strategy

| Strategy | Correlation | Mean error / week |
|---|---|---|
| Hand-written department archetypes | 0.694 | $113,523 |
| Learned phase shares only | 0.691 | $113,977 |
| Learned **week-by-week profiles** for unphased money | 0.748 | $109,026 |
| Learned profiles preferred over duration inference | **0.815** | $93,870 |

**Read the last row with suspicion.** Those profiles were learned from the same
production being scored, so 0.815 is a ceiling under a circular test, not an
out-of-sample result. It is not even 1.0 because the budget's account totals and
the cash flow's disagree in 30 of 35 departments — a correct shape applied to a
different amount still lands in the wrong place.

The genuine number needs a second production. That is the single most valuable
thing to acquire next.

### The negative result worth keeping

Learning **phase shares** alone changed nothing (0.694 → 0.691). Learning the
**week-by-week profile** moved it (→ 0.748). The reason is that spend ramps by two
orders of magnitude *inside* the prep phase — $5,430 in the first prep week against
$514,159 in the last. Any model that spreads evenly within a phase throws away the
thing that matters most, no matter how good its phase shares are.

**This reconciles but is not yet accurate enough to ship.** The architecture is
right — every dollar is placed, traceable to its basis, and the total is asserted
rather than hoped for — but the weekly shape is not close enough for a lender to
draw against.

## The diagnosed gap

The generated curve sits roughly two weeks later than the accountant's. Their
Prep (-2), Prep (-1) and Shoot Wk 1 carry $1.69M between them; the generator puts
$0.55M there. The cause is **front-loading that no duration-based model infers**:
cast deals paying on start, location and stage deposits, construction materials
bought before the build, insurance premium, equipment deposits.

`rental_deposit_share` addresses part of it. The rest is genuine domain knowledge,
and it is the strongest argument for asking a human a small number of good
questions rather than trying to derive everything.

## The clear next lever

Half the money is still placed by department archetype, and department archetypes
are coarse. **Account-level archetypes** would sharpen this considerably —
`3217 BOX RENTALS` is shoot, `4595 EDITING ROOM` is post, `2516 GRIP EXPENDABLES`
is shoot — where today both inherit a single departmental shape. That mapping is
the highest-value next piece of work, and it is a table, not an algorithm.

Second lever: learn the spreads from historical cash flows instead of hand-setting
them. Every past production is a labelled training pair of budget and cash flow.

## How money gets placed

| Basis | Share | Meaning |
|---|---|---|
| `phase_line` | $2.10M | The budget states the phase and duration — spread over the weeks it spans |
| `fringe` | $0.97M | Follows the wages it is charged on, shifted by its own remittance lag |
| `allowance_duration` | $0.81M | States a span but not a phase — matched to the phase closest in length |
| `deposit` | $0.21M | Front-loaded share of rentals, paid the week before the hire starts |
| `archetype` | $1.98M | No stated timing at all — shaped by department, **and reported every time** |

Nothing is placed silently. `assumptions` in the output names every archetype
placement, its dollar value, and its share of the department.
