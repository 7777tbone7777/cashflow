# cashflow

Production finance for film. A budget goes in; a weekly cash flow and
pre-populated hot cost day sheets come out.

## Stack
- Vue 3 SPA + Vite — `apps/web`
- Node.js + Express + Prisma/PostgreSQL — `apps/api`
- Python + FastAPI — `apps/extractor`, where the domain logic lives

The extractor is Python because that is where the libraries are: `pdfplumber`
has no equivalent in Node, and the extraction logic is verified against real
documents. `tools/budget-extractor` is the same code as a CLI, plus the
verification harness and the rate-card work.

## Where the real documentation is
`tools/budget-extractor/README.md` — what the system does, what it refuses to
do, and how accurate it currently is.

## Deployment
Railway project `awake-imagination`, deployed from `main` of this repository.
`npm run deploy` is the container start command, not something you run: it
pushes the schema and starts the server.

    web + api   https://cashflow-production-9642.up.railway.app
    extractor   https://extractor-production-aadb.up.railway.app

## Status
In use, and honest about its limits. The generated schedule reconciles to the
budget exactly or it is not emitted. The weekly *shape* is a forecast, and its
accuracy depends on answers only a production accountant has — the app asks for
them and shows what each is worth. Accuracy figures, including the ones that did
not hold up out of sample, are in the extractor README.

## Local development

    npm install
    npm run dev                      # api on 3001, web on 5173
    cd apps/extractor && uvicorn app.main:app --port 8000

Copy `apps/api/.env.example` to `apps/api/.env` first. The first account created
on an empty instance claims it; everyone after that needs an invitation.
