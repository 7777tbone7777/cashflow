<script setup lang="ts">
import { money, type ProductionSummary } from '../api'

defineProps<{ summary: ProductionSummary | null; currency: string }>()
</script>

<template>
  <section class="panel" v-if="summary?.snapshot">
    <div class="panel-header">
      <div>
        <h2>Weekly cash flow</h2>
        <p>What needs to be in the account each week, and the running total drawn against it.</p>
      </div>
      <span class="pill">{{ summary.snapshot.weeklyTotals.length }} periods</span>
    </div>

    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>Period</th><th>Week ending</th><th class="num">Weekly</th><th class="num">Cumulative</th></tr>
        </thead>
        <tbody>
          <tr v-for="(period, index) in summary.snapshot.weeklyTotals" :key="period.periodSequence">
            <td>{{ period.label }}</td>
            <td class="dim">{{ period.weekEndingDate || '—' }}</td>
            <td class="num">{{ money(period.amount, currency) }}</td>
            <td class="num">{{ money(summary.snapshot.cumulativeTotals[index]?.amount, currency) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--rule); }
th { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.dim { color: var(--muted); }
</style>
