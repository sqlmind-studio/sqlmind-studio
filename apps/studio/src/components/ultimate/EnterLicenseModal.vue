<template>
  <modal name="license" class="vue-dialog sqlmind-modal" @opened="init">
    <form @submit.prevent="submitLicense">
      <div class="dialog-content">
        <div class="dialog-c-title">
          License Key Management
        </div>
        <!-- CLOSE BUTTON -->
        <a class="close-btn btn btn-fab" href="#" @click.prevent="$modal.hide('license')">
          <i class="material-icons">clear</i>
        </a>
        <div class="existing-licenses" v-if="license">
          <p>Current license information</p>
          <div class="dialog-c-subtitle">
            <license-information :license="license" :license-status="licenseStatus" />
          </div>
        </div>
        <div v-else>
          <div class="alert alert-info">
            <i class="material-icons-outlined">info</i>
            <span>Activating a license unlocks premium features for Microsoft SQL Server and Azure SQL. It helps DBAs, developers, and data engineers analyze queries, execution plans, and performance issues using AI-assisted reasoning combined with proven database engineering practices. Additional features include JSON view, multi-table support, and more. <a
                href="https://sqltools.co/pricing/">Learn
                more</a>.</span>
          </div>
          <p>You don't have any licenses registered with the application at the moment. Register a new license below.</p>
          <p class="text-muted small" v-if="trialLicense">Free trial expiry: {{ timeAgo(trialLicense.validUntil) }}, on {{
            trialLicense.validUntil.toLocaleDateString() }}
          </p>
          <error-alert :error=" error" />
          <div class="form-group">
            <label for="email">License Name</label>
            <input type="text" v-model="email">
          </div>
          <div class="form-group">
            <label for="key">License Key</label>
            <input type="text" v-model="key">
          </div>
        </div>
      </div>
      <div class="vue-dialog-buttons flex flex-middle">
        <span class="app-version small text-muted">Current app version: {{ $config.appVersion }}</span>
        <span class="expand" />
        <span>
          <a :href="`${baseFrontendUrl}/pricing`" class="btn btn-flat">Buy a new license</a>
          <button v-if="!realLicenses?.length" type="submit" class="btn btn-primary mt-2">Submit</button>
        </span>
      </div>
    </form>
  </modal>
</template>
<script lang="ts">
import { AppEvent } from '@/common/AppEvent'
import Vue from 'vue'
import { mapGetters, mapState } from 'vuex'
import ErrorAlert from '../common/ErrorAlert.vue'
import LicenseInformation from './LicenseInformation.vue'
import _ from 'lodash'
export default Vue.extend({
  components: { ErrorAlert, LicenseInformation },
  data: () => ({
    email: null, key: null,
    error: null
  }),
  mounted() {
    this.registerHandlers(this.rootBindings)
  },
  computed: {
    ...mapState('licenses', {'licenseStatus': 'status'}),
    ...mapGetters('licenses', { 'realLicenses': 'realLicenses', 'trialLicense': 'trialLicense'}),
    license() {
      // there should only ever be 1 license
      return this.realLicenses?.[0]
    },
    rootBindings() {
      return [
        {
          event: AppEvent.enterLicense,
          handler: this.openModal
        }
      ]
    },
    baseFrontendUrl(): string {
      return (window as any).platformInfo?.frontendUrl
        || process.env.VUE_APP_FRONTEND_URL
        || 'https://sqltools.co'
    },
  },
  methods: {

    isSubscription(license) {
      return license.supportUntil > new Date('2888-01-1')
    },
    timeAgo(date) {
      return this.$bks.timeAgo(date)
    },
    openModal() {
      console.log("opening license modal")
      this.$modal.show('license')
    },
    init() {
      this.email = null
      this.key = null
      this.error = null
    },
    async submitLicense() {
      try {
        await this.$store.dispatch('licenses/add', { email: this.email, key: this.key })
        this.$noty.success("License registered, thanks for supporting SQLMind Studio!")
        this.$modal.hide('license')
        this.$store.dispatch('licenseEntered')
      } catch (error) {
        this.error = error
      }
    }
  }
})
</script>

