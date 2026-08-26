<script setup lang="ts">
import { computed } from 'vue'
import type { InputRequired, ProductionConfig } from '../api'

/**
 * The generated form.
 *
 * Not a fixed questionnaire — the extractor reports what it could not determine
 * from this particular budget, and only those things are asked. On the reference
 * budget that is four questions, three of them already answered from the
 * document's own header.
 */
const props = defineProps<{
  config: ProductionConfig
  inputsRequired: InputRequired[]
  busy: boolean
  /** What went wrong, if it did. Shown here because this is where the button is. */
  error?: string
  /** What came back, so the button is not the only thing that answers. */
  result?: string
}>()

const emit = defineEmits<{
  (e: 'update:config', value: ProductionConfig): void
  (e: 'generate'): void
}>()

function set<K extends keyof ProductionConfig>(key: K, value: ProductionConfig[K]) {
  emit('update:config', { ...props.config, [key]: value })
}

function number(event: Event) {
  return Number((event.target as HTMLInputElement).value)
}

const asked = computed(() => new Set(props.inputsRequired.map((q) => q.key)));

const outstanding = computed(() =>
  props.inputsRequired.filter((q) => q.key === 'funding' || q.key === 'financing_lines'))

const ready = computed(() => Boolean(props.config.shoot_start))
</script>

<template>
  <section class="panel">
    <div class="panel-header">
      <div>
        <h2>Confirm the schedule</h2>
        <p>
          Prefilled from the budget where it says so. Correcting a value here changes when money
          lands, never how much — the schedule is checked against the budget total either way.
        </p>
      </div>
      <span class="pill">{{ inputsRequired.length }} to confirm</span>
    </div>

    <div class="field-grid">
      <label>
        <span>Shoot start</span>
        <input type="date" :value="config.shoot_start"
               @change="set('shoot_start', ($event.target as HTMLInputElement).value)" />
        <small>From the budget header where stated.</small>
      </label>
      <label>
        <span>Shoot days</span>
        <input type="number" min="1" :value="config.shoot_days"
               @input="set('shoot_days', number($event))" />
      </label>
      <label>
        <span>Shoot weeks</span>
        <input type="number" min="1" :value="config.shoot_weeks"
               @input="set('shoot_weeks', number($event))" />
      </label>
      <label>
        <span>Prep weeks</span>
        <input type="number" min="0" :value="config.prep_weeks"
               @input="set('prep_weeks', number($event))" />
      </label>
      <label>
        <span>Wrap weeks</span>
        <input type="number" min="0" :value="config.wrap_weeks"
               @input="set('wrap_weeks', number($event))" />
      </label>
      <label>
        <span>Post weeks</span>
        <input type="number" min="0" :value="config.post_weeks"
               @input="set('post_weeks', number($event))" />
      </label>
      <label>
        <span>Prep ramp</span>
        <input type="number" min="0.01" max="1" step="0.01" :value="config.prep_ramp ?? 0.05"
               @input="set('prep_ramp', number($event))" />
      </label>
      <label>
        <span>Post decline</span>
        <input type="number" min="0" max="1" step="0.05" :value="config.post_taper ?? 0.5"
               @input="set('post_taper', number($event))" />
      </label>
    </div>
    <p class="hint">
      Prep ramp is the first prep week as a share of the last, and post decline is the last
      post week as a share of the first. Spend climbs through prep as the departments come on
      and falls away through post as the cutting rooms empty; 1 spreads either level, which is
      the one shape neither has. The prep default was measured on a completed show's own cash
      flow — 0.4% of prep in its first week against 42% in its last. Both are settings.
    </p>

    <details class="advanced" v-if="asked.has('payment_timing')">
      <summary>Payment timing — how cost becomes cash</summary>
      <p class="explain">
        The budget states when cost is incurred. Cash leaves on different dates, and only you
        know the terms. These defaults are house practice and carry over to the next show.
      </p>
      <div class="field-grid">
        <label v-for="(value, key) in config.payment_timing" :key="key">
          <span>{{ key }} lag (days)</span>
          <input type="number" :value="value.lag_days"
                 @input="set('payment_timing', { ...config.payment_timing, [key]: { ...value, lag_days: number($event) } })" />
          <small>{{ value.note }}</small>
        </label>
        <label>
          <span>Rental deposit share</span>
          <input type="number" step="0.05" min="0" max="1" :value="config.rental_deposit_share"
                 @input="set('rental_deposit_share', number($event))" />
          <small>Paid the week before the hire starts.</small>
        </label>
      </div>
    </details>

    <div v-if="outstanding.length" class="outstanding">
      <h3>Still needed, and not in any document</h3>
      <ul>
        <li v-for="question in outstanding" :key="question.key">
          <strong>{{ question.question }}</strong>
          <p>{{ question.why }}</p>
        </li>
      </ul>
      <p class="explain">
        A schedule generates without these. It just will not show a net cash position, and it
        will understate the financing ask.
      </p>
    </div>

    <div class="actions">
      <button class="primary-button" type="button" :disabled="busy || !ready" @click="emit('generate')">
        {{ busy ? 'Generating…' : 'Generate cash flow and hot cost' }}
      </button>
      <span v-if="!ready" class="hint">A shoot start date is the one thing required.</span>
    </div>

    <!--
      The outcome belongs next to the button that caused it. Both the grid and
      the documents panel render further down the page, so from here a
      successful generation looked identical to nothing happening at all.
    -->
    <p v-if="error" class="outcome bad">{{ error }}</p>
    <p v-else-if="result" class="outcome good">{{ result }}</p>
  </section>
</template>

<style scoped>
.outcome { margin: 12px 0 0; font-size: 0.86rem; max-width: 78ch; }
.outcome.good { color: #7fb08a; }
.outcome.bad { color: var(--error-fg); background: var(--error-bg); padding: 10px 14px; border-radius: 8px; }

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 16px;
}
label { display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem; }
label > span { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.72rem; }
label small { color: var(--muted); font-size: 0.75rem; }
.advanced { margin-top: 22px; border-top: 1px solid var(--rule); padding-top: 16px; }
.advanced summary { cursor: pointer; font-weight: 600; margin-bottom: 12px; }
.explain { color: var(--muted); font-size: 0.86rem; max-width: 68ch; }
.outstanding {
  margin-top: 22px; padding: 16px 18px; border-radius: 8px;
  background: var(--warn-bg); border: 1px solid var(--warn-border);
}
.outstanding h3 { margin: 0 0 10px; font-size: 1rem; }
.outstanding ul { margin: 0 0 10px; padding-left: 1.1em; }
.outstanding li { margin-bottom: 10px; }
.outstanding p { margin: 4px 0 0; font-size: 0.85rem; color: var(--muted); }
.actions { display: flex; align-items: center; gap: 14px; margin-top: 22px; flex-wrap: wrap; }
.hint { color: var(--muted); font-size: 0.85rem; }
</style>
