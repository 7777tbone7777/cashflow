<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_CONFIG, api, auth, type User,
  type BudgetUploadResult, type CashflowResult, type Production,
  type ProductionConfig, type ProductionSummary,
} from './api'
import HowItWorks from './components/HowItWorks.vue'
import BudgetUpload from './components/BudgetUpload.vue'
import BudgetOverview from './components/BudgetOverview.vue'
import ProductionSetup from './components/ProductionSetup.vue'
import AccountantInputs from './components/AccountantInputs.vue'
import GeneratedDocuments from './components/GeneratedDocuments.vue'
import Adjustments from './components/Adjustments.vue'
import CashFlowGrid from './components/CashFlowGrid.vue'
import ImportExisting from './components/ImportExisting.vue'
import SignIn from './components/SignIn.vue'
import TeamPanel from './components/TeamPanel.vue'
import AccountPanel from './components/AccountPanel.vue'
import ShowAccess from './components/ShowAccess.vue'
import ShowSettings from './components/ShowSettings.vue'

const me = ref<User | null>(null)
const booting = ref(true)
const productions = ref<Production[]>([])
const selectedId = ref('')
const budget = ref<BudgetUploadResult | null>(null)
const summary = ref<ProductionSummary | null>(null)
const cashflow = ref<CashflowResult | null>(null)
const config = ref<ProductionConfig>({ ...DEFAULT_CONFIG })
const extractorUp = ref<boolean | null>(null)
const loading = ref(true)
const generating = ref(false)
const error = ref('')

const currency = computed(() => summary.value?.production.currency || 'USD')
// What this account may do with the selected show. A viewer gets the documents
// and the assumptions; the buttons that write are not theirs.
const selected = computed(() => productions.value.find((p) => p.id === selectedId.value) ?? null)
const role = computed(() => selected.value?.role ?? 'owner')
const showArchived = ref(false)
const canEdit = computed(() => role.value !== 'viewer')
const hasBudget = computed(() => Boolean(budget.value))

async function refreshProductions(selectId?: string) {
  productions.value = await api.productions(showArchived.value)
  if (selectId !== undefined) {
    selectedId.value = selectId
    return
  }
  // An empty selection is deliberate — it means "I am starting a new show" —
  // so only rescue a selection that pointed at something now gone.
  if (selectedId.value && !productions.value.some((p) => p.id === selectedId.value)) {
    selectedId.value = productions.value[0]?.id ?? ''
  }
}

/** Archive, delete and transfer all change the list and possibly the selection. */
async function onShowChanged(selectId?: string) {
  await refreshProductions(selectId)
  if (selectedId.value) await loadProduction(selectedId.value)
  else { budget.value = null; summary.value = null; cashflow.value = null }
}

/** Take what the budget already stated so nobody types it twice. */
function applyPrefill(result: BudgetUploadResult) {
  const calendar = result.inputsRequired.find((q) => q.key === 'calendar')?.prefill as
    Record<string, unknown> | undefined
  if (!calendar) return
  const next = { ...config.value }
  const start = String(calendar.shoot_start || '')
  const parsed = start ? new Date(start.replace(/\./g, ' ')) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    next.shoot_start = parsed.toISOString().slice(0, 10)
  }
  if (calendar.shoot_days) {
    next.shoot_days = Number(calendar.shoot_days)
    next.shoot_weeks = Math.max(1, Math.ceil(Number(calendar.shoot_days) / 5))
  }
  if (calendar.post_weeks) next.post_weeks = Number(calendar.post_weeks)
  config.value = next
}

async function loadProduction(id: string) {
  if (!id) return
  summary.value = await api.productionSummary(id).catch(() => null)
  try {
    const stored = await api.budget(id)
    // Reshape the stored extract into the same view a fresh upload gives, so a
    // reloaded page looks identical to one that has just been uploaded.
    const restored: BudgetUploadResult = {
      ok: true,
      productionId: id,
      importBatchId: '',
      productionType: (stored.production as any)?.production_type
        || { type: 'unknown', confidence: 0, evidence: [], counter_evidence: [] },
      grandTotal: Number(stored.totals?.grand_total || 0),
      accounts: stored.accountCount,
      departments: stored.topsheet?.length || 0,
      inputsRequired: stored.inputsRequired || [],
      warnings: stored.warnings || [],
    }
    budget.value = restored
    applyPrefill(restored)
  } catch {
    budget.value = null
  }
}

