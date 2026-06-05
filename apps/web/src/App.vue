<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

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

type SectionLineItem = {
  id: string
  accountCode: string | null
  description: string
  lineType: string
  sourceRowNumber: number | null
  ctdAmount: number | string | null
  commitmentsAmount: number | string | null
  importedTotal: number | string | null
  allocations: Array<{
    id: string
    amount: number | string
    periodSequence: number
    periodLabel: string
  }>
}

type ImportResult = {
  ok: true
  workbookType?: string
  result: {
    productionId: string
    importBatchId: string
    productionTitle: string
    periods?: number
    sections?: number
    lineItems?: number
    allocations?: number
    snapshots?: number
    daySheetCount?: number
    summaryEntryCount?: number
  }
}

type HotCostSummary = {
  productionId: string
  title: string
  hotCostImport: null | {
    workbookType: string
    summarySheetName: string
    sheetNames: string[]
    daySheetNames: string[]
    dayColumns: Array<{ columnIndexZeroBased: number; dayLabel: string; dateLabel: string }>
    summaryEntryCount: number
    daySheetSummaries: Array<{ sheetName: string; rowCount: number; sampleRows: unknown[] }>
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

const loading = ref(true)
const importing = ref(false)
const loadingSection = ref(false)
const error = ref('')
const importMessage = ref('')
const productions = ref<Production[]>([])
const selectedProductionId = ref('')
const summary = ref<ProductionSummary | null>(null)
const sections = ref<Section[]>([])
const selectedSectionId = ref('')
const sectionLineItems = ref<SectionLineItem[]>([])
const uploadFile = ref<File | null>(null)
const uploadTitle = ref('')
const hotCostSummary = ref<HotCostSummary | null>(null)

const selectedProduction = computed(() =>
  productions.value.find((production) => production.id === selectedProductionId.value) || null,
)

const selectedSection = computed(() =>
  sections.value.find((section) => section.id === selectedSectionId.value) || null,
)

const totalUpcomingCash = computed(() => {
  if (!summary.value?.snapshot) return 0
  return summary.value.snapshot.weeklyTotals.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
})

function formatMoney(value: number | string | null | undefined, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed: ${response.status}`)
  }
  return response.json()
}

async function loadHotCostSummary(productionId: string) {
  try {
    hotCostSummary.value = await fetchJson<HotCostSummary>(`/api/imports/hot-cost/${productionId}`)
  } catch {
    hotCostSummary.value = null
  }
}

async function loadSectionLineItems(sectionId: string) {
  if (!selectedProductionId.value) return
  loadingSection.value = true
  try {
    sectionLineItems.value = await fetchJson<SectionLineItem[]>(
      `/api/productions/${selectedProductionId.value}/sections/${sectionId}/line-items`,
    )
  } finally {
    loadingSection.value = false
  }
}

async function loadProductionData(productionId: string) {
  const [summaryResponse, sectionsResponse] = await Promise.all([
    fetchJson<ProductionSummary>(`/api/productions/${productionId}/summary`),
    fetchJson<Section[]>(`/api/productions/${productionId}/sections`),
  ])

  summary.value = summaryResponse
  sections.value = sectionsResponse
  await loadHotCostSummary(productionId)

  if (sectionsResponse.length > 0) {
    selectedSectionId.value = sectionsResponse[0].id
    await loadSectionLineItems(sectionsResponse[0].id)
  } else {
    selectedSectionId.value = ''
    sectionLineItems.value = []
  }
}

async function loadProductions(selectFirst = false) {
  const productionList = await fetchJson<Production[]>('/api/productions')
  productions.value = productionList

  if (productionList.length === 0) {
    selectedProductionId.value = ''
    summary.value = null
    sections.value = []
    sectionLineItems.value = []
    hotCostSummary.value = null
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
    const response = await fetchJson<ImportResult>('/api/imports/sample', { method: 'POST' })
    await loadProductions(true)
    importMessage.value = `Sample import complete: ${response.result.sections} sections, ${response.result.lineItems} line items, ${response.result.allocations} allocations.`
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Sample import failed.'
  } finally {
    importing.value = false
  }
}

function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  uploadFile.value = target.files?.[0] || null
}

async function uploadWorkbook() {
  if (!uploadFile.value) {
    error.value = 'Choose a workbook file first.'
    return
  }

  importing.value = true
  importMessage.value = ''
  error.value = ''

  try {
    const formData = new FormData()
    formData.append('workbook', uploadFile.value)
    if (uploadTitle.value.trim()) {
      formData.append('productionTitle', uploadTitle.value.trim())
    }

    const response = await fetchJson<ImportResult>('/api/imports/upload', {
      method: 'POST',
      body: formData,
    })

    await loadProductions(true)

    if (response.workbookType === 'hot-cost') {
      importMessage.value = `Hot cost workbook recognized for ${response.result.productionTitle}: ${response.result.daySheetCount} day sheets, ${response.result.summaryEntryCount} summary rows. Cash flow generation from this data is next.`
    } else {
      importMessage.value = `Upload import complete for ${response.result.productionTitle}: ${response.result.sections} sections, ${response.result.lineItems} line items.`
    }

    uploadFile.value = null
    uploadTitle.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Workbook upload failed.'
  } finally {
    importing.value = false
  }
}

function exportJson() {
  if (!selectedProductionId.value) return
  window.open(`${API_BASE}/api/exports/productions/${selectedProductionId.value}/report.json`, '_blank')
}

function exportCsv() {
  if (!selectedProductionId.value) return
  window.open(`${API_BASE}/api/exports/productions/${selectedProductionId.value}/report.csv`, '_blank')
}

watch(selectedSectionId, async (sectionId, previousSectionId) => {
  if (!sectionId || sectionId === previousSectionId) return
  try {
    await loadSectionLineItems(sectionId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load section line items.'
  }
})

onMounted(() => {
  bootstrap()
})
</script>

<template>
  <main class="app-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Cashflow</p>
        <h1>Cash Flow Dashboard</h1>
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

    <section class="panel upload-panel">
      <div class="panel-header">
        <div>
          <h2>Upload hot cost workbook</h2>
          <p>Upload the operational hot cost workbook. Cash flow generation from hot cost data is the next active build step.</p>
        </div>
        <div class="export-actions">
          <button class="secondary-button" type="button" @click="exportJson">Export JSON</button>
          <button class="secondary-button" type="button" @click="exportCsv">Export CSV</button>
        </div>
      </div>

      <div class="upload-grid">
        <input type="file" accept=".xlsx,.xls" @change="handleFileChange" />
        <input v-model="uploadTitle" type="text" placeholder="Optional production title" />
        <button class="import-button" type="button" :disabled="importing" @click="uploadWorkbook">
          {{ importing ? 'Inspecting workbook…' : 'Upload workbook' }}
        </button>
      </div>
    </section>

    <section v-if="hotCostSummary?.hotCostImport" class="panel success-panel">
      Hot cost workbook detected for <strong>{{ hotCostSummary.title }}</strong> — {{ hotCostSummary.hotCostImport.daySheetNames.length }} day sheets, {{ hotCostSummary.hotCostImport.summaryEntryCount }} summary rows, summary sheet {{ hotCostSummary.hotCostImport.summarySheetName }}.
    </section>

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
                <p>Pick a section to inspect imported line items and allocations.</p>
              </div>
              <span class="pill">{{ sections.length }}</span>
            </div>

            <ul class="section-list">
              <li
                v-for="section in sections"
                :key="section.id"
                :class="['section-item', { active: section.id === selectedSectionId }]"
                @click="selectedSectionId = section.id"
              >
                <div>
                  <strong>{{ section.name }}</strong>
                  <p>Acct {{ section.code || '—' }} · rows {{ section.sourceStartRow }}–{{ section.sourceEndRow }}</p>
                </div>
                <span>{{ section.lineItemCount }} lines</span>
              </li>
            </ul>
          </article>
        </section>

        <section class="panel drilldown-panel">
          <div class="panel-header">
            <div>
              <h2>{{ selectedSection?.name || 'Section drilldown' }}</h2>
              <p>
                {{ selectedSection ? `Imported rows for ${selectedSection.name}.` : 'Select a section to inspect imported line items.' }}
              </p>
            </div>
            <span v-if="selectedSection" class="pill">{{ sectionLineItems.length }} rows</span>
          </div>

          <div v-if="loadingSection" class="loading-panel-inline">Loading section line items…</div>

          <div v-else class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Acct</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Imported total</th>
                  <th>Allocations</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="lineItem in sectionLineItems" :key="lineItem.id">
                  <td>{{ lineItem.sourceRowNumber }}</td>
                  <td>{{ lineItem.accountCode || '—' }}</td>
                  <td>{{ lineItem.description }}</td>
                  <td>{{ lineItem.lineType }}</td>
                  <td>{{ formatMoney(lineItem.importedTotal, summary?.production.currency || 'USD') }}</td>
                  <td>
                    <div v-if="lineItem.allocations.length" class="allocation-list">
                      <span v-for="allocation in lineItem.allocations" :key="allocation.id">
                        {{ allocation.periodLabel }}: {{ formatMoney(allocation.amount, summary?.production.currency || 'USD') }}
                      </span>
                    </div>
                    <span v-else class="muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
  </main>
</template>
