<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../api'

const props = defineProps<{ productionId: string | null }>()
const emit = defineEmits<{ (e: 'imported'): void }>()

const file = ref<File | null>(null)
const busy = ref(false)
const message = ref('')
const error = ref('')

async function submit() {
  if (!file.value) return
  busy.value = true; message.value = ''; error.value = ''
  try {
    const result = await api.uploadWorkbook(file.value, props.productionId || undefined)
    message.value = `Imported as a ${result.workbookType} workbook.`
    file.value = null
    emit('imported')
  } catch (caught: any) {
    error.value = caught.message || 'Import failed.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <details class="panel secondary">
    <summary>
      <strong>Already under way?</strong>
      Import an existing cash flow or hot cost
    </summary>
    <p class="explain">
      For a production that already has documents. A cash flow imports for review and teaches its
      spread shapes to future generations; a hot cost brings in actuals. Neither is needed to
      start from a budget.
    </p>
    <div class="row">
      <input type="file" accept=".xlsx,.xls" :disabled="busy"
             @change="file = ($event.target as HTMLInputElement).files?.[0] || null" />
      <button class="secondary-button" type="button" :disabled="busy || !file" @click="submit">
        {{ busy ? 'Importing…' : 'Import workbook' }}
      </button>
    </div>
    <p v-if="message" class="ok">{{ message }}</p>
    <p v-if="error" class="err">{{ error }}</p>
  </details>
</template>

<style scoped>
.panel.secondary { border-style: dashed; }
summary { cursor: pointer; font-size: 0.94rem; }
summary strong { margin-right: 6px; }
.explain { color: var(--muted); font-size: 0.86rem; margin: 14px 0; max-width: 70ch; }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.ok { color: var(--ok-fg); font-size: 0.86rem; }
.err { color: var(--error-fg); font-size: 0.86rem; }
</style>
