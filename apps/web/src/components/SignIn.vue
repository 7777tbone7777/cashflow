<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { auth, type User } from '../api'

/**
 * The gate.
 *
 * Three states rather than two: sign in, claim an invitation, and set up the
 * very first account. The last exists because an invitation-only app has to
 * begin somewhere, and a hidden bootstrap password in an environment variable
 * is worse than letting the first visitor to an empty instance claim it.
 */
const emit = defineEmits<{ (e: 'signed-in', user: User): void }>()

const mode = ref<'login' | 'register'>('login')
const needsFirstUser = ref(false)
const inviteToken = ref('')
const email = ref('')
const password = ref('')
const name = ref('')
const busy = ref(false)
const error = ref('')

const heading = computed(() => {
  if (needsFirstUser.value) return 'Set up the first account'
  return mode.value === 'register' ? 'Claim your invitation' : 'Sign in'
})

onMounted(async () => {
  const token = new URLSearchParams(window.location.search).get('invite')
  if (token) {
    inviteToken.value = token
    mode.value = 'register'
  }
  try {
    const state = await auth.state()
    needsFirstUser.value = state.needsFirstUser
    if (state.needsFirstUser) mode.value = 'register'
  } catch {
    /* the state probe is a convenience; the form still works without it */
  }
})

async function submit() {
  busy.value = true
  error.value = ''
  try {
    const result = mode.value === 'register'
      ? await auth.register({
        email: email.value,
        password: password.value,
        name: name.value || undefined,
        inviteToken: inviteToken.value || undefined,
      })
      : await auth.login(email.value, password.value)
    emit('signed-in', result.user)
  } catch (caught: unknown) {
    error.value = (caught as Error).message || 'That did not work.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="gate">
    <form class="panel card" @submit.prevent="submit">
      <p class="eyebrow">Cashflow</p>
      <h1>{{ heading }}</h1>
      <p class="lede" v-if="needsFirstUser">
        This instance has no accounts yet. The one you create now can invite everybody else.
      </p>
      <p class="lede" v-else-if="mode === 'register'">
        Your invitation gives you your own workspace. Productions are private to the account that
        creates them — nobody else on this instance can see your budgets or cash flows.
      </p>

      <label>
        <span>Email</span>
        <input v-model="email" type="email" required autocomplete="email" />
      </label>

      <label v-if="mode === 'register'">
        <span>Name</span>
        <input v-model="name" type="text" autocomplete="name" />
      </label>

      <label>
        <span>Password</span>
        <input v-model="password" type="password" required
               :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
               :minlength="mode === 'register' ? 10 : undefined" />
        <small v-if="mode === 'register'">At least 10 characters.</small>
      </label>

      <p v-if="error" class="banner error">{{ error }}</p>

      <button class="primary-button" type="submit" :disabled="busy">
        {{ busy ? 'One moment…' : (mode === 'register' ? 'Create account' : 'Sign in') }}
      </button>

      <p class="switch" v-if="!needsFirstUser">
        <template v-if="mode === 'login'">
          Have an invitation link? Open it to create your account.
        </template>
        <template v-else>
          Already have an account?
          <button type="button" class="link" @click="mode = 'login'; error = ''">Sign in</button>
        </template>
      </p>
    </form>
  </main>
</template>

<style scoped>
.gate { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.card { width: min(420px, 100%); display: flex; flex-direction: column; gap: 14px; }
h1 { margin: 0; font-size: 1.5rem; }
.lede { color: var(--muted); font-size: 0.88rem; margin: 0; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem; }
label > span { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.72rem; }
label small { color: var(--muted); font-size: 0.75rem; }
.switch { color: var(--muted); font-size: 0.82rem; margin: 0; }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; font: inherit; }
</style>
