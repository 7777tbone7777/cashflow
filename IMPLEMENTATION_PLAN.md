# Cashflow App Implementation Plan

## Repo Context
Repository: `7777tbone7777/cashflow`, deployed from `main` to the Railway project
`awake-imagination`.

**This document is a historical record, not a current plan.** It was written
against an empty repository and proposed building a cash flow importer with
read-only reporting. The product went the other way: a budget goes in and the
documents come out, and importing an existing cash flow is the secondary path.
Milestones 1 to 3 below were largely built, in a different order and shape than
described. Read `tools/budget-extractor/README.md` for what the system actually
does.

## Product Direction
Build sequence:
1. cash flow workbook ingestion
2. normalized persistence model
3. read-only weekly cash flow reporting
4. exports
5. manual adjustments / scenarios
6. hot cost integration

## Milestone 1 — Foundation + Cash Flow Import MVP
Goal: upload a cash flow workbook and reproduce weekly + cumulative totals in the app.

### Ticket 1: Project bootstrap
- finalize stack
- initialize frontend + backend + shared package layout
- add linting, formatting, env handling, and basic CI

Locked stack:
- `apps/web` — Vue 3 SPA with Vite
- `apps/api` — Node.js + Express API
- `packages/shared` — shared types/schemas/validation

### Ticket 2: Database schema v1
Create initial PostgreSQL schema for:
- productions
- import_batches
- cash_flow_periods
- cash_flow_sections
- cash_flow_line_items
- cash_flow_allocations
- forecast_snapshots

Acceptance:
- migrations run cleanly
- schema supports the reviewed workbook structure

### Ticket 3: File upload pipeline
- upload workbook to backend
- persist original file to object storage or local dev storage abstraction
- create import batch record
- queue parsing job

Acceptance:
- upload succeeds and import batch is created
- original file reference stored for audit

### Ticket 4: Cash flow workbook parser prototype
- parse `.xlsx`
- identify detail sheet
- extract periods, sections, line items, allocations
- detect total and cumulative rows

Acceptance:
- parse `Cash Flow The Children California Full 083117.xlsx`
- produce structured JSON output

### Ticket 5: Normalization + persistence
- convert parser output into DB records
- persist sections, line items, allocations
- store import metadata and warnings

Acceptance:
- imported workbook lives in DB in normalized form

### Ticket 6: Recalculation engine v1
- recompute section subtotals
- recompute weekly totals
- recompute cumulative totals
- compare to imported workbook totals

Acceptance:
- row-552-equivalent and row-553-equivalent calculations match within tolerance

### Ticket 7: Read-only report API
Endpoints:
- production summary
- periods
- sections
- line items
- totals
- cumulative totals

Acceptance:
- API returns all data needed for report UI

### Ticket 8: Read-only report UI
Build screens:
- production dashboard
- import status view
- weekly cash flow report table
- cumulative chart

Acceptance:
- user can upload workbook and see reconstructed report

### Ticket 9: Export v1
- PDF cash flow report
- CSV/XLSX normalized export

Acceptance:
- exported report is usable for client review

## Milestone 2 — Editable Forecast
Goal: make the forecast usable beyond passive import.

### Ticket 10: Manual line items / overrides
- add manual rows
- allow allocation edits
- persist overrides separately from imported source

### Ticket 11: Scenario snapshots
- clone imported snapshot into scenario
- compare scenario to base

### Ticket 12: Notes / assumptions layer
- attach notes to sections and snapshots
- expose assumptions in exports

## Milestone 3 — Hot Cost Integration
Goal: bring in the `.xls` operational workbook as a labor input source.

### Ticket 13: Hot cost workbook parser prototype
- parse `.xls`
- identify day tabs
- extract row-level actuals and variance fields
- normalize daily labor rows

### Ticket 14: Hot cost schema v1
Add:
- hot_cost_days
- hot_cost_line_items
- mapping_rules

### Ticket 15: Labor mapping engine
- map hot cost account codes into cash flow sections
- aggregate by week
- produce labor forecast adjustment layer

### Ticket 16: Hot cost UI/reporting
- day-level variance view
- labor trend view
- forecast impact preview

## Milestone 4 — Advanced Forecasting
Goal: move toward a production finance operating tool.

### Ticket 17: Rule-based schedule engine
- configurable spread rules
- deposits/insurance/post templates
- non-labor scheduling helpers

### Ticket 18: Versioning / approval flow
- lock snapshots
- mark official forecast versions
- compare revisions

### Ticket 19: Client-ready reporting suite
- lender/investor summary
- detailed department reports
- polished export templates

## Recommended Stack Decision
Because this repo is empty, the locked stack is:

### Frontend
- Vue 3 SPA
- Vite
- TypeScript
- Vue Router
- Pinia
- charting library for weekly/cumulative graphs

### Backend
- Node.js + TypeScript
- Express
- Zod for validation
- background job runner for imports

### DB / tooling
- PostgreSQL
- Prisma

### Recommendation
This is a good fit for the app because it keeps:
- a clear SPA/frontend boundary
- a straightforward Express API surface for imports and reporting
- a relational model that maps well onto periods, sections, allocations, and snapshots
- room to grow parser/background job complexity later without rewriting the app shape

## First Engineering Sprint Recommendation
If we start building immediately, Sprint 1 should contain:
1. project bootstrap
2. DB schema v1
3. cash flow workbook parser spike
4. persistence of parsed workbook
5. recalculation engine prototype

## Definition of Success for Sprint 1
At end of Sprint 1 we should be able to:
- upload the sample cash flow workbook
- parse it
- persist normalized rows
- calculate weekly totals + cumulative totals
- verify they match the workbook

## Immediate Next Deliverables
After this plan, the best next artifacts to create are:
1. `ARCHITECTURE.md`
2. DB schema / migration plan
3. repo bootstrap
4. parser spike using the provided workbook
