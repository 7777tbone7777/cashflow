<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, type BudgetUploadResult } from '../api'

/**
 * Uploading a budget.
 *
 * This panel used to sit under a production picker showing some other show's
 * name while always creating a new production, which made the picker read as
 * context it was not. It now says which production the budget is going to, and
 * lets that be the selected one — a budget re-versions constantly during prep,
 * and replacing it on the show it belongs to is the more common of the two.
 */
const props = defineProps<{ selectedId: string; selectedTitle: string }>()
const emit = defineEmits<{ (e: 'uploaded', result: BudgetUploadResult): void }>()

const file = ref<File | null>(null)
const title = ref('')
const target = ref<'new' | 'selected'>('new')
const busy = ref(false)
const error = ref('')
const detail = ref<string>('')

// Losing the show you had selected changes what "replace" would mean, so the
// choice resets rather than silently pointing somewhere else.
watch(() => props.selectedId, () => { target.value = 'new' })

const replacing = computed(() => target.value === 'selected' && Boolean(props.selectedId))

function choose(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] || null
  error.value = ''
  detail.value = ''
}

async function submit() {
  if (!file.value) {
    error.value = 'Choose a budget first.'
    return
  }
  busy.value = true
  error.value = ''
  detail.value = ''
  try {
    emit('uploaded', await api.uploadBudget(
      file.value,
      title.value.trim() || undefined,
      replacing.value ? props.selectedId : undefined))
    file.value = null
    title.value = ''
  } catch (caught: any) {
    error.value = caught.message || 'Upload failed.'
    // A television budget comes back with its evidence attached; show it rather
    // than a bare rejection.
    detail.value = typeof caught.detail === 'string' ? caught.detail : ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="panel primary">
    <div class="panel-header">
      <div>
        <h2>{{ replacing ? `New budget for ${selectedTitle}` : 'Start a new production' }}</h2>
        <p v-if="replacing">
          Replaces the budget on <strong>{{ selectedTitle }}</strong>. Its schedules and the
          people on it are kept — a budget re-versions during prep, and this is how you bring
          the new one in.
        </p>
        <p v-else>
          Upload a locked budget and this produces the two documents a production runs on —
          a weekly cash flow and hot cost day sheets. Everything it cannot work out from the
          budget is asked for afterwards, and there are usually four things.
          <strong>This creates a new production</strong>, whatever is selected above.
        </p>
      </div>
    </div>

    <div v-if="selectedId" class="target">
      <span>This budget is</span>
      <label>
        <input type="radio" value="new" v-model="target" />
        a new production
      </label>
      <label>
        <input type="radio" value="selected" v-model="target" />
        a new version of {{ selectedTitle }}
      </label>
    </div>

    <div class="upload-grid">
      <input type="file" accept=".pdf" :disabled="busy" @change="choose" />
      <input v-model="title" type="text" :disabled="busy || replacing"
             :placeholder="replacing ? 'Title kept from the budget' : 'Production title (optional)'" />
      <button class="primary-button" type="button" :disabled="busy || !file" @click="submit">
        {{ busy ? 'Reading the budget…' : (replacing ? 'Replace budget' : 'Create production') }}
      </button>
    </div>

    <p v-if="busy" class="hint">
      A full budget takes about ten seconds — every account, rate and phase quantity is read,
      then checked against the stated total.
    </p>

    <div v-if="error" class="inline-error">
      <strong>{{ error }}</strong>
      <p v-if="detail">{{ detail }}</p>
    </div>
  </section>
</template>

<style scoped>
.target {
  display: flex; gap: 18px; align-items: center; flex-wrap: wrap;
  margin-bottom: 16px; padding: 12px 14px; border-radius: 8px;
  background: var(--surface-2); font-size: 0.86rem;
}
.target > span { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.7rem; }
.target label { display: flex; gap: 7px; align-items: center; cursor: pointer; }
.panel.primary { border-color: var(--accent-border); }
.upload-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}
@media (max-width: 720px) { .upload-grid { grid-template-columns: 1fr; } }
.hint { color: var(--muted); font-size: 0.86rem; margin: 14px 0 0; }
.inline-error {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--error-bg);
  color: var(--error-fg);
  font-size: 0.9rem;
}
.inline-error p { margin: 8px 0 0; opacity: 0.9; }
</style>
