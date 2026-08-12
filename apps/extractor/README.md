# Extractor service

Budget extraction and document generation, as an HTTP service. The Node app owns
the database and the web layer; this owns reading a budget and turning it into
the two documents a production actually needs.

Python because that is where the libraries are — `pdfplumber` has no equivalent
in Node — and because the logic here is already verified against real documents.

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Endpoints

| | | |
|---|---|---|
| `POST` | `/extract` | budget PDF → structured JSON, with production type and the inputs it could not determine |
| `POST` | `/generate/hotcost` | budget + config → pre-populated day sheets (xlsx) |
| `POST` | `/generate/cashflow` | budget + config → weekly grid, reconciled or refused |
| `POST` | `/learn` | completed cash flows → observed spread profiles |
| `GET` | `/health` | |

## Verified end to end over HTTP

Against *The Children* — the locked budget, the accountant's cash flow, and the
hot cost workbook they kept during the shoot:

| | |
|---|---|
| `/extract` reconciliation | **exact**, $6,062,000, 582 accounts |
| `/extract` asks for | 4 things, 3 of them prefilled |
| `/generate/hotcost` | 122 crew, 26 day sheets |
| Budgeted day costs vs the accountant's own | **95%** (52 of 55) |
| `/generate/cashflow` reconciliation | **exact**, refuses to emit otherwise |
| Television budget | **422**, with the evidence for the call |

## Two things it refuses to do

**Emit a schedule that does not reconcile.** `/generate/cashflow` returns 422
with the arithmetic rather than a plausible-looking grid. A schedule that has
quietly stopped matching its budget is worse than none, because it still looks
authoritative.

**Treat a television budget as a feature.** Detected from ten weighted signals
in the budget itself, so it is never a question the user has to answer. TV is
episodic with pattern and amortised costs and no single shoot block — a
feature-shaped schedule built from one would reconcile and still be meaningless.
