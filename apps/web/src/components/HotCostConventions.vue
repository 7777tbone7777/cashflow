<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { adjustments, type HotCostConventions, type ProductionConfig, type Target } from '../api'

/**
 * How a crew day is priced in prep against shoot.
 *
 * The budget already states this per person and the generator already reads it —
 * on the reference budget 73 of 122 crew cost a different amount on a prep day
 * than on a shoot day, and carrying one figure per person would be wrong on
 * every prep day while still totalling plausibly.
 *
 * What is *not* in any budget is the handful of conventions an accountant
 * applies on top. They live here rather than in code because they are checkable
 * claims about how a production runs, and the right answer differs by show:
 * including Set Lighting in the rigging list dropped prep accuracy from 96% to
 * 89% on the reference production.
 */
const props = defineProps<{ productionId: string; config: ProductionConfig }>()
const emit = defineEmits<{ (e: 'update:config', value: ProductionConfig): void }>()

const departments = ref<Target[]>([])

const conventions = computed<HotCostConventions>(() => props.config.hot_cost_conventions ?? {
  flat_rate_bills_shoot_day: true,
  minimum_prep_units: 11,
  preshoot_at_shoot_hours: [],
})

function set<K extends keyof HotCostConventions>(key: K, value: HotCostConventions[K]) {
  emit('update:config', {
    ...props.config,
    hot_cost_conventions: { ...conventions.value, [key]: value },
  })
}

function toggleDepartment(acct: string, on: boolean) {
  const current = new Set(conventions.value.preshoot_at_shoot_hours)
  if (on) current.add(acct)
  else current.delete(acct)
  set('preshoot_at_shoot_hours', [...current].sort())
}

watch(() => props.productionId, async (id) => {
  if (!id) return
  try {
    departments.value = (await adjustments.targets(id)).departments
  } catch {
    departments.value = []
  }
}, { immediate: true })

// The rigging crafts are the plausible candidates; the rest would be noise.
const candidates = computed(() =>
  departments.value.filter((d) => Number(d.key) >= 2200 && Number(d.key) < 3500))
</script>

<template>
  <details class="panel">
    <summary>Prep days against shoot days — how crew are priced</summary>

    <p class="explain">
      Most of this is already read from the budget and needs nothing from you. A crew member does
      not cost the same in prep as in shoot — the budget states guaranteed hours and sometimes a
      different rate per phase, and the day sheets follow it person by person. On the reference
      production <strong>73 of 122 crew</strong> cost a different amount on a prep day.
    </p>
    <p class="explain">
      Three things no budget states, applied on top. They are house practice, not fact, so they are
      shown rather than buried — change them if your show works differently.
    </p>

    <div class="convention">
      <label class="check">
        <input type="checkbox" :checked="conventions.flat_rate_bills_shoot_day"
               @change="set('flat_rate_bills_shoot_day', ($event.target as HTMLInputElement).checked)" />
        <span>Weekly flat-rate crew bill their shoot rate on prep days</span>
      </label>
      <p class="why">
        DGA, designers and other weekly deals. The budget's lower prep figure is a budgeting
        device rather than a timecard rate. Turn this off if your flat crew genuinely bill less
        in prep.
      </p>
    </div>

    <div class="convention">
      <label class="units">
        <span>Minimum prep units for hourly crew</span>
        <input type="number" step="0.5" min="0" max="24"
               :value="conventions.minimum_prep_units"
               @input="set('minimum_prep_units', Number(($event.target as HTMLInputElement).value))" />
      </label>
      <p class="why">
        Hourly crew get a standard prep day rather than whatever fractional guarantee the budget
        carries. <strong>{{ conventions.minimum_prep_units }} units</strong> is a
        {{ Math.max(0, conventions.minimum_prep_units - 1) }}-hour day with the usual overtime
        step. Units rather than dollars, so it scales with each person's rate.
      </p>
    </div>

    <div class="convention">
      <span class="label">Departments that rig on the preshoot day, and so work shoot hours</span>
      <p class="why">
        A rigging day is a scheduling decision no budget states. Getting this wrong is measurable:
        adding Set Lighting on the reference show dropped prep-day accuracy from 96% to 89%.
      </p>
      <div class="departments" v-if="candidates.length">
        <label v-for="d in candidates" :key="d.key" class="check">
          <input type="checkbox"
                 :checked="conventions.preshoot_at_shoot_hours.includes(d.key)"
                 @change="toggleDepartment(d.key, ($event.target as HTMLInputElement).checked)" />
          <span>{{ d.key }} {{ d.name }}</span>
        </label>
      </div>
      <p v-else class="why">Upload a budget to choose from its departments.</p>
    </div>

    <p class="explain footnote">
      These apply when you download the hot cost. The cash flow is unaffected — it works from the
      budget's own totals, not from day sheets.
    </p>
  </details>
</template>

<style scoped>
summary { cursor: pointer; font-weight: 600; }
.explain { color: var(--muted); font-size: 0.86rem; max-width: 78ch; }
.explain strong { color: var(--text); }
.convention { border-top: 1px solid var(--rule); padding-top: 14px; margin-top: 14px; }
.check { display: flex; gap: 9px; align-items: flex-start; cursor: pointer; font-size: 0.9rem; }
.units { display: flex; gap: 12px; align-items: center; font-size: 0.9rem; }
.units input { width: 90px; }
.label { font-size: 0.9rem; }
.why { color: var(--muted); font-size: 0.82rem; max-width: 78ch; margin: 6px 0 0; }
.why strong { color: var(--text); }
.departments {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 8px; margin-top: 12px; padding: 12px; background: var(--surface-2); border-radius: 8px;
}
.departments .check { font-size: 0.82rem; align-items: center; }
.footnote { margin-top: 16px; }
</style>
