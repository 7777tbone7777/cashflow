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
- **Column positions are now detected per template**, not hardcoded. Movie Magic
  reprints `Acct# Description Amt Units X Rate SubT Total` on every detail page, so
  the layout is self-describing. Values are assigned to the nearest header centre
  because headers print left-aligned while figures print right-aligned — hard
  boundaries misfile roughly 40% of rows. Tested against a feature (Amt at x=379)
  and a television budget from the same software (Amt at x=321).
- **Television budgets parse structurally but do not yet reconcile.** Top sheets are
  read correctly — a WB one-hour pilot came out at $6,538,083 against a stated
  $6,538,080 — but the detail pages nest Subtotal and Total differently and
  currently double-count. TV is out of scope for now; these budgets are kept as
  generalisation fixtures.

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

---

# Hot cost generator

```bash
python generate_hotcost.py budget.json production.json -o HOTCOST.xlsx
python verify_generated_hotcost.py HOTCOST.xlsx "HOT COST TEMPLATE-THE CHILDREN.xls"
```

One sheet per shoot day, pre-populated. On the day the accountant enters **call,
lunch and wrap**; hours, overtime units, actual day cost and variance compute.

## Accuracy against the accountant's own workbook

| Day type | Budgeted day cost matched |
|---|---|
| Shoot day | 25 / 27 (**93%**) |
| Prep day | 27 / 28 (**96%**) |
| Overall | 52 / 55 (**95%**) |

The three misses are two Local 399 transport guarantees and one first-aid prep
day — exception-queue items, not systemic.

## What it gets right that a naive template would not

**Phase-specific budgeted day.** 73 of 122 crew have a day cost that changes
between prep and shoot. Carrying one figure per person is wrong on every prep day
while still totalling plausibly, which is exactly the kind of error that survives
review.

**Union overtime derived, not modelled.** The budget shows Local 705 paying 17.25
units for a 14-hour day where Local 399 pays 20. A hard-coded 8 / 1.5x / 2x rule
would be wrong for most of the crew, so `learn_unit_curves` builds the
hours-to-units curve per union from the guarantees the budget already states —
14 curves out of the reference budget.

**Correct scope.** A hot cost tracks *variable* labour. Above-the-line flat deals
do not vary daily and are not on the sheet — 122 of 133 budgeted people make it,
matching the departments the reference production's own hot cost carries.

**The RATE column convention.** Hourly crew show their hourly rate; flat-rate crew
show their day cost. The reference workbook does this without exception — the
UPM's RATE and BUDGET/DAY are both 1,063.60, Craig Bauer's are 45.00 and 630.00.

## Conventions are declared, not inferred

Three things the accountant applies that no budget states. They live in
`production.json` under `hot_cost_conventions` so they are visible and arguable:

| Convention | Default | Why |
|---|---|---|
| `flat_rate_bills_shoot_day` | `true` | Weekly flat crew bill their shoot rate on prep days; the budget's lower prep rate is a budgeting device, not a timecard rate |
| `minimum_prep_units` | `11.0` | Hourly crew get a standard 10-hour prep day rather than a fractional budget guarantee |
| `preshoot_at_shoot_hours` | `["2500","2700","2800"]` | Set ops, set dressing and property rig on the preshoot day and work shoot hours |

Getting `preshoot_at_shoot_hours` wrong is instructive: including Set Lighting
dropped prep accuracy from 96% to 89%. These are real, checkable claims about how
a production runs, which is why they belong in config a human can argue with
rather than buried in code.

## Department roll-up and summary sheets

The workbook opens on two sheets built from the day sheets by formula, so they
update as times are entered rather than needing a rebuild.

**`SUMMARY`** — department × day, in variance. Negative is over, and over-budget
cells shade automatically so the picture reads without hunting for minus signs.
14 departments across 26 days, plus a total column and row.

**`WEEKLY`** — the same rolled to shoot weeks with actual, budget and variance per
department. This is the cadence a cost report runs on, and it is the view that
answers *which department is running over* in about four seconds.

Each day sheet now carries per-department **LABOR** and **FRINGE** roll-up rows.
Fringe is a separate line on purpose: it remits on a different calendar from
wages, and a department can be on budget on wages while over on fringe.

### Fringe rates come from the budget, not a flat assumption

`department_fringe_rates` charges each department's own fringe schedule against
its own labour. The reference budget yields rates from **28.5% (Locations) to
52.0% (Set Lighting)** — a flat 40% would be wrong by a third at both ends.

Where a department's labour base is too small to give a meaningful rate — Set
Construction is mostly materials, not wages — it falls back to the
production-wide average rather than emitting a 200% rate.

---

# Production type detection

The budget says whether it is a feature or television, so the app should not ask.

