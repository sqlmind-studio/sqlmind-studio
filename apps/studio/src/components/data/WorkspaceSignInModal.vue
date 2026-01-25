<template>
  <modal
    name="workspace"
    class="vue-dialog sqlmind-modal"
    @opened="focus"
  >
    <form @submit.prevent="login">
      <div class="dialog-content">
        <div
          v-if="lockEmail"
          class="dialoc-c-title"
        >
          Reauthenticate {{ email ? email : '' }}
        </div>
        <div
          v-else
          class="dialog-c-title"
        >
          Team workspace account sign-in <a
            v-tooltip="'Store connections and queries in the cloud, share with colleagues. Click to learn more.'"
            :href="`${baseFrontendUrl}/workspaces`"
          ><i class="material-icons">help_outlined</i></a>
        </div>
        <error-alert :error="error" />
        <div class="form-group">
          <label for="email">Email Address</label>
          <input
            ref="email"
            type="text"
            :disabled="lockEmail"
            v-model="email"
            placeholder="e.g. your-email@company.com"
          >
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input
            type="password"
            ref="password"
            v-model="password"
            placeholder="Type your password"
          >
        </div>
      </div>
      <div class="vue-dialog-buttons flex-between">
        <span class="left">
          <a
            :href="signupUrl"
            class="small text-muted"
          >Create Account</a>
          <a
            :href="forgotPasswordUrl"
            class="small text-muted"
          >Forgot Password</a>
        </span>
        <span class="right">
          <button
            class="btn btn-flat"
            type="button"
            @click.prevent="$modal.hide('workspace')"
          >Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="loading"
            type="submit"
          >{{ loading ? '...' : 'Submit' }}</button>
        </span>
      </div>
    </form>
  </modal>
</template>
<script lang="ts">

import { AppEvent } from '@/common/AppEvent'
import ErrorAlert from '@/components/common/ErrorAlert.vue'
import Vue from 'vue'
export default Vue.extend({
  components: { ErrorAlert },
  mounted() {
    this.registerHandlers(this.rootBindings)
  },
  data() {
    return {
      loading: false,
      email: null,
      password: null,
      error: null,
      lockEmail: false
    }
  },
  computed: {
    rootBindings() {
      return [
        {
          event: AppEvent.promptLogin,
          handler: this.openModal
        }
      ]
    },
    baseFrontendUrl(): string {
      return (window as any).platformInfo?.frontendUrl
        || process.env.VUE_APP_FRONTEND_URL
        || 'https://sqltools.co'
    },
    signupUrl(): string {
      return `${this.baseFrontendUrl}/signup`
    },
    forgotPasswordUrl(): string {
      return `${this.baseFrontendUrl}/reset-password`
    }
  },
  methods: {
    openModal(email?: string) {
      this.email = email || null
      this.lockEmail = !!email
      this.error = null
      this.password = null
      this.loading = false
      this.$modal.show('workspace')
    },
    focus() {
      this.$nextTick(() => {
        const element = this.lockEmail ? this.$refs.password : this.$refs.email
        if (element) {
          (element as HTMLInputElement).focus()
        }
      })
    },
    async login() {
      try {
        this.error = null
        this.loading = true
        await this.$store.dispatch('credentials/login', { email: this.email, password: this.password })
        this.$modal.hide('workspace')
      } catch(ex) {
        this.error = ex
      } finally {
        this.loading = false
      }
    }
  }
})
</script>

<style scoped>
/* Override global user-select: none to allow typing in inputs */
input[type="text"],
input[type="password"] {
  user-select: text !important;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
}
</style>