async function onUploaded(result: BudgetUploadResult) {
  budget.value = result
  cashflow.value = null
  applyPrefill(result)
  await refreshProductions(result.productionId)
}

async function generate() {
  if (!selectedId.value) return
  generating.value = true
  error.value = ''
  try {
    cashflow.value = await api.generateCashflow(selectedId.value, config.value)
    summary.value = await api.productionSummary(selectedId.value)
    await refreshProductions(selectedId.value)
  } catch (caught: any) {
    error.value = caught.message || 'Could not generate the cash flow.'
  } finally {
    generating.value = false
  }
}

watch(selectedId, async (id) => {
  cashflow.value = null
  if (!id) {
    // Nothing should be on screen from the last show while a new one is set up.
    budget.value = null
    summary.value = null
    config.value = { ...DEFAULT_CONFIG }
    return
  }
  await loadProduction(id)
})

/** Everything on this page belongs to one account, so nothing loads until we know which. */
async function loadWorkspace() {
  loading.value = true
  try {
    await refreshProductions()
    // Open on a show if there is one; a new account opens ready to upload.
    if (!selectedId.value && productions.value.length) {
      selectedId.value = productions.value[0].id
    }
    if (selectedId.value) await loadProduction(selectedId.value)
    extractorUp.value = (await api.extractorHealth()).extractor.ok
  } catch (caught: any) {
    error.value = caught.message || 'Could not reach the API.'
  } finally {
    loading.value = false
  }
}

async function onSignedIn(user: User) {
  me.value = user
  // Drop the invite token from the address bar — it is spent, and it is a
  // credential that should not sit in history or get pasted along with the URL.
  window.history.replaceState({}, '', window.location.pathname)
  await loadWorkspace()
}

async function onSignedOut() {
  me.value = null
  productions.value = []
  selectedId.value = ''
  budget.value = null
  summary.value = null
  cashflow.value = null
}

async function signOut() {
  await auth.logout().catch(() => {})
  me.value = null
  productions.value = []
  selectedId.value = ''
  budget.value = null
  summary.value = null
  cashflow.value = null
}

onMounted(async () => {
  try {
    me.value = (await auth.me()).user
  } catch {
    me.value = null
  } finally {
    booting.value = false
  }
  if (me.value) await loadWorkspace()
})
</script>

<template>
  <p v-if="booting" class="banner boot">Loading…</p>

  <SignIn v-else-if="!me" @signed-in="onSignedIn" />

  <main v-else class="shell">
    <header class="masthead">
      <div>
        <p class="eyebrow">Cashflow</p>
        <h1>Budget in, documents out</h1>
      </div>
      <div class="header-actions">
        <label v-if="productions.length" class="picker">
          <span>Production</span>
          <select v-model="selectedId">
            <option v-for="production in productions" :key="production.id" :value="production.id">
              {{ production.title }}{{ production.archivedAt ? ' (archived)' : '' }}
            </option>
            <option value="">＋ New production…</option>
          </select>
        </label>
        <label class="toggle">
          <input type="checkbox" v-model="showArchived" @change="refreshProductions(selectedId)" />
          <span>Show archived</span>
        </label>
        <span v-if="extractorUp === false" class="badge warn">Extractor unreachable</span>
        <span class="who">
          {{ me.name || me.email }}
          <button class="link" type="button" @click="signOut">Sign out</button>
        </span>
      </div>
    </header>

    <p v-if="error" class="banner error">{{ error }}</p>

    <template v-if="!loading">
      <HowItWorks
        :has-budget="hasBudget"
        :has-cashflow="Boolean(cashflow)"
        :inputs-required="budget?.inputsRequired ?? []"
        :currency="currency" />

      <BudgetUpload v-if="canEdit" :selected-id="selectedId"
                    :selected-title="selected?.title ?? ''" @uploaded="onUploaded" />

      <template v-if="hasBudget && budget">
        <BudgetOverview :budget="budget" :currency="currency" />

        <AccountantInputs
          v-if="canEdit"
          :config="config"
          :inputs-required="budget.inputsRequired"
          :currency="currency"
          @update:config="config = $event" />

        <ProductionSetup
          v-if="canEdit"
          :config="config"
          :inputs-required="budget.inputsRequired"
          :busy="generating"
          @update:config="config = $event"
          @generate="generate" />

        <p v-else class="banner">
          You have read-only access to this show. You can see everything that has been generated;
          only an editor can upload a budget or regenerate the documents.
        </p>

        <Adjustments
          :production-id="selectedId"
          :currency="currency"
          :can-edit="canEdit"
          :cashflow="cashflow" />

        <GeneratedDocuments
          :production-id="selectedId"
          :config="config"
          :cashflow="cashflow"
          :currency="currency" />

        <CashFlowGrid :summary="summary" :currency="currency" />
      </template>

      <ShowAccess v-if="selectedId" :production-id="selectedId" :role="role" />

      <ShowSettings v-if="selected && role === 'owner'" :production="selected"
                    @changed="onShowChanged" />

      <ImportExisting v-if="canEdit" :production-id="selectedId || null"
                      @imported="refreshProductions(selectedId)" />

      <TeamPanel />

      <AccountPanel :user="me" @signed-out="onSignedOut" />
    </template>

    <p v-else class="banner">Loading…</p>
  </main>
