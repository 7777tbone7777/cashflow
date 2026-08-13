<script setup lang="ts">
import { ref } from 'vue'
import { api, type BudgetUploadResult } from '../api'

const emit = defineEmits<{ (e: 'uploaded', result: BudgetUploadResult): void }>()

const file = ref<File | null>(null)
const title = ref('')
const busy = ref(false)
const error = ref('')
const detail = ref<string>('')

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
    emit('uploaded', await api.uploadBudget(file.value, title.value.trim() || undefined))
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
        <h2>Start with the budget</h2>
        <p>
          Upload a locked budget and this produces the two documents a production runs on —
          a weekly cash flow and hot cost day sheets. Everything it cannot work out from the
          budget is asked for afterwards, and there are usually four things.
        </p>
      </div>
    </div>

    <div class="upload-grid">
      <input type="file" accept=".pdf" :disabled="busy" @change="choose" />
      <input v-model="title" type="text" placeholder="Production title (optional)" :disabled="busy" />
      <button class="primary-button" type="button" :disabled="busy || !file" @click="submit">
        {{ busy ? 'Reading the budget…' : 'Upload budget' }}
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