```bash
python extract_budget.py BUDGET.pdf --summary
# detected: FEATURE  (confidence 100%)
#    + single production-period block
#    + editorial at 4500
```

Ten weighted signals, with the evidence reported either way. Measured:

| Budget | Detected | Confidence |
|---|---|---|
| The Children (feature) | FEATURE | 100% |
| WB One Hour Pilot | TELEVISION | 88% |
| Cable Amort 9 Eps | TELEVISION | 89% |
| Multicam Pattern 12 Eps | TELEVISION | 83% |

It matters because the two need different cash flow models — television is
episodic, with pattern and amortised costs and no single shoot block. Detection
also carries its counter-evidence, so a low-confidence call is visible rather
than silent.

---

# Rate card repository

```bash
python ingest_rate_cards.py "Guild Agreements/" -o rates.json
python check_rates.py budget.json rates.json --region "Los Angeles"
```

Parses **rate cards, not collective bargaining agreements**. A CBA is a couple of
hundred pages of legal prose; the rate schedule attached to it is a table, and the
table is the only part a budget tool needs. Derived rate tables are stored — never
copies of the source documents, which are licensed.

## Results on a 39-document collection

| | |
|---|---|
| Documents | 39 |
| Yielded a rate table | 35 |
| **Trusted after confidence filtering** | **13** |
| Trusted rates | 486 |

Confidence is scored **per page, best page wins**. A genuine rate card has at
least one page that is mostly rate rows; a 200-page agreement with a wage
appendix has exactly one too, and that appendix is the part worth keeping.
Averaging across a document hides both.

Without filtering, the 2023 WGA MBA yielded 65 confident-looking rates built from
clause fragments — `The provisions of the → $2,020.00` is the *year* 2020 read as
money. Two filters fixed it: bare four-digit integers in running text are years,
not money; and a classification must look like a job title rather than a sentence
fragment, a street address or a URL. The Local 600 card was otherwise offering
`70 W 36th Street 9th Floor` at $877/hour.

## What a rate card gives that a budget cannot

Beyond scale itself, the Local 600 card states its own conditions in words, and
these parse: **`Minimum Call - 8 Hours`, `1-1/2 after 8`, `43.2 hour guarantee`**.

That is the authoritative version of what `generate_hotcost.py` currently derives
empirically from whatever guarantees a budget happens to state — which leaves it
blind to any local the budget does not quantify.

## The checker reports no coverage rather than false findings

Against the reference budget it currently finds nothing, and that is the correct
answer:

```
crew records with a rate                 139
no local identified                      112
no rate card for this region              27
  BELOW scale                              0

No applicable rate card for Los Angeles. Cards on hand cover: Eastern Region.
```

A first version without region gating reported two crew as dramatically below
scale. Both were artefacts — the cards to hand are **Eastern Region** and the
production shot in **Los Angeles**. Scale is regional, so comparing across that
boundary manufactures compliance findings out of nothing. Below-scale is a
liability worth catching, which is exactly why a false one is worse than silence.

## What would make it useful

1. **Western Region / LA rate cards.** The single biggest gap; the collection to
   hand is Eastern Region and Canadian.
2. **Occupation codes in the budget.** The Local 600 card keys on them (`1901`
   Director of Photography). Budgets carry account codes instead, so matching
   falls back to fuzzy classification names.
3. **A proper key.** Scale varies by `(local, region, tier/panel, effective date,
   production type)` — the IA 667 card prices Feature and Television separately.
   Anything less than the full key is not a rate.

---

# Overrides

```bash
python overrides.py --example > overrides.json
python generate_cashflow.py budget.json production.json \
    --archetypes archetypes.json --overrides overrides.json -o cashflow.json
```

Inputs are what the system does not know. **Overrides are what it decided** — and
on the reference budget it decides a great deal without being asked: 420 phase
lines whose timing is a guess, 218 inferred rate bases, 31 multipliers rebuilt
arithmetically, 22 archetype placements.

## Reconciliation is sacred

The whole trust argument is *this sums to the budget*, so overrides come in two
kinds and the distinction is load-bearing:

| Kind | Changes | Ceremony |
|---|---|---|
| `redistribute` | **when** money lands | none — total asserted afterwards |
| `amend` | **how much** | reported, never applied; needs a versioned budget amendment |

A redistribution that moves the total fails loudly:

```
redistribution changed the total by 42,000.00 (6,062,000.00 -> 6,104,000.00).
A redistribute override may change when money lands, never how much.
Use kind='amend' if the amount really is changing.
```

Amendments are collected whether or not any code path consults that field. A user
who asks for a change is owed an answer even when nothing queried it.

## Five scopes, most specific wins

`line` → `account` → `department` → `production` → `company`. Design so people
work at the **department** level; nobody wants to override 979 phase lines.

Worked example — the crane wanted a week early, as an account-level override:

