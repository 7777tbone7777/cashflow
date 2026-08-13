<script setup lang="ts">
import { ref } from 'vue'
import { api, money, type CashflowResult, type ProductionConfig } from '../api'

const props = defineProps<{
  productionId: string
  config: ProductionConfig
  cashflow: CashflowResult | null
  currency: string
}>()

const busy = ref(false)
const error = ref('')
const generated = ref<{ crew: number; daySheets: number } | null>(null)
const showAssumptions = ref(false)

async function downloadHotCost() {
  busy.value = true
  error.value = ''
  try {
    const { blob, crew, daySheets } = await api.generateHotCost(props.productionId, props.config)
    generated.value = { crew, daySheets }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'hot-cost.xlsx'
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (caught: any) {
    error.value = caught.message || 'Could not generate the hot cost.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="panel">
    <div class="panel-header">
      <div>
        <h2>Documents</h2>
        <p>Both are generated from the budget. Neither is a template to fill in from scratch.</p>
      </div>
    </div>

    <div class="documents">
      <article class="document">
        <h3>Hot cost day sheets</h3>
        <p>
          One sheet per shoot day, pre-populated with the crew, their rates and the budgeted day
          cost <em>for that day's phase</em> — prep and shoot are different numbers for the same
          person. On the day, enter call, lunch and wrap; everything else computes.
        </p>
        <p class="detail">
          Includes a department summary and a weekly roll-up, both live formulas.
        </p>
        <button class="primary-button" type="button" :disabled="busy" @click="downloadHotCost">
          {{ busy ? 'Generating…' : 'Download workbook' }}
        </button>
        <p v-if="generated" class="ok">
          {{ generated.crew }} crew across {{ generated.daySheets }} day sheets.
        </p>
      </article>

      <article class="document">
        <h3>Weekly cash flow</h3>
        <template v-if="cashflow">
          <p>
            {{ cashflow.periods }} periods, reconciled to the budget.
            <strong>{{ money(cashflow.reconciliation.total_placed, currency) }}</strong> placed
            against a budget of
            {{ money(cashflow.reconciliation.budget_grand_total, currency) }}.
          </p>
          <p class="detail">
            {{ (cashflow.reconciliation.share_from_budget_detail * 100).toFixed(0) }}% placed from
            the budget's own phase detail; the rest shaped by observed spreads and reported below.
          </p>
          <button class="secondary-button" type="button"
                  @click="showAssumptions = !showAssumptions">
            {{ showAssumptions ? 'Hide' : 'Show' }} {{ cashflow.assumptions.length }} assumptions
          </button>
        </template>
        <p v-else class="detail">Generated alongside the hot cost. Confirm the schedule first.</p>
      </article>
    </div>

    <div v-if="showAssumptions && cashflow" class="assumptions">
      <p class="explain">
        Every placement the generator could not take straight from the budget. An assumption you
        can see is one you can argue with.
      </p>
      <ul>
        <li v-for="(note, index) in cashflow.assumptions" :key="index">{{ note }}</li>
      </ul>
    </div>

    <p v-if="error" class="inline-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.documents { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
.document { border: 1px solid var(--rule); border-radius: 10px; padding: 20px; }
.document h3 { margin: 0 0 10px; font-size: 1.05rem; }
.document p { font-size: 0.9rem; margin: 0 0 12px; }
.detail { color: var(--muted); font-size: 0.85rem !important; }
.ok { color: var(--ok-fg); font-size: 0.85rem !important; margin-top: 10px !important; }
.assumptions {
  margin-top: 20px; padding: 16px 18px; border-radius: 8px; background: var(--surface-2);
  max-height: 320px; overflow-y: auto;
}
.assumptions ul { margin: 10px 0 0; padding-left: 1.1em; }
.assumptions li { font-size: 0.84rem; margin-bottom: 8px; color: var(--muted); }
.explain { color: var(--muted); font-size: 0.86rem; margin: 0; }
.inline-error {
  margin-top: 16px; padding: 12px 14px; border-radius: 8px;
  background: var(--error-bg); color: var(--error-fg); font-size: 0.88rem;
}
</style>
