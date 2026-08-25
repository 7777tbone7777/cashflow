<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  adjustments, money,
  type Adjustment, type CashflowResult, type OverrideFieldSpec, type Target,
} from '../api'

/**
 * What you know that the budget does not say.
 *
 * The generator decides a great deal without being asked — on the reference
 * budget, 420 phase lines whose timing is inferred. This is the escape hatch,
 * and it has been in the engine from the beginning with no way to reach it.
 *
 * Everything here moves *when* money lands and never how much. That is not a
 * UI convention, it is asserted after generation: if a redistribution changed
 * the total the schedule is refused. So an accountant can say "the crane comes
 * in a week early" without any risk of quietly changing what the show costs.
 */
const props = defineProps<{
  productionId: string
  currency: string
  canEdit: boolean
  cashflow: CashflowResult | null
}>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const fields = ref<Record<string, OverrideFieldSpec>>({})
const departments = ref<Target[]>([])
const accounts = ref<Target[]>([])
const list = ref<Adjustment[]>([])
const busy = ref(false)
const error = ref('')
const open = ref(false)

// Equipment is the common case and it is nearly always an allowance, so the
// control that actually moves it is the one offered first.
const field = ref('phase_window')
const scope = ref<'department' | 'account'>('account')
const key = ref('')
const value = ref<string | number>('prep')
const reason = ref('')

const spec = computed<OverrideFieldSpec | undefined>(() => fields.value[field.value])
const targets = computed(() => (scope.value === 'department' ? departments.value : accounts.value))

// Everything an account-scoped adjustment could attach to is 582 rows on a real
// budget, so it is filtered rather than listed.
const filter = ref('')
const shown = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  const rows = targets.value
  if (!needle) return rows.slice(0, 60)
  return rows.filter((t) => t.key.includes(needle) || t.name.toLowerCase().includes(needle))
    .slice(0, 60)
})

const nameFor = (a: Adjustment) => {
  const pool = a.scope === 'department' ? departments.value : accounts.value
  return pool.find((t) => t.key === a.key)?.name ?? ''
}

const describe = (a: Adjustment) => {
  const s = fields.value[a.field]
  if (!s) return `${a.field} = ${a.value}`
  if (s.type === 'number') return `${s.label.toLowerCase()} by ${a.value} ${s.unit}`
  return `${s.label.toLowerCase()}: ${a.value}`
}

/** Orphans are reported rather than dropped — the budget re-versioned under them. */
const orphaned = computed(() => props.cashflow?.overrides?.orphaned ?? [])
const appliedTargets = computed(() => props.cashflow?.overrides?.applied_targets ?? [])
const inert = computed(() => props.cashflow?.overrides?.inert ?? [])

/**
 * Three outcomes, and the middle one is the reason this exists. An adjustment
 * can point at something real and still be read by nothing — "start prep
 * earlier" on a rental the budget bills as an allowance does exactly that — and
 * an adjustment that silently did nothing is worse than one that errored.
 */
function statusOf(a: Adjustment): 'applied' | 'inert' | 'orphaned' | 'pending' {
  const id = `${a.field}|${a.scope}|${a.key}`
  if (!props.cashflow?.overrides) return 'pending'
  if (appliedTargets.value.includes(id)) return 'applied'
  if (inert.value.includes(id)) return 'inert'
  if (orphaned.value.some((o) => o.includes(a.key))) return 'orphaned'
  return 'inert'
}

const NOTE: Record<string, string> = {
  applied: 'moved money',
  inert: 'changed nothing — see below',
  orphaned: 'the budget no longer has this',
  pending: 'not generated yet',
}

async function load() {
  if (!props.productionId) return
  try {
    const [f, t, l] = await Promise.all([
      adjustments.fields(props.productionId),
      adjustments.targets(props.productionId),
      adjustments.list(props.productionId),
    ])
    fields.value = f.fields
    departments.value = t.departments
    accounts.value = t.accounts
    list.value = l
  } catch (caught: unknown) {
    error.value = (caught as Error).message
  }
}

watch(() => props.productionId, load, { immediate: true })

watch(field, () => {
  const s = fields.value[field.value]
  if (!s) return
  if (!s.scopes.includes(scope.value)) scope.value = s.scopes[0]
  value.value = s.type === 'number' ? 1 : (s.choices?.[0] ?? '')
})
watch(scope, () => { key.value = ''; filter.value = '' })

async function add() {
  if (!key.value || !reason.value) return
  busy.value = true
  error.value = ''
  try {
    await adjustments.add(props.productionId, {
      field: field.value, value: value.value, scope: scope.value,
      key: key.value, reason: reason.value,
    })
    key.value = ''
    reason.value = ''
    filter.value = ''
    await load()
    emit('changed')
  } catch (caught: unknown) {
    error.value = (caught as Error).message || 'Could not save that.'
  } finally {
    busy.value = false
  }
}

async function remove(a: Adjustment) {
  await adjustments.remove(props.productionId, a.id).catch(() => {})
  await load()
  emit('changed')
}
</script>

