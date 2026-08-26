const BASE = import.meta.env.VITE_API_BASE_URL || ''

export type ProductionType = {
  type: 'feature' | 'television' | 'unknown'
  confidence: number
  evidence: string[]
  counter_evidence: string[]
}

export type UnbackedLine = {
  acct: string
  name_display: string
  amount: number
  states_percentage: boolean
}

export type MilestoneCandidate = {
  acct: string
  account_name: string
  person: string | null
  description: string
  amount: number
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
  /** What the answer is worth, in dollars. Present on the asks that move the number. */
  amount_at_stake?: number
  /** Top sheet lines with no detail behind them — `unbacked_lines`. */
  lines?: UnbackedLine[]
  answer_format?: Record<string, unknown>
  departments_available?: Array<{ acct: string; name: string }>
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

export type OverrideFieldSpec = {
  label: string
  help: string
  type: 'number' | 'choice'
  unit?: string
  choices?: string[]
  scopes: Array<'department' | 'account'>
}

export type Adjustment = {
  id: string
  field: string
  value: number | string
  scope: 'department' | 'account'
  key: string
  kind: 'redistribute' | 'amend'
  origin: 'judgement' | 'correction'
  reason: string
  author: string | null
  createdAt: string
}

export type Target = { key: string; name: string; total: number; department?: string }

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
  overrides: null | {
    loaded: number
    applied: Record<string, number>
    /** "field|scope|key" for each adjustment that actually changed something. */
    applied_targets: string[]
    /** Target exists, but nothing ever read this field for it — it did nothing. */
    inert: string[]
    orphaned: string[]
    amendments_not_applied: string[]
  }
}

export type ProductionRole = 'owner' | 'editor' | 'viewer'

export type Member = {
  id: string
  role: ProductionRole
  createdAt: string
  user: { id: string; email: string; name: string | null } | null
}

export type MemberList = {
  yourRole: ProductionRole
  owner: { id: string; email: string; name: string | null } | null
  members: Member[]
  pending: Array<{ id: string; email: string; role: ProductionRole; expiresAt: string }>
}

export type Production = {
  id: string
  title: string
  currency: string
  status: string
  role: ProductionRole
  archivedAt: string | null
  counts: { periods: number; sections: number; lineItems: number; snapshots: number; importBatches: number }
}

