<script setup lang="ts">
import { computed } from 'vue'
import type { InputRequired } from '../api'
import { money } from '../api'

/**
 * What the system does, and what a person still has to do before its output is
 * worth acting on.
 *
 * This panel exists because the guarantee the generator makes is narrower than
 * it first appears, and a reader who does not know where the line falls will
 * trust the wrong half. It reconciles to the budget exactly — that part is
 * arithmetic and it is asserted, not hoped for. The week a dollar lands in is a
 * forecast, and it is only as good as the answers underneath it. Saying so on
 * the page is cheaper than having someone draw against a curve that was never
 * claimed to be right.
 */
const props = defineProps<{
  hasBudget: boolean
  hasCashflow: boolean
  inputsRequired: InputRequired[]
  currency: string
}>()

const answerable = computed(() =>
  props.inputsRequired.filter((q) => (q.amount_at_stake ?? 0) > 0))

const atStake = computed(() =>
  answerable.value.reduce((sum, q) => sum + (q.amount_at_stake ?? 0), 0))

const step = computed(() => {
  if (!props.hasBudget) return 1
  if (!props.hasCashflow) return 2
  return 4
})

const steps = [
  {
    n: 1,
    title: 'The budget is read',
    body: 'Every account, phase line and fringe comes out of the PDF as structured detail. '
      + 'If the extract cannot account for 98% of the budget’s own stated total it is refused '
      + 'rather than stored — a partial reading is not a basis for a schedule, and it would '
      + 'still look authoritative.',
  },
  {
    n: 2,
    title: 'You confirm what the budget could not state',
    body: 'The form is built from what this particular document left open, not from a fixed '
      + 'questionnaire. Dates and durations arrive prefilled from the budget header. The rest '
      + 'is knowledge no budget contains, and each question is shown with the money it governs.',
  },
  {
    n: 3,
    title: 'Money is placed, and every guess is named',
    body: 'Where the budget states a phase and a duration, spend follows it. Where it states '
      + 'nothing, a department archetype shapes it — and every such placement is listed in the '
      + 'assumptions with its dollar value. An assumption you can see is one you can argue with.',
  },
  {
    n: 4,
    title: 'It reconciles, or it is not emitted',
    body: 'The weekly grid is checked against the budget total before it is returned. A '
      + 'schedule that has quietly stopped matching its budget is worse than no schedule, '
      + 'because it still reads as official.',
  },
]
</script>

<template>
  <section class="panel how">
    <div class="panel-header">
      <div>
        <h2>How this works</h2>
        <p>
          A budget goes in and two documents come out: a weekly cash flow and pre-populated hot
          cost day sheets. Four things happen in between, and one of them is yours.
        </p>
      </div>
      <span class="pill" v-if="atStake > 0">{{ money(atStake, currency) }} awaiting your answer</span>
    </div>

    <ol class="steps">
      <li v-for="item in steps" :key="item.n"
          :class="{ active: step === item.n, done: step > item.n, yours: item.n === 2 }">
        <span class="marker">{{ item.n }}</span>
        <div>
          <strong>{{ item.title }}<em v-if="item.n === 2"> — your part</em></strong>
          <p>{{ item.body }}</p>
        </div>
      </li>
    </ol>

    <details class="more">
      <summary>What a usable cash flow actually requires</summary>

      <p class="explain">
        The generator guarantees one thing outright: the grid sums to the budget. It cannot
        guarantee that a dollar lands in the right <em>week</em> — that is a forecast, and it
        depends on answers only a production accountant has. Each stage below buys a different
        kind of confidence, and it is worth knowing which one you are standing on.
      </p>

      <table>
        <thead>
          <tr><th>Once you have</th><th>You can trust</th><th>Not yet</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>A budget that reconciles</td>
            <td>Totals, department splits, what the show costs</td>
            <td>Anything about timing</td>
          </tr>
          <tr>
            <td>+ a confirmed calendar</td>
            <td>Which phase money sits in; a planning view</td>
            <td>The week within a phase — spend ramps by two orders of magnitude inside prep</td>
          </tr>
          <tr>
            <td>+ payment terms and per-department lags</td>
            <td>Cost turned into cash on your terms, not defaults</td>
            <td>Payments tied to an event rather than a date</td>
          </tr>
          <tr>
            <td>+ milestones, instalments and cost-to-date</td>
            <td>A schedule to run the show against</td>
            <td>A lender draw — that wants a second opinion on the curve</td>
          </tr>
          <tr>
            <td>+ funding sources and draw dates</td>
            <td>A net weekly position, which is the point of a cash flow</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>

      <h3>Where it is honest about being unfinished</h3>
      <ul>
        <li>
          <strong>Read the assumptions.</strong> Anything the budget did not schedule was shaped
          by a department archetype. That is a guess. It is reported every time, with its dollar
          value and its share of the department, so it can be overruled.
        </li>
        <li>
          <strong>Spread shapes do not transfer between shows yet.</strong> Measured across the
          two productions on hand, shapes learned from one applied to the other were worse than
          using none at all. Learning is only trustworthy on the show it was learned from until
          there are more productions to learn from.
        </li>
        <li>
          <strong>Television is refused, not approximated.</strong> It is episodic, with pattern
          and amortised costs and no single shoot block. A feature-shaped schedule built from one
          would reconcile and still be meaningless.
        </li>
        <li>
          <strong>Money the budget prices but does not date is the largest single error.</strong>
          A bonus payable on delivery gets spread across the shoot and lands months early unless
          somebody says otherwise. That is what the dated questions above are for.
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.how { border-color: var(--accent-border); }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.steps li { display: flex; gap: 14px; align-items: flex-start; opacity: 0.62; }
.steps li.active, .steps li.done, .steps li.yours { opacity: 1; }
.marker {
  flex: none; width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center; font-size: 0.78rem; font-weight: 700;
  background: var(--surface-2); color: var(--muted); border: 1px solid var(--rule);
}
.steps li.active .marker { background: var(--accent); color: #06121e; border-color: var(--accent); }
.steps li.done .marker { color: var(--ok-fg); border-color: var(--ok-fg); }
.steps strong { font-size: 0.94rem; }
.steps em { color: var(--accent); font-style: normal; font-weight: 600; }
.steps p { margin: 4px 0 0; color: var(--muted); font-size: 0.86rem; max-width: 78ch; }
.more { margin-top: 20px; border-top: 1px solid var(--rule); padding-top: 14px; }
.more summary { cursor: pointer; font-weight: 600; }
.explain { color: var(--muted); font-size: 0.88rem; max-width: 78ch; }
.more h3 { font-size: 0.96rem; margin: 22px 0 8px; }
.more ul { margin: 0; padding-left: 1.1em; }
.more li { margin-bottom: 10px; color: var(--muted); font-size: 0.86rem; max-width: 78ch; }
.more li strong { color: var(--text); }
table { width: 100%; border-collapse: collapse; margin: 14px 0 4px; font-size: 0.84rem; display: block; overflow-x: auto; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.68rem; white-space: nowrap; }
td:first-child { white-space: nowrap; color: var(--text); }
td { color: var(--muted); }
</style>
