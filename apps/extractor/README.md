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

## Deployment

Runs as its own Railway service in the `awake-imagination` project, alongside
the Node app and Postgres, on the same private network.

    https://extractor-production-aadb.up.railway.app

Verified in production against the reference documents: `/extract` returns exact
reconciliation at 100% coverage in ~10s for a 72-page budget; `/generate/hotcost`
returns 122 crew across 26 day sheets in ~1.6s, matching the accountant's own
budgeted day costs 52 times out of 55; `/generate/cashflow` reconciles exactly.

### Monorepo build

Root Directory is `apps/extractor`. Railway builds a monorepo service from its
root directory, and the repo root is a Node app — without this the builder
detects Node, looks for a start script and fails, which is exactly how the first
attempt failed.

Pushes to `main` redeploy this service alongside the Node app, and
`apps/extractor/railway.json` supplies the start command.

The setting cannot be made from the Railway CLI. The GraphQL mutation works,
but only with a browser-like `User-Agent` — Cloudflare returns 403 error 1010
to the default Python or curl signature, which reads as an auth failure and is
not one.