</template>

<style>
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --surface-2: #1c2430;
  --rule: #2a3441;
  --accent: #4b9fea;
  --accent-border: #2f6ea8;
  --text: #e6edf3;
  --muted: #8b949e;
  --ok-fg: #52c07a;
  --warn-bg: #2b2313;
  --warn-border: #5a4718;
  --error-bg: #2b1616;
  --error-fg: #f08a7f;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  line-height: 1.55;
}
.shell { max-width: 1080px; margin: 0 auto; padding: 40px 24px 96px; display: flex; flex-direction: column; gap: 24px; }
.masthead { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap; }
.eyebrow { color: var(--accent); letter-spacing: 0.18em; text-transform: uppercase; font-size: 0.7rem; margin: 0 0 6px; }
.masthead h1 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.4rem); letter-spacing: -0.02em; }
.header-actions { display: flex; gap: 12px; align-items: center; }
.picker { display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.panel { background: var(--surface); border: 1px solid var(--rule); border-radius: 12px; padding: 24px; }
.panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
.panel-header h2 { margin: 0 0 8px; font-size: 1.15rem; }
.panel-header p { margin: 0; color: var(--muted); font-size: 0.89rem; max-width: 72ch; }
.pill { background: var(--surface-2); color: var(--muted); border-radius: 999px; padding: 4px 12px; font-size: 0.74rem; white-space: nowrap; }
input, select, button { font: inherit; }
input, select {
  background: var(--surface-2); border: 1px solid var(--rule); color: var(--text);
  border-radius: 8px; padding: 9px 11px;
}
input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.primary-button, .secondary-button {
  border-radius: 8px; padding: 10px 18px; cursor: pointer; border: 1px solid transparent;
}
.primary-button { background: var(--accent); color: #06121e; font-weight: 600; }
.primary-button:disabled { opacity: 0.45; cursor: not-allowed; }
.secondary-button { background: transparent; border-color: var(--rule); color: var(--text); }
.secondary-button:disabled { opacity: 0.45; cursor: not-allowed; }
.banner { padding: 14px 16px; border-radius: 10px; background: var(--surface); color: var(--muted); margin: 0; }
.banner.error { background: var(--error-bg); color: var(--error-fg); }
.badge { padding: 5px 10px; border-radius: 999px; font-size: 0.75rem; }
.badge.warn { background: var(--warn-bg); color: #d9b45c; }
.toggle { display: flex; gap: 6px; align-items: center; color: var(--muted); font-size: 0.75rem; }
.who { color: var(--muted); font-size: 0.8rem; display: flex; gap: 10px; align-items: center; }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; font: inherit; font-size: 0.8rem; }
.boot { max-width: 1080px; margin: 40px auto; }
</style>
