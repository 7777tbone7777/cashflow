const BASE = import.meta.env.VITE_API_BASE_URL || ''

export type ProductionType = {
  type: 'feature' | 'television' | 'unknown'
  confidence: number
  evidence: string[]
  counter_evidence: string[]
}

export type InputRequired = {
  key: string
  question: string
  why: string
  prefill?: Record<string, unknown>
  count?: number
  missing?: string[]
  examples?: unknown[]
  detail?: string[]
}

export type BudgetUploadResult = {
  ok: true
  productionId: string
  importBatchId: string
  productionType: ProductionType
  grandTotal: number
  accounts: number
  departments: number
  inputsRequired: InputRequired[]
  warnings: string[]
}

export type BudgetSummary = {
  production: Record<string, unknown>
  totals: Record<string, number | null>
  topsheet: Array<{ acct: string; name_display: string; total: number }>
  inputsRequired: InputRequired[]
  warnings: string[]
  accountCount: number
}

export type CashflowResult = {
  ok: true
  snapshotId: string
  periods: number
  reconciliation: {
    budget_grand_total: number
    total_placed: number
    difference: number
    reconciles: boolean
    share_from_budget_detail: number
  }
  placementBasis: Record<string, number>
  assumptions: string[]
}

export type Production = {
  id: string
  title: string
  currency: string
  status: string
  counts: { periods: number; sections: number; lineItems: number; snapshots: number; importBatches: number }
}

export type ProductionSummary = {
  production: { id: string; title: string; currency: string; status: string }
  snapshot: null | {
    id: string
    name: string
    totalCtd: number | string | null
    totalCommitments: number | string | null
    grandTotal: number | string | null
    weeklyTotals: Array<{ label: string; amount: number; periodSequence: number; weekEndingDate?: string }>
    cumulativeTotals: Array<{ label: string; amount: number; periodSequence: number }>
    createdAt: string
  }
}

/** The config a human supplies. Defaults are deliberate — a draft appears before anything is asked. */
export type ProductionConfig = {
  shoot_start: string
  shoot_weeks: number
  prep_weeks: number
  wrap_weeks: number
  post_weeks: number
  shoot_days?: number
  hiatus_after_post_week?: number[]
  hiatus_weeks?: number
  rental_deposit_share?: number
  prefer_learned_profiles?: boolean
  payment_timing?: Record<string, { lag_days: number; note?: string }>
}

export const DEFAULT_CONFIG: ProductionConfig = {
  shoot_start: '',
  shoot_weeks: 5,
  prep_weeks: 7,
  wrap_weeks: 0,
  post_weeks: 16,
  shoot_days: 25,
  hiatus_after_post_week: [],
  hiatus_weeks: 0,
  rental_deposit_share: 0.35,
  prefer_learned_profiles: true,
  payment_timing: {
    labour: { lag_days: 7, note: 'payroll funded the week after work' },
    fringe: { lag_days: 21, note: 'statutory and union remittance' },
    vendor: { lag_days: 14, note: 'most spend settles inside two weeks' },
    prepaid: { lag_days: -14, note: 'premiums and deposits paid ahead' },
  },
}

export class ApiError extends Error {
  detail: unknown
  status: number
  constructor(message: string, status: number, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init)
  if (!response.ok) {
    let payload: any = null
    try { payload = await response.json() } catch { payload = await response.text().catch(() => null) }
    const message = payload?.error || payload?.detail || (typeof payload === 'string' ? payload : '') || `Request failed (${response.status})`
    throw new ApiError(typeof message === 'string' ? message : JSON.stringify(message), response.status, payload?.detail)
  }
  return response.json() as Promise<T>
}

export const api = {
  productions: () => request<Production[]>('/api/productions'),

  productionSummary: (id: string) => request<ProductionSummary>(`/api/productions/${id}/summary`),

  extractorHealth: () => request<{ extractor: { ok: boolean; url: string } }>('/api/budgets/health'),

  budget: (id: string) => request<BudgetSummary>(`/api/budgets/${id}`),

  uploadBudget(file: File, title?: string, productionId?: string) {
    const form = new FormData()
    form.append('budget', file)
    if (title) form.append('productionTitle', title)
    if (productionId) form.append('productionId', productionId)
    return request<BudgetUploadResult>('/api/budgets/upload', { method: 'POST', body: form })
  },

  generateCashflow: (id: string, config: ProductionConfig) =>
    request<CashflowResult>(`/api/budgets/${id}/generate/cashflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    }),

  /** Returns the workbook itself — the browser saves it. */
  async generateHotCost(id: string, config: ProductionConfig) {
    const response = await fetch(`${BASE}/api/budgets/${id}/generate/hotcost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new ApiError(payload?.error || `Generation failed (${response.status})`, response.status, payload?.detail)
    }
    return {
      blob: await response.blob(),
      crew: Number(response.headers.get('x-crew-count') || 0),
      daySheets: Number(response.headers.get('x-day-sheets') || 0),
    }
  },

  uploadWorkbook(file: File, productionId?: string, title?: string) {
    const form = new FormData()
    form.append('workbook', file)
    if (productionId) form.append('productionId', productionId)
    if (title) form.append('productionTitle', title)
    return request<{ ok: true; workbookType: string; result: Record<string, unknown> }>(
      '/api/imports/upload', { method: 'POST', body: form })
  },
}

export function money(value: number | string | null | undefined, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(Number(value || 0))
}
