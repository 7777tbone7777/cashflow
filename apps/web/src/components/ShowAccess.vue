<script setup lang="ts">
import { ref, watch } from 'vue'
import { members, type MemberList, type ProductionRole } from '../api'

/**
 * Who can see this show.
 *
 * Per production rather than per account, because a producer and a production
 * accountant work on the same budget for different reasons, and neither of them
 * wants a copy. Ownership is not listed as something you can revoke — a show
 * with no owner has nobody who can hand it on.
 */
const props = defineProps<{ productionId: string; role: ProductionRole }>()

const list = ref<MemberList | null>(null)
const email = ref('')
// Named apart from the `role` prop, which is *your* access, not theirs.
const newRole = ref<'editor' | 'viewer'>('editor')
const busy = ref(false)
const error = ref('')
const freshLink = ref('')
const copied = ref(false)
const emailed = ref<boolean | null>(null)
const emailError = ref('')

async function refresh() {
  if (!props.productionId) return
  try {
    list.value = await members.list(props.productionId)
  } catch (caught: unknown) {
    error.value = (caught as Error).message
  }
}

watch(() => props.productionId, refresh, { immediate: true })

async function add() {
  if (!email.value) return
  busy.value = true
  error.value = ''
  freshLink.value = ''
  copied.value = false
  try {
    const result = await members.add(props.productionId, email.value, newRole.value)
    // Somebody without an account yet gets a link that carries the share, so
    // they arrive already able to see the show.
    if (result.invited && result.link) {
      freshLink.value = result.link
      emailed.value = result.emailed ?? false
      emailError.value = result.emailError || ''
    }
    email.value = ''
    await refresh()
  } catch (caught: unknown) {
    error.value = (caught as Error).message || 'Could not add that person.'
  } finally {
    busy.value = false
  }
}

async function setRole(memberId: string, next: string) {
  await members.setRole(props.productionId, memberId, next as 'editor' | 'viewer').catch(() => {})
  await refresh()
}

async function remove(memberId: string) {
  await members.remove(props.productionId, memberId).catch(() => {})
  await refresh()
}

async function cancel(inviteId: string) {
  await members.cancelPending(props.productionId, inviteId).catch(() => {})
  await refresh()
}

async function copy() {
  await navigator.clipboard.writeText(freshLink.value)
  copied.value = true
}

const label = (person: { name: string | null; email: string } | null) =>
  person ? (person.name ? `${person.name} · ${person.email}` : person.email) : 'Unknown'
</script>

<template>
  <details class="panel" v-if="productionId">
    <summary>
      <span>Who can see this show</span>
      <span class="pill" v-if="list">
        {{ 1 + list.members.length + list.pending.length }}
        {{ 1 + list.members.length + list.pending.length === 1 ? 'person' : 'people' }}
      </span>
    </summary>

    <p class="explain">
      Access is per show. Everyone here sees this production only — adding your accountant to
      this one does not show them anything else you have.
      <strong>Editors</strong> can upload budgets and generate documents;
      <strong>viewers</strong> can read what has already been generated.
    </p>

    <form v-if="role === 'owner'" class="add" @submit.prevent="add">
      <label>
        <span>Email address</span>
        <input v-model="email" type="email" placeholder="accountant@example.com" required />
      </label>
      <label>
        <span>Access</span>
        <select v-model="newRole">
          <option value="editor">Editor — can upload and generate</option>
          <option value="viewer">Viewer — read only</option>
        </select>
      </label>
      <button class="primary-button" type="submit" :disabled="busy || !email">
        {{ busy ? 'Adding…' : 'Add to this show' }}
      </button>
    </form>

    <p v-if="error" class="banner error">{{ error }}</p>

    <div v-if="freshLink" class="fresh">
      <p v-if="emailed">
        <strong>They do not have an account yet, so we emailed them an invitation.</strong>
        It creates their account and puts them on this show in one step. The link is here too, in
        case it does not arrive — shown once, because only its hash is stored.
      </p>
      <p v-else>
        <strong>They do not have an account yet.</strong>
        {{ emailError ? `Email could not be sent: ${emailError}.` : '' }}
        Send them this link — it creates their account and puts them on this show in one step.
        Shown once; only its hash is stored.
      </p>
      <div class="link-row">
        <code>{{ freshLink }}</code>
        <button class="secondary-button" type="button" @click="copy">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>

    <table v-if="list">
      <tbody>
        <tr>
          <td>{{ label(list.owner) }}</td>
          <td><span class="status owner">owner</span></td>
          <td></td>
        </tr>
        <tr v-for="member in list.members" :key="member.id">
          <td>{{ label(member.user) }}</td>
          <td>
            <select v-if="role === 'owner'" :value="member.role"
                    @change="setRole(member.id, ($event.target as HTMLSelectElement).value)">
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
            <span v-else class="status">{{ member.role }}</span>
          </td>
          <td>
            <button v-if="role === 'owner'" class="link" type="button"
                    @click="remove(member.id)">Remove</button>
          </td>
        </tr>
        <tr v-for="invite in list.pending" :key="invite.id" class="pending">
          <td>{{ invite.email }}</td>
          <td><span class="status pending">invited · {{ invite.role }}</span></td>
          <td>
            <button v-if="role === 'owner'" class="link" type="button"
                    @click="cancel(invite.id)">Cancel</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="role !== 'owner'" class="explain quiet">
      You have <strong>{{ role }}</strong> access to this show. Only its owner can change who else
      can see it.
    </p>
  </details>
</template>

<style scoped>
summary { cursor: pointer; font-weight: 600; display: flex; gap: 12px; align-items: center; }
.explain { color: var(--muted); font-size: 0.86rem; max-width: 76ch; }
.explain strong { color: var(--text); }
.quiet { margin-top: 14px; }
.add { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; margin: 16px 0; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem; }
label > span { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.72rem; }
.fresh { background: var(--surface-2); border-radius: 8px; padding: 14px; margin-bottom: 16px; }
.fresh p { margin: 0 0 10px; font-size: 0.85rem; color: var(--muted); }
.fresh strong { color: var(--text); }
.link-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
code { background: var(--bg); padding: 8px 10px; border-radius: 6px; font-size: 0.78rem; word-break: break-all; flex: 1; min-width: 240px; }
table { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin-top: 8px; }
td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--rule); }
td:last-child { text-align: right; }
.status { font-size: 0.75rem; padding: 3px 9px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
.status.owner { color: var(--accent); }
.status.pending { color: #d9b45c; }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; font: inherit; font-size: 0.82rem; }
</style>
