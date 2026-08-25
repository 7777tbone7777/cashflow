<script setup lang="ts">
import { computed } from 'vue'
import type { InputRequired, MilestoneCandidate, ProductionConfig, UnbackedLine } from '../api'
import { money } from '../api'

/**
 * The questions only a production accountant can answer.
 *
 * Separated from the calendar because they are a different kind of ask. The
 * calendar is confirmation — the budget already said it. These are knowledge the
 * document does not contain at all, and each one is shown with the money it
 * governs, because "what is this worth if I get it right" is the only fair basis
 * for deciding whether to go and find out.
 */
const props = defineProps<{
  config: ProductionConfig
  inputsRequired: InputRequired[]
  currency: string
}>()

const emit = defineEmits<{ (e: 'update:config', value: ProductionConfig): void }>()

function set<K extends keyof ProductionConfig>(key: K, value: ProductionConfig[K]) {
  emit('update:config', { ...props.config, [key]: value })
}

const ask = (key: string) => props.inputsRequired.find((q) => q.key === key)

const unbacked = computed(() => ask('unbacked_lines'))
const unbackedLines = computed<UnbackedLine[]>(() => unbacked.value?.lines ?? [])

const milestoneAsk = computed(() => ask('milestone_payments'))
// Only the ones big enough to be worth a person's attention.
const milestoneCandidates = computed<MilestoneCandidate[]>(() =>
  ((milestoneAsk.value?.examples ?? []) as MilestoneCandidate[]).filter((m) => m.amount >= 1000))

const departments = computed(() => ask('payment_timing')?.departments_available ?? [])

const totalAtStake = computed(() =>
  props.inputsRequired.reduce((sum, q) => sum + (q.amount_at_stake ?? 0), 0))

function scheduleFor(acct: string) {
  return props.config.unbacked_line_schedule?.[acct] ?? [{ pay_on: '', share: 1 }]
}

function setInstalment(acct: string, index: number, patch: Partial<{ pay_on: string; share: number }>) {
  const current = [...scheduleFor(acct)]
  current[index] = { ...current[index], ...patch }
  set('unbacked_line_schedule', { ...props.config.unbacked_line_schedule, [acct]: current })
}

function addInstalment(acct: string) {
  set('unbacked_line_schedule', {
    ...props.config.unbacked_line_schedule,
    [acct]: [...scheduleFor(acct), { pay_on: '', share: 0 }],
  })
}

function milestoneDate(acct: string, description: string) {
  return props.config.milestones?.find(
    (m) => m.acct === acct && m.description === description)?.pay_on ?? ''
}

function setMilestone(acct: string, description: string, pay_on: string) {
  const others = (props.config.milestones ?? []).filter(
    (m) => !(m.acct === acct && m.description === description))
  set('milestones', pay_on ? [...others, { acct, description, pay_on }] : others)
}

function setDepartmentLag(acct: string, value: string) {
  const next = { ...props.config.department_lags }
  if (value === '') delete next[acct]
  else next[acct] = Number(value)
  set('department_lags', next)
}
</script>

<template>
  <section class="panel" v-if="unbacked || milestoneAsk || departments.length">
    <div class="panel-header">
      <div>
        <h2>What only you can answer</h2>
        <p>
          The budget prices this money but never says when it moves. Every answer here changes
          when cash leaves, never how much — the schedule is checked against the budget total
          either way. Leave any of it blank and the generator falls back to a department
          archetype and says so in its assumptions.
        </p>
      </div>
      <span class="pill" v-if="totalAtStake">{{ money(totalAtStake, currency) }} at stake</span>
    </div>

    <!-- Top sheet lines with no detail behind them: premiums, bond fees. -->
    <div v-if="unbackedLines.length" class="ask">
      <h3>
        Payment schedule
        <span class="stake">{{ money(unbacked?.amount_at_stake, currency) }}</span>
      </h3>
      <p class="explain">{{ unbacked?.why }}</p>
      <div v-for="line in unbackedLines" :key="line.acct" class="line">
        <div class="line-head">
          <strong>{{ line.acct }} {{ line.name_display }}</strong>
          <span>{{ money(line.amount, currency) }}</span>
        </div>
        <div class="instalments">
          <label v-for="(instalment, index) in scheduleFor(line.acct)" :key="index">
            <span>Pays</span>
            <input type="date" :value="instalment.pay_on"
                   @change="setInstalment(line.acct, index, { pay_on: ($event.target as HTMLInputElement).value })" />
            <input type="number" step="0.05" min="0" max="1" :value="instalment.share"
                   :aria-label="`Share of ${line.name_display} paid on this date`"
                   @input="setInstalment(line.acct, index, { share: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <button class="secondary-button small" type="button" @click="addInstalment(line.acct)">
            Add instalment
          </button>
        </div>
      </div>
    </div>

    <!-- Payments the budget ties to an event rather than a week. -->
    <div v-if="milestoneCandidates.length" class="ask">
      <h3>
        Payments tied to an event
        <span class="stake">{{ money(milestoneAsk?.amount_at_stake, currency) }}</span>
      </h3>
      <p class="explain">{{ milestoneAsk?.why }}</p>
      <div v-for="candidate in milestoneCandidates" :key="candidate.acct + candidate.description"
           class="line">
        <div class="line-head">
          <strong>{{ candidate.acct }} {{ candidate.description }}</strong>
          <span>{{ money(candidate.amount, currency) }}</span>
        </div>
        <label class="inline">
          <span>Pays</span>
          <input type="date" :value="milestoneDate(candidate.acct, candidate.description)"
                 @change="setMilestone(candidate.acct, candidate.description, ($event.target as HTMLInputElement).value)" />
        </label>
        <small v-if="candidate.person">{{ candidate.person }} · {{ candidate.account_name }}</small>
      </div>
    </div>

    <!-- Departments that settle on their own cycle. -->
    <details class="ask" v-if="departments.length">
      <summary>Departments that pay on their own cycle</summary>
      <p class="explain">
        Overrides the default payroll and vendor lag for one department. Measured against a real
        production this was the single highest-leverage answer on the page, and the right value
        differed between two productions — which is why it is asked rather than assumed.
      </p>
      <div class="dept-grid">
        <label v-for="department in departments" :key="department.acct">
          <span>{{ department.acct }} {{ department.name }}</span>
          <input type="number" placeholder="default" :value="config.department_lags?.[department.acct] ?? ''"
                 @input="setDepartmentLag(department.acct, ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </details>
  </section>
</template>

<style scoped>
.ask { border-top: 1px solid var(--rule); padding-top: 18px; margin-top: 18px; }
.ask:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
.ask h3 { margin: 0 0 6px; font-size: 1rem; display: flex; gap: 12px; align-items: baseline; }
.stake { color: var(--accent); font-size: 0.85rem; font-weight: 600; }
.explain { color: var(--muted); font-size: 0.86rem; max-width: 72ch; margin: 0 0 14px; }
.line { background: var(--surface-2); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
.line-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 8px; font-size: 0.9rem; }
.line small { color: var(--muted); font-size: 0.75rem; }
.instalments { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
label { display: flex; gap: 8px; align-items: center; font-size: 0.8rem; color: var(--muted); }
label.inline { margin-bottom: 4px; }
.instalments input[type='number'] { width: 78px; }
.dept-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.dept-grid label { flex-direction: column; align-items: stretch; gap: 4px; }
.dept-grid span { text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.68rem; }
summary { cursor: pointer; font-weight: 600; margin-bottom: 10px; }
.small { padding: 6px 12px; font-size: 0.8rem; }
</style>