```
Set Operations, account 2519
   Prep Wk (-1)      +19,300
   Shoot Wk 1         -3,860
   Shoot Wk 2         -3,860 ...
   department total  287,115 -> 287,115   preserved
```

## Human knowledge beats a learned prior

Wiring this up exposed a real precedence bug. The `prefer_learned_profiles`
shortcut placed an account's whole total by its observed shape and **skipped the
override layer entirely** — 4 overrides loaded, 0 applied, and three wrongly
reported as orphaned. A learned profile is what *usually* happens; the person
typing knows what *is* happening on this show, so overrides are now checked
first and the shortcut is bypassed for any account a human has steered.

The same pass caught fringes being placed twice under that shortcut, which had
been generating negative archetype gaps. Assumptions dropped from 22 to 1.

## Orphans, and why keying matters

Overrides must survive re-import, because the product is the weekly reforecast.
But budgets re-version underneath you — 30 of 35 departments moved between two
versions of this production while the total held. So keys are identity
(`account|sub|person`), never row position, and anything pointing at something
the budget no longer has is reported rather than dropped:

```
3 ORPHANED — the budget no longer has what these point at:
   department:3300 prep_lead_weeks   (line producer, 2017-09-05)
```

## Corrections are not overrides

Every entry records `origin`:

- **`correction`** — the parser got it wrong. A bug report with a repro attached;
  should be fixed upstream and never repeated on the next show.
- **`judgement`** — the human knows what no document states. Permanent.

Corrections should trend to zero as the parser improves; judgements should not.
Those two curves are the clearest health metric the product has — and if most
users override the same default, the default is wrong.

---

# Television budgets are refused, not mishandled

```
This appears to be a TELEVISION budget (88% confidence: splits below-the-line
into Production and Other; pilot; editorial at 5100 rather than 4500).

Television is not supported yet — it is episodic, with pattern and amortised
costs and no single shoot block, so a feature-shaped cash flow built from it
would reconcile and still be wrong.

Pass --force to override this check if the detection is mistaken.
```

Detection exists precisely so this can fail loudly. A schedule that reconciles
and is meaningless is worse than an error, because it still looks authoritative.

---

# Preferred input: ask for the JSON export, not the PDF

Movie Magic Budgeting **10.25.20** (November 2023) added a JSON export,
described in EP's own release notes as being "for easier parsing". Alongside
XML (Advanced), it carries **all detail-level information plus Fringes, Groups,
Globals, Sets and Locations for each detail line**.

That is a materially better input than a print-out, and it changes what this
tool should ask for.

| | PDF (what we parse today) | JSON export |
|---|---|---|
| Detail lines | reconstructed from x-positions | native |
| Intra-word spaces | lost — `PRODUCTIONSTAFF` | intact |
| Page-break damage | repaired arithmetically (31 multipliers) | none |
| Fringes | scraped from a printed table | structured, per line |
| **Globals** | **absent** | **per detail line** |
| Sets / Locations | absent | per detail line |

## Why Globals are the prize

A Movie Magic budget is *parameterised*. Globals are named values — prep days,
shoot days, wrap days, crew rates — defined once and referenced throughout, and
the export records which globals each detail line uses.

Two consequences:

**The calendar stops being a question.** Prep, shoot and wrap durations are
named variables in the budget rather than something inferred from phase
quantities. That is most of intake Class 1 and Class 2 answered outright.

**Reforecasting becomes native.** MMB's own value proposition for globals is
that changing an assumption ripples through every dependent line. Knowing the
dependency graph means a schedule change — 25 shoot days becomes 27 — can
re-drive the budget the way MMB itself would, instead of being approximated.
That is exactly what the weekly reforecast loop needs.

## The ask

One JSON export from a budget already in MMB 10.25.20 or later. The `.mbd`
files to hand are MMB7-era and encrypted (magic bytes `EP_fG`, entropy 8.00),
but MMB 10 imports `.mbd` and can re-export as JSON — so an old budget can still
be converted.

**Not yet implemented, deliberately.** EP publishes no schema for the JSON
export, and writing an importer against a guessed structure would be exactly the
kind of speculation this codebase has avoided. One sample file is enough to
build it properly; without one it would be fiction.

The PDF parser stays regardless — plenty of budgets arrive as print-outs, and it
reconciles exactly. It just should not be the preferred path when a better one
exists.

## On finding a second production

Searched for publicly available budget and cash flow pairs and came up empty.
Blank templates are widely published; **real paired documents from the same
production are not**, and templates teach nothing about spread shapes because
they carry no allocations. Film commissions require budgets and cash flows for
incentive applications but do not publish them.

The realistic sources are therefore private: past shows from the same production
company, or productions reachable through existing relationships. That remains
the highest-value thing to acquire, and it is an ask rather than a search.
