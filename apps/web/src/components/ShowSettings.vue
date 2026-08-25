<script setup lang="ts">
import { ref, watch } from 'vue'
import { shows, type Production } from '../api'

/**
 * Handing a show on, putting it away, and destroying it.
 *
 * All three are the owner's alone, and they are kept together because they are
 * the three things you do to a picture that is no longer in front of you. They
 * are behind a disclosure and below everything else on purpose: this panel is
 * visited once or twice in a show's life, and one of its buttons has no undo.
 */
const props = defineProps<{ production: Production }>()
const emit = defineEmits<{ (e: 'changed', selectId?: string): void }>()

const transferTo = ref('')
const confirmTitle = ref('')
const busy = ref('')
const error = ref('')
const note = ref('')

watch(() => props.production.id, () => {
  transferTo.value = ''
  confirmTitle.value = ''
  error.value = ''
  note.value = ''
})

async function run(kind: string, action: () => Promise<unknown>, after?: () => void) {
  busy.value = kind
  error.value = ''
  note.value = ''
  try {
    await action()
    after?.()
  } catch (caught: unknown) {
    error.value = (caught as Error).message || 'That did not work.'
  } finally {
    busy.value = ''
  }
}

const archive = () => run('archive',
  () => shows.archive(props.production.id),
  () => { note.value = 'Archived. It is hidden from the picker but nothing was deleted.'; emit('changed') })

const unarchive = () => run('archive',
  () => shows.unarchive(props.production.id),
  () => { note.value = 'Restored.'; emit('changed') })

const transfer = () => run('transfer', async () => {
  const result = await shows.transfer(props.production.id, transferTo.value)
  note.value = `${result.owner.name || result.owner.email} now owns this show. `
    + 'You remain on it as an editor.'
  transferTo.value = ''
}, () => emit('changed'))

const destroy = () => run('delete',
  () => shows.remove(props.production.id, confirmTitle.value),
  () => { confirmTitle.value = ''; emit('changed', '') })
</script>

<template>
  <details class="panel">
    <summary>Show settings</summary>

    <div class="block">
      <h3>Hand this show to somebody else</h3>
      <p class="explain">
        The new owner takes over who can see it and what happens to it. You stay on as an editor,
        so nothing disappears from your list — remove yourself afterwards if you are done with it.
        They need an account already; add them to the show first if they do not have one.
      </p>
      <form class="row" @submit.prevent="transfer">
        <input v-model="transferTo" type="email" placeholder="their@example.com" required />
        <button class="secondary-button" type="submit" :disabled="busy === 'transfer' || !transferTo">
          {{ busy === 'transfer' ? 'Transferring…' : 'Transfer ownership' }}
        </button>
      </form>
    </div>

    <div class="block">
      <h3>{{ production.archivedAt ? 'Restore this show' : 'Archive this show' }}</h3>
      <p class="explain">
        <template v-if="production.archivedAt">
          Archived {{ new Date(production.archivedAt).toLocaleDateString() }}. It is hidden from
          the picker for everyone on it, and nothing has been deleted.
        </template>
        <template v-else>
          Hides it from the picker for everyone who can see it, without deleting anything. This is
          the right answer for a picture that wrapped — the cash flow is the record of what it cost.
          Reversible at any time.
        </template>
      </p>
      <button class="secondary-button" type="button" :disabled="busy === 'archive'"
              @click="production.archivedAt ? unarchive() : archive()">
        {{ busy === 'archive' ? 'Working…' : (production.archivedAt ? 'Restore' : 'Archive') }}
      </button>
    </div>

    <div class="block danger">
      <h3>Delete this show</h3>
      <p class="explain">
        Destroys the budget, every period, line item and allocation, every generated schedule and
        every hot cost day sheet attached to it. <strong>There is no undo.</strong> Archive it
        instead unless you are certain.
      </p>
      <form class="row" @submit.prevent="destroy">
        <label>
          <span>Type <code>{{ production.title }}</code> to confirm</span>
          <input v-model="confirmTitle" type="text" :placeholder="production.title" />
        </label>
        <button class="danger-button" type="submit"
                :disabled="busy === 'delete' || confirmTitle !== production.title">
          {{ busy === 'delete' ? 'Deleting…' : 'Delete permanently' }}
        </button>
      </form>
    </div>

    <p v-if="error" class="banner error">{{ error }}</p>
    <p v-if="note" class="banner ok">{{ note }}</p>
  </details>
</template>

<style scoped>
summary { cursor: pointer; font-weight: 600; }
.block { border-top: 1px solid var(--rule); padding-top: 16px; margin-top: 16px; }
.block:first-of-type { border-top: none; }
h3 { margin: 0 0 6px; font-size: 0.96rem; }
.explain { color: var(--muted); font-size: 0.86rem; max-width: 76ch; margin: 0 0 12px; }
.explain strong { color: var(--error-fg); }
.row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 0.78rem; color: var(--muted); }
code { background: var(--surface-2); padding: 1px 6px; border-radius: 4px; }
.danger h3 { color: var(--error-fg); }
.danger-button {
  border-radius: 8px; padding: 10px 18px; cursor: pointer;
  background: transparent; border: 1px solid var(--error-fg); color: var(--error-fg); font: inherit;
}
.danger-button:disabled { opacity: 0.4; cursor: not-allowed; }
.banner.ok { background: var(--surface-2); color: var(--ok-fg); margin-top: 14px; }
</style>