export type ProductionSummary = {
  production: { id: string; title: string; currency: string; status: string; role: ProductionRole }
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

/**
 * House conventions for the hot cost — three things an accountant applies that
 * no budget states. Defaults mirror the engine's own, and each is a checkable
 * claim about how a production runs rather than a preference.
 */
export type HotCostConventions = {
  flat_rate_bills_shoot_day: boolean
  minimum_prep_units: number
  preshoot_at_shoot_hours: string[]
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
  /** Per-department settlement cycles, keyed by department account. */
  department_lags?: Record<string, number>
  /** Instalment dates for top sheet lines the detail pages never carried. */
  unbacked_line_schedule?: Record<string, Array<{ pay_on: string; share: number }>>
  /** Payments the budget prices but ties to an event rather than a week. */
  milestones?: Array<{ acct: string; description?: string; pay_on: string }>
  hot_cost_conventions?: HotCostConventions
  /** Last post week as a share of the first. 1 is a flat line across post. */
  post_taper?: number
  /** First prep week as a share of the last. 1 is a flat line across prep. */
  prep_ramp?: number
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
  department_lags: {},
  unbacked_line_schedule: {},
  milestones: [],
  // Mirrors DEFAULT_CONVENTIONS in the generator. Changing them here changes
  // the day sheets; they are stated rather than buried so they can be argued with.
  post_taper: 0.5,
  prep_ramp: 0.05,
  hot_cost_conventions: {
    flat_rate_bills_shoot_day: true,
    minimum_prep_units: 11,
    preshoot_at_shoot_hours: ['2500', '2700', '2800'],
  },
}

/** What the extractor receives — the form's shape, flattened the way it reads it. */
export type GeneratorConfig = Omit<ProductionConfig, 'payment_timing' | 'department_lags'> & {
  payment_timing?: Record<string, unknown>
}

/**
 * The generator reads per-department lags from inside `payment_timing`. The form
 * keeps them in their own field because that is how a person thinks about them.
 */
export function forGenerator(config: ProductionConfig): GeneratorConfig {
  const { department_lags, payment_timing, ...rest } = config
  const hasLags = department_lags && Object.keys(department_lags).length > 0
  return {
    ...rest,
    payment_timing: hasLags
      ? { ...payment_timing, departments: department_lags }
      : payment_timing,
  }
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
  // The session lives in an httpOnly cookie, which fetch will not send to
  // another origin unless asked — and in development the SPA is on another one.
  const response = await fetch(`${BASE}${path}`, { credentials: 'include', ...init })
  if (!response.ok) {
    let payload: any = null
    try { payload = await response.json() } catch { payload = await response.text().catch(() => null) }
    const message = payload?.error || payload?.detail || (typeof payload === 'string' ? payload : '') || `Request failed (${response.status})`
    throw new ApiError(typeof message === 'string' ? message : JSON.stringify(message), response.status, payload?.detail)
  }
  return response.json() as Promise<T>
}

export type User = { id: string; email: string; name: string | null; createdAt: string }

export type Invite = {
  id: string
  email: string
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
}

export const auth = {
  state: () => request<{ needsFirstUser: boolean }>('/api/auth/state'),
  emailStatus: () => request<{ configured: boolean }>('/api/auth/email-status'),
  forgot: (email: string) =>
    request<{ ok: true; message: string }>('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  reset: (token: string, password: string) =>
    request<{ user: User }>('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }),
  me: () => request<{ user: User | null }>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  register: (body: { email: string; password: string; name?: string; inviteToken?: string }) =>
    request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true; otherSessionsEnded: true }>('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  logoutEverywhere: () => request<{ ok: true }>('/api/auth/logout-all', { method: 'POST' }),
  blockers: () => request<{
    canDelete: boolean
    owned: Array<{ id: string; title: string; archivedAt: string | null; sharedWith: number }>
  }>('/api/auth/account/blockers'),
  deleteAccount: (password: string) =>
    request<{ ok: true }>('/api/auth/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
}

export const adjustments = {
  fields: (productionId: string) =>
    request<{ fields: Record<string, OverrideFieldSpec> }>(
      `/api/budgets/${productionId}/overrides/fields`),
  targets: (productionId: string) =>
    request<{ departments: Target[]; accounts: Target[] }>(
      `/api/budgets/${productionId}/targets`),
  list: (productionId: string) =>
    request<Adjustment[]>(`/api/budgets/${productionId}/overrides`),
  add: (productionId: string, body: {
    field: string; value: number | string; scope: string; key: string;
    reason: string; origin?: 'judgement' | 'correction'
  }) =>
    request<Adjustment>(`/api/budgets/${productionId}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  remove: (productionId: string, id: string) =>
    request<{ ok: true }>(`/api/budgets/${productionId}/overrides/${id}`,
      { method: 'DELETE' }),
}

export const shows = {
  archive: (id: string) =>
    request<{ id: string; archivedAt: string }>(`/api/productions/${id}/archive`,
      { method: 'POST' }),
  unarchive: (id: string) =>
    request<{ id: string; archivedAt: null }>(`/api/productions/${id}/unarchive`,
      { method: 'POST' }),
  /** Irreversible. The title is required as proof this is the intended show. */
  remove: (id: string, confirmTitle: string) =>
    request<{ ok: true; deleted: string }>(`/api/productions/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmTitle }),
    }),
  transfer: (id: string, email: string) =>
    request<{ ok: true; owner: { email: string; name: string | null }; yourRoleNow: string }>(
      `/api/productions/${id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
}

export const members = {
  list: (productionId: string) =>
    request<MemberList>(`/api/productions/${productionId}/members`),
  add: (productionId: string, email: string, role: 'editor' | 'viewer') =>
    request<{ member?: Member; invited: boolean; link?: string;
      emailed?: boolean; emailError?: string | null }>(
      `/api/productions/${productionId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      }),
  setRole: (productionId: string, memberId: string, role: 'editor' | 'viewer') =>
    request<Member>(`/api/productions/${productionId}/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }),
  remove: (productionId: string, memberId: string) =>
    request<{ ok: true }>(`/api/productions/${productionId}/members/${memberId}`,
      { method: 'DELETE' }),
  cancelPending: (productionId: string, inviteId: string) =>
    request<{ ok: true }>(`/api/productions/${productionId}/members/pending/${inviteId}`,
      { method: 'DELETE' }),
}

export const invites = {
  list: () => request<Invite[]>('/api/invites'),
  create: (email: string) =>
    request<{ invite: Invite; link: string; emailed: boolean; emailError: string | null }>(
      '/api/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  revoke: (id: string) => request<Invite>(`/api/invites/${id}/revoke`, { method: 'POST' }),
}

export const api = {
  productions: (includeArchived = false) =>
    request<Production[]>(`/api/productions${includeArchived ? '?archived=true' : ''}`),

  productionSummary: (id: string) => request<ProductionSummary>(`/api/productions/${id}/summary`),

  /** The show's standing assumptions. `null` means nobody has saved any yet. */
  productionConfig: (id: string) =>
    request<{ config: ProductionConfig | null; savedAt: string }>(
      `/api/productions/${id}/config`),

  /**
   * `keepalive` is for the save sent as the page is closing — it lets the
   * request outlive the document instead of being cancelled with it.
   */
  saveProductionConfig: (id: string, config: ProductionConfig, keepalive = false) =>
    request<{ config: ProductionConfig; savedAt: string }>(`/api/productions/${id}/config`, {
      method: 'PUT',
      keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    }),

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
      body: JSON.stringify({ config: forGenerator(config) }),
    }),

  /**
   * Returns the workbook itself — the browser saves it. This is the one call
   * that cannot go through `request`, which parses JSON; it still needs the
   * session cookie, and in development the SPA is on another origin.
   */
  async generateHotCost(id: string, config: ProductionConfig) {
    const response = await fetch(`${BASE}/api/budgets/${id}/generate/hotcost`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: forGenerator(config) }),
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
