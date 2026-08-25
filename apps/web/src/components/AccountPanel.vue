<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { auth, type User } from '../api'

/**
 * Your account, as opposed to your shows.
 *
 * Closing it is refused while it still owns a production, and rather than
 * saying so in the abstract this lists exactly which shows are in the way and
 * how many people are on each. "Transfer or delete these three first" is an
 * instruction someone can act on; "you still own productions" is not.
 */
const props = defineProps<{ user: User }>()
const emit = defineEmits<{ (e: 'signed-out'): void }>()

const owned = ref<Array<{ id: string; title: string; archivedAt: string | null; sharedWith: number }>>([])
const canDelete = ref(false)
const password = ref('')
const currentPassword = ref('')
const newPassword = ref('')
const passwordNote = ref('')
const busy = ref('')
const error = ref('')

async function refresh() {
  try {
    const result = await auth.blockers()
    owned.value = result.owned
    canDelete.value = result.canDelete
  } catch (caught: unknown) {
    error.value = (caught as Error).message
  }
}

onMounted(refresh)

async function changePassword() {
  busy.value = 'password'
  error.value = ''
  passwordNote.value = ''
  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = ''
    newPassword.value = ''
    passwordNote.value = 'Password changed. Every other session has been signed out.'
  } catch (caught: unknown) {
    error.value = (caught as Error).message || 'Could not change the password.'
  } finally {
    busy.value = ''
  }
}

async function signOutEverywhere() {
  busy.value = 'sessions'
  try {
    await auth.logoutEverywhere()
    emit('signed-out')
  } finally {
    busy.value = ''
  }
}

async function close() {
  busy.value = 'delete'
  error.value = ''
  try {
    await auth.deleteAccount(password.value)
    emit('signed-out')
  } catch (caught: unknown) {
    error.value = (caught as Error).message || 'Could not close the account.'
    await refresh()
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <details class="panel">
    <summary>Your account</summary>

    <p class="explain">
      Signed in as <strong>{{ user.name || user.email }}</strong> ({{ user.email }}).
    </p>

    <div class="block">
      <h3>Change your password</h3>
      <p class="explain">
        Changing it signs out every other session. A password is usually changed because somebody
        thinks it is known, and leaving those sessions alive would make the change cosmetic. You
        stay signed in here.
      </p>
      <form class="row" @submit.prevent="changePassword">
        <label>
          <span>Current password</span>
          <input v-model="currentPassword" type="password" autocomplete="current-password" required />
        </label>
        <label>
          <span>New password</span>
          <input v-model="newPassword" type="password" autocomplete="new-password"
                 minlength="10" required />
        </label>
        <button class="secondary-button" type="submit"
                :disabled="busy === 'password' || !currentPassword || newPassword.length < 10">
          {{ busy === 'password' ? 'Changing…' : 'Change password' }}
        </button>
      </form>
      <p v-if="passwordNote" class="banner ok">{{ passwordNote }}</p>
    </div>

    <div class="block">
      <h3>Sign out everywhere</h3>
      <p class="explain">
        Ends every session on every device, not just this browser. Worth doing if you have signed
        in somewhere you no longer control.
      </p>
      <button class="secondary-button" type="button" :disabled="busy === 'sessions'"
              @click="signOutEverywhere">
        {{ busy === 'sessions' ? 'Ending sessions…' : 'Sign out everywhere' }}
      </button>
    </div>

    <div class="block danger">
      <h3>Close this account</h3>

      <div v-if="!canDelete" class="blocked">
        <p>
          You still own {{ owned.length }} show{{ owned.length === 1 ? '' : 's' }}. Hand
          {{ owned.length === 1 ? 'it' : 'each of them' }} to somebody else under
          <em>Show settings</em>, or delete {{ owned.length === 1 ? 'it' : 'them' }}, and this
          will unlock. Shows that were shared <em>with</em> you are not in the way.
        </p>
        <ul>
          <li v-for="show in owned" :key="show.id">
            <strong>{{ show.title }}</strong>
            <span v-if="show.archivedAt"> · archived</span>
            <span v-if="show.sharedWith">
              · shared with {{ show.sharedWith }}
              {{ show.sharedWith === 1 ? 'person' : 'people' }}
            </span>
          </li>
        </ul>
      </div>

      <template v-else>
        <p class="explain">
          You own no shows, so nothing of anyone else's depends on this account. Closing it ends
          every session and removes you from any show you were added to. There is no undo.
        </p>
        <form class="row" @submit.prevent="close">
          <label>
            <span>Confirm your password</span>
            <input v-model="password" type="password" autocomplete="current-password" required />
          </label>
          <button class="danger-button" type="submit" :disabled="busy === 'delete' || !password">
            {{ busy === 'delete' ? 'Closing…' : 'Close account permanently' }}
          </button>
        </form>
      </template>
    </div>

    <p v-if="error" class="banner error">{{ error }}</p>
  </details>
</template>

<style scoped>
summary { cursor: pointer; font-weight: 600; }
.block { border-top: 1px solid var(--rule); padding-top: 16px; margin-top: 16px; }
h3 { margin: 0 0 6px; font-size: 0.96rem; }
.explain { color: var(--muted); font-size: 0.86rem; max-width: 76ch; margin: 0 0 12px; }
.explain strong { color: var(--text); }
.danger h3 { color: var(--error-fg); }
.blocked { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 8px; padding: 14px 16px; }
.blocked p { margin: 0 0 10px; font-size: 0.86rem; color: var(--muted); }
.blocked ul { margin: 0; padding-left: 1.1em; font-size: 0.86rem; }
.blocked li { margin-bottom: 4px; }
.blocked span { color: var(--muted); }
.row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 0.78rem; color: var(--muted); }
.danger-button {
  border-radius: 8px; padding: 10px 18px; cursor: pointer;
  background: transparent; border: 1px solid var(--error-fg); color: var(--error-fg); font: inherit;
}
.danger-button:disabled { opacity: 0.4; cursor: not-allowed; }
.banner.ok { background: var(--surface-2); color: var(--ok-fg); margin-top: 12px; }
</style>
