# Parser Spike Outputs

This folder holds temporary inspection artifacts generated during workbook reverse-engineering and parser spikes.

Regenerate with the current parser after any parser change. A stale fixture
silently reintroduces the defects it was captured with — this one kept the
sample import reporting 25 sections and 30 periods after the parser was fixed.

Current artifact:
- `cashflow-inspection.json` — metadata extracted from the sample cash flow workbook

Notes:
- source workbook: `/home/cpetrula/projects/cashflow-app/Cash Flow The Children California Full 083117.xlsx`
- verified detail sheet: `The Nun Cash Flow - USD`
- verified period count: `36` (30 labelled + 6 dated but unlabelled)
- verified grand total row: `552`
- verified cumulative row: `553`
