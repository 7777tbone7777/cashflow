<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { invites, type Invite } from '../api'

/**
 * Invitations.
 *
 * The panel says plainly what an invite does and does not do, because the
 * natural reading of "invite someone" is "share this with someone", and that is
 * not what happens. An invitation creates a separate private workspace.
 *
 * No email is sent — this deployment has no mail credentials — so the link is
 * shown once for you to pass on. It is a credential until it is used, which is
 * why it cannot be shown again.
 */
const list = ref<Invite[]>([])
const email = ref('')
const busy = ref(false)
const error = ref('')
const freshLink = ref('')
const copied = ref(false)

async function refresh() {
  try {
    list.value = await invites.list()
  } catch (caught: unknown) {
    error.value = (caught as Error).message
  }
}

onMounted(refresh)

async function send() {
  if (!email.value) return
  busy.value = true
  error.value = ''
  freshLink.value = ''
  copied.value = false
  try {
    const result = await invites.create(email.value)
    freshLink.value = result.link
    email.value = ''
    await refresh()
  } catch (caught: unknown) {
    error.value = (caught as Error).message || 'Could not create that invitation.'
  } finally {
    busy.value = false
  }
}

async function copy() {
  await navigator.clipboard.writeText(freshLink.value)
  copied.value = true
}

async function revoke(invite: Invite) {
  await invites.revoke(invite.id).catch(() => {})
  await refresh()
}

const formatDate = (value: string) => new Date(value).toLocaleDateString()
</script>

<template>
  <details class="panel">
    <summary>
      <span>People</span>
      <span class="pill" v-if="list.length">{{ list.length }} invited</span>
    </summary>

    <p class="explain">
      An invitation gives someone an account on this instance and their own private workspace.
      It does <strong>not</strong> share your productions — budgets, cash flows and hot costs are
      visible only to the account that created them, and there is no way to hand one over yet.
    </p>

    <form class="invite-form" @submit.prevent="send">
      <label>
        <span>Email address</span>
        <input v-model="email" type="email" placeholder="them@example.com" required />
      </label>
      <button class="primary-button" type="submit" :disabled="busy || !email">
        {{ busy ? 'Creating…' : 'Create invite link' }}
      </button>
    </form>

    <p v-if="error" class="banner error">{{ error }}</p>

    <div v-if="freshLink" class="fresh">
      <p><strong>Send them this link.</strong> It is shown once — only its hash is stored, so it
        cannot be displayed again. Create a new invite if it goes astray.</p>
      <div class="link-row">
        <code>{{ freshLink }}</code>
        <button class="secondary-button" type="button" @click="copy">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>

    <table v-if="list.length">
      <thead>
        <tr><th>Email</th><th>Invited</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="invite in list" :key="invite.id">
          <td>{{ invite.email }}</td>
          <td>{{ formatDate(invite.createdAt) }}</td>
          <td><span class="status" :class="invite.status">{{ invite.status }}</span></td>
          <td>
            <button v-if="invite.status === 'pending'" class="link" type="button"
                    @click="revoke(invite)">Revoke</button>
          </td>
        </tr>
      </tbody>
    </table>
  </details>
</template>

<style scoped>
summary { cursor: pointer; font-weight: 600; display: flex; gap: 12px; align-items: center; }
.explain { color: var(--muted); font-size: 0.86rem; max-width: 76ch; }
.explain strong { color: var(--text); }
.invite-form { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; margin: 16px 0; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem; }
label > span { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.72rem; }
.fresh { background: var(--surface-2); border-radius: 8px; padding: 14px; margin-bottom: 16px; }
.fresh p { margin: 0 0 10px; font-size: 0.85rem; color: var(--muted); }
.fresh strong { color: var(--text); }
.link-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
code { background: var(--bg); padding: 8px 10px; border-radius: 6px; font-size: 0.78rem; word-break: break-all; flex: 1; min-width: 240px; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--rule); }
th { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.68rem; }
.status { font-size: 0.75rem; padding: 3px 9px; border-radius: 999px; background: var(--surface-2); }
.status.accepted { color: var(--ok-fg); }
.status.pending { color: #d9b45c; }
.status.expired, .status.revoked { color: var(--muted); }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; font: inherit; font-size: 0.82rem; }
</style>
