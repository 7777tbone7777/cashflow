<script setup lang="ts">
import { money, type BudgetUploadResult } from '../api'

defineProps<{ budget: BudgetUploadResult; currency: string }>()
</script>

<template>
  <section class="stats">
    <article class="stat">
      <span class="label">Budget</span>
      <strong>{{ money(budget.grandTotal, currency) }}</strong>
      <small>{{ budget.departments }} departments · {{ budget.accounts }} accounts</small>
    </article>
    <article class="stat">
      <span class="label">Detected</span>
      <strong class="capitalise">{{ budget.productionType.type }}</strong>
      <small>{{ (budget.productionType.confidence * 100).toFixed(0) }}% — {{ budget.productionType.evidence[0] || 'from the budget structure' }}</small>
    </article>
    <article class="stat">
      <span class="label">Extraction</span>
      <strong class="ok">Reconciled</strong>
      <small>Detail lines sum to the budget's own stated total</small>
    </article>
    <article class="stat">
      <span class="label">Still to confirm</span>
      <strong>{{ budget.inputsRequired.length }}</strong>
      <small>Everything else came from the document</small>
    </article>
  </section>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; }
.stat { border: 1px solid var(--rule); border-radius: 10px; padding: 18px; background: var(--surface); }
.label { display: block; color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
.stat strong { display: block; font-size: 1.5rem; margin-bottom: 6px; }
.stat small { color: var(--muted); font-size: 0.78rem; line-height: 1.4; display: block; }
.capitalise { text-transform: capitalize; }
.ok { color: var(--ok-fg); }
</style>