<template>
  <details class="panel" v-if="productionId" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open">
    <summary>
      <span>Adjustments — what you know that the budget does not say</span>
      <span class="pill" v-if="list.length">{{ list.length }}</span>
    </summary>

    <p class="explain">
      The generator infers timing wherever the budget does not state it, and it is often wrong in
      ways only you can see — a crane wanted a week early for rigging, a camera package that preps
      two weeks out. Say so here and the schedule follows.
      <strong>Nothing here can change what the show costs</strong>: these move when money lands, and
      the total is checked against the budget afterwards. If it moved, the schedule is refused.
    </p>

    <p class="explain">
      These move the <strong>cost</strong> — when the thing is used. The week cash actually leaves
      is that plus the payment terms, so a crane moved into the week before the shoot still shows
      up four weeks later on net-30. Change <em>Payment timing</em> above, or set
      <em>Settles on different terms</em> below, if the money really does leave earlier.
    </p>

    <p class="explain" v-if="cashflow?.overrides">
      Last generation applied <strong>{{ appliedTargets.length }}</strong> of
      {{ cashflow.overrides.loaded }} adjustment{{ cashflow.overrides.loaded === 1 ? '' : 's' }}.
      <span v-if="inert.length" class="warn">
        {{ inert.length }} changed nothing: the target is real but the schedule never
        consults that setting for it. Equipment billed as an allowance needs
        <em>Move it to a different phase</em> rather than <em>Start prep earlier</em>.
      </span>
      <span v-if="orphaned.length" class="warn">
        {{ orphaned.length }} point at something this budget no longer has — it re-versioned
        underneath them.
      </span>
    </p>

    <form v-if="canEdit" class="builder" @submit.prevent="add">
      <div class="row">
        <label>
          <span>What is different</span>
          <select v-model="field">
            <option v-for="(s, name) in fields" :key="name" :value="name">{{ s.label }}</option>
          </select>
        </label>

        <label v-if="spec">
          <span>Applies to</span>
          <select v-model="scope">
            <option v-for="s in spec.scopes" :key="s" :value="s">
              {{ s === 'department' ? 'a whole department' : 'one account' }}
            </option>
          </select>
        </label>

        <label v-if="spec?.type === 'number'">
          <span>{{ spec.unit }}</span>
          <input type="number" min="0" max="52" v-model.number="value" />
        </label>
        <label v-else-if="spec">
          <span>Value</span>
          <select v-model="value">
            <option v-for="c in spec.choices" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
      </div>

      <p class="help" v-if="spec">{{ spec.help }}</p>

      <div class="row">
        <label class="grow">
          <span>Which {{ scope }}</span>
          <input v-model="filter" type="text"
                 :placeholder="scope === 'department' ? 'Filter departments…' : 'Filter by code or name…'" />
          <select v-model="key" size="6" class="target-list">
            <option v-for="t in shown" :key="t.key" :value="t.key">
              {{ t.key }} · {{ t.name }} · {{ money(t.total, currency) }}
            </option>
          </select>
        </label>
      </div>

      <div class="row">
        <label class="grow">
          <span>Why — this is read months later</span>
          <input v-model="reason" type="text"
                 placeholder="crane wanted a week early for rigging" />
        </label>
        <button class="primary-button" type="submit" :disabled="busy || !key || !reason">
          {{ busy ? 'Saving…' : 'Add adjustment' }}
        </button>
      </div>
    </form>

    <p v-if="error" class="banner error">{{ error }}</p>

    <table v-if="list.length">
      <thead>
        <tr><th>Applies to</th><th>Adjustment</th><th>Why</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="a in list" :key="a.id" :class="statusOf(a)">
          <td>
            <strong>{{ a.key }}</strong> {{ nameFor(a) }}
            <span class="scope">{{ a.scope }}</span>
            <span class="state" :class="statusOf(a)">{{ NOTE[statusOf(a)] }}</span>
          </td>
          <td>{{ describe(a) }}</td>
          <td class="why">
            {{ a.reason }}
            <small v-if="a.author">— {{ a.author }}</small>
          </td>
          <td>
            <button v-if="canEdit" class="link" type="button" @click="remove(a)">Remove</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-else-if="!canEdit" class="explain">No adjustments have been made to this show.</p>

    <p class="explain footnote" v-if="list.length">
      Regenerate the cash flow for these to take effect.
    </p>
  </details>
</template>

<style scoped>
summary { cursor: pointer; font-weight: 600; display: flex; gap: 12px; align-items: center; }
.explain { color: var(--muted); font-size: 0.86rem; max-width: 78ch; }
.explain strong { color: var(--text); }
.warn { color: #d9b45c; }
.builder { margin: 18px 0; padding: 16px; background: var(--surface-2); border-radius: 8px; }
.row { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px; }
.row:last-child { margin-bottom: 0; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem; }
label.grow { flex: 1; min-width: 260px; }
label > span { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.7rem; }
.target-list { margin-top: 6px; font-family: ui-monospace, monospace; font-size: 0.78rem; }
.help { color: var(--muted); font-size: 0.82rem; margin: 0 0 12px; max-width: 78ch; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 8px; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.68rem; }
td:last-child { text-align: right; }
.scope { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; margin-left: 6px; }
.why { color: var(--muted); }
.why small { display: block; font-size: 0.72rem; }
tr.inert td, tr.orphaned td { opacity: 0.7; }
.state { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 3px; }
.state.applied { color: var(--ok-fg); }
.state.inert, .state.orphaned { color: #d9b45c; }
.state.pending { color: var(--muted); }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; font: inherit; font-size: 0.82rem; }
.footnote { margin-top: 12px; }
</style>
