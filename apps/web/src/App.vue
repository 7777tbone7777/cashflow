<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Production = {
  id: string
  title: string
  currency: string
  status: string
  counts: {
    periods: number
    sections: number
    lineItems: number
    snapshots: number
    importBatches: number
  }
}

type ProductionSummary = {
  production: {
    id: string
    title: string
    currency: string
    status: string
  }
  snapshot: null | {
    id: string
    name: string
    totalCtd: number
    totalCommitments: number
    weeklyTotals: Array<{ label: string; amount: number; periodSequence: number }>
    cumulativeTotals: Array<{ label: string; amount: number; periodSequence: number }>
    createdAt: string
  }
}

type Section = {
  id: string
  code: string | null
  name: string
  displayOrder: number
  sourceStartRow: number | null
  sourceEndRow: number | null
  lineItemCount: number
}

type SampleImportResult = {
  ok: true
  result: {
    productionId: string
    importBatchId: string
    periods: number
    sections: number
    lineItems: number
    allocations: number
    snapshots: number
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

const loading = ref(true)
const importing = ref(false)
const error = ref('')
const importMessage = ref('')
const productions = ref<Production[]>([])
const selectedProductionId = ref('')
const summary = ref<ProductionSummary | null>(null)
const sections = ref<Section[]>([])

const selectedProduction = computed(() =>
  productions.value.find((production) => production.id === selectedProductionId.value) || null,
)

const totalUpcomingCash = computed(() => {
  if (!summary.value?.snapshot) return 0
  return summary.value.snapshot.weeklyTotals.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
})

function formatMoney(value: number | null | undefined, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json()
}

async function loadProductionData(productionId: string) {
  const [summaryResponse, sectionsResponse] = await Promise.all([
    fetchJson<ProductionSummary>(`/api/productions/${productionId}/summary`),
    fetchJson<Section[]>(`/api/productions/${productionId}/sections`),
  ])

  summary.value = summaryResponse
  sections.value = sectionsResponse
}

async function loadProductions(selectFirst = false) {
  const productionList = await fetchJson<Production[]>('/api/productions')
  productions.value = productionList

  if (productionList.length === 0) {
    selectedProductionId.value = ''
    summary.value = null
    sections.value = []
    return
  }

  if (selectFirst || !selectedProductionId.value) {
    selectedProductionId.value = productionList[0].id
  }

  await loadProductionData(selectedProductionId.value)
}

async function bootstrap() {
  loading.value = true
  error.value = ''

  try {
    await loadProductions(true)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load dashboard data.'
  } finally {
    loading.value = false
  }
}

async function handleProductionChange(event: Event) {
  const target = event.target as HTMLSelectElement
  selectedProductionId.value = target.value
  if (!selectedProductionId.value) return

  loading.value = true
  error.value = ''
  try {
    await loadProductionData(selectedProductionId.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load production data.'
  } finally {
    loading.value = false
  }
}

async function runSampleImport() {
  importing.value = true
  importMessage.value = ''
  error.value = ''

  try {
    const response = await fetchJson<SampleImportResult>('/api/imports/sample', { method: 'POST' })
    await loadProductions(true)
    importMessage.value = `Sample import complete: ${response.result.sections} sections, ${response.result.lineItems} line items, ${response.result.allocations} allocations.`
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Sample import failed.'
  } finally {
    importing.value = false
  }
}

onMounted(() => {
  bootstrap()
})
</script>

<template>
  <main class="app-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Cashflow</p>
        <h1>Imported cash flow dashboard</h1>
        <p class="subhead">
          First live view over the workbook-import pipeline: Postgres-backed, API-driven, and ready for the next UI pass.
        </p>
      </div>

      <div class="header-actions">
        <label class="production-picker">
          <span>Production</span>
          <select :value="selectedProductionId" @change="handleProductionChange">
            <option v-for="production in productions" :key="production.id" :value="production.id">
              {{ production.title }}
            </option>
          </select>
        </label>

        <button class="import-button" type="button" :disabled="importing" @click="runSampleImport">
          {{ importing ? 'Running import…' : 'Re-import sample workbook' }}
        </button>
      </div>
    </header>

    <section v-if="importMessage" class="panel success-panel">
      {{ importMessage }}
    </section>

    <section v-if="error" class="panel error-panel">
      <strong>Couldn’t load dashboard data.</strong>
      <p>{{ error }}</p>
    </section>

    <template v-else>
      <section class="stats-grid">
        <article class="stat-card">
          <span class="stat-label">Total planned cash</span>
          <strong class="stat-value">
            {{ formatMoney(totalUpcomingCash, summary?.production.currency || 'USD') }}
          </strong>
          <small>Sum of weekly cash flow totals from the latest imported snapshot</small>
        </article>

        <article class="stat-card">
          <span class="stat-label">CTD</span>
          <strong class="stat-value">
            {{ formatMoney(summary?.snapshot?.totalCtd, summary?.production.currency || 'USD') }}
          </strong>
          <small>Cost-to-date from imported workbook totals</small>
        </article>

        <article class="stat-card">
          <span class="stat-label">Commitments</span>
          <strong class="stat-value">
            {{ formatMoney(summary?.snapshot?.totalCommitments, summary?.production.currency || 'USD') }}
          </strong>
          <small>Outstanding committed spend from latest snapshot</small>
        </article>

        <article class="stat-card">
          <span class="stat-label">Imported structure</span>
          <strong class="stat-value">
            {{ selectedProduction?.counts.sections || 0 }} sections / {{ selectedProduction?.counts.lineItems || 0 }} lines
          </strong>
          <small>{{ selectedProduction?.counts.periods || 0 }} periods in the current imported production</small>
        </article>
      </section>

      <section v-if="loading" class="panel loading-panel">Loading live production data…</section>

      <template v-else>
        <section class="content-grid">
          <article class="panel wide-panel">
            <div class="panel-header">
              <div>
                <h2>Weekly totals</h2>
                <p>Imported from the latest forecast snapshot.</p>
              </div>
              <span class="pill">{{ summary?.snapshot?.weeklyTotals.length || 0 }} periods</span>
            </div>

            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Weekly total</th>
                    <th>Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="period in summary?.snapshot?.weeklyTotals || []"
                    :key="period.periodSequence"
                  >
                    <td>{{ period.label }}</td>
                    <td>{{ formatMoney(period.amount, summary?.production.currency || 'USD') }}</td>
                    <td>
                      {{
                        formatMoney(
                          summary?.snapshot?.cumulativeTotals.find(
                            (entry) => entry.periodSequence === period.periodSequence,
                          )?.amount,
                          summary?.production.currency || 'USD',
                        )
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article class="panel side-panel">
            <div class="panel-header">
              <div>
                <h2>Sections</h2>
                <p>Detected section blocks from the source workbook.</p>
              </div>
              <span class="pill">{{ sections.length }}</span>
            </div>

            <ul class="section-list">
              <li v-for="section in sections" :key="section.id">
                <div>
                  <strong>{{ section.name }}</strong>
                  <p>Acct {{ section.code || '—' }} · rows {{ section.sourceStartRow }}–{{ section.sourceEndRow }}</p>
                </div>
                <span>{{ section.lineItemCount }} lines</span>
              </li>
            </ul>
          </article>
        </section>
      </template>
    </template>
  </main>
</template>
