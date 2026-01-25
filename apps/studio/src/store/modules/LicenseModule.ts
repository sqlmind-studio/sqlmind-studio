import _ from 'lodash'
import rawLog from 'electron-log'
import { Module } from 'vuex'
import { State as RootState } from '../index'
import { getOrCreateDeviceId } from '@/lib/deviceId'
import { sendUserContextToPlugin } from '@/lib/aiUserContext'
import { CloudError } from '@/lib/cloud/ClientHelpers';
import { TransportLicenseKey } from '@/common/transport';
import Vue from "vue"
import { LicenseStatus } from '@/lib/license';
import { SmartLocalStorage } from '@/common/LocalStorage';
import globals from '@/common/globals';
import { CloudClient } from '@/lib/cloud/CloudClient';

interface State {
  initialized: boolean
  licenses: TransportLicenseKey[]
  error: CloudError | Error | null
  now: Date
  status: LicenseStatus,
  installationId: string | null
}

const log = rawLog.scope('LicenseModule')

const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds

const defaultStatus = new LicenseStatus()
Object.assign(defaultStatus, {
  edition: "community",
  condition: "initial",
})

export const LicenseModule: Module<State, RootState>  = {
  namespaced: true,
  state: () => ({
    initialized: false,
    licenses: [],
    error: null,
    now: new Date(),
    status: defaultStatus,
    installationId: null
  }),
  getters: {
    trialLicense(state) {
      return state.licenses.find((l) => l.licenseType === 'TrialLicense')
    },
    realLicenses(state) {
      return state.licenses.filter((l) => l.licenseType !== 'TrialLicense')
    },
    licenseDaysLeft(state) {
      const validUntil = state.status.license.validUntil.getTime()
      const now = state.now.getTime()
      return Math.round((validUntil - now) / oneDay);
    },
    noLicensesFound(state) {
      return state.licenses.length === 0
    },
    isUltimate(state) {
      if (!state) return false
      return state.status.isUltimate
    },
    isCommunity(state) {
      if (!state) return true
      return state.status.isCommunity
    },
    isTrial(state) {
      if (!state) return true
      return state.status.isTrial
    },
    isValidStateExpired(state) {
      // this means a license with lifetime perms, but is no longer valid for software updates
      // so the user has to use an older version of the app.
      return state.status.isValidDateExpired
    }
  },
  mutations: {
    set(state, licenses: TransportLicenseKey[]) {
      state.licenses = licenses
    },
    setInitialized(state, b: boolean) {
      state.initialized = b
    },
    installationId(state, id: string) {
      state.installationId = id
    },
    setNow(state, date: Date) {
      state.now = date
    },
    setStatus(state, status: LicenseStatus) {
      state.status = status
    },
  },
  actions: {
    async init(context) {
      if (context.state.initialized) {
        log.warn('Already initialized')
        return
      }
      await context.dispatch('sync')
      const installationId = await Vue.prototype.$util.send('license/getInstallationId');
      context.commit('installationId', installationId)


      if (!window.platformInfo.isDevelopment) {
        // refreshing in dev mode resets the dev credentials added by the menu
        setInterval(() => context.dispatch('sync'), globals.licenseCheckInterval)
      } else {
        log.warn("Credential refreshing is disabled (dev mode detected)")
      }
      context.commit('setInitialized', true)
    },
    async createTrialWithBackend() {
      try {
        // Generate device ID (hardware-based, persistent)
        log.info('[TRIAL] Generating device ID...');
        const deviceId = await getOrCreateDeviceId();
        log.info(`[TRIAL] Device ID generated: ${deviceId}`);
        
        const API_URL = (window.platformInfo as any).apiUrl || 'http://localhost:8080';
        log.info(`[TRIAL] API URL: ${API_URL}`);
        
        log.info(`[TRIAL] Calling backend API to create trial...`);
        
        // Call backend to create trial tenant
        const response = await fetch(`${API_URL}/api/trial/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId })
        });
        
        log.info(`[TRIAL] Backend response status: ${response.status}`);
        
        const data = await response.json();
        log.info('[TRIAL] Backend response data:', data);
        
        if (!response.ok) {
          // Trial already exists or error
          if (data.tenantId && !data.isExpired) {
            // Trial exists and is active - use it
            log.info('[TRIAL] Trial already exists for this device, reusing...');
            localStorage.setItem('tenantId', data.tenantId);
            log.info('[TRIAL] Stored tenantId in localStorage:', data.tenantId);
            log.info('[TRIAL] Verifying localStorage:', localStorage.getItem('tenantId'));
            return { 
              success: true, 
              tenantId: data.tenantId, 
              maxAiAnalyses: data.maxAiAnalyses,
              existing: true 
            };
          }
          throw new Error(data.message || data.error);
        }
        
        // Store tenantId for AI features
        localStorage.setItem('tenantId', data.tenantId);
        localStorage.setItem('trialStartDate', new Date().toISOString());
        localStorage.setItem('trialEndDate', data.trialEndDate);
        
        log.info(`[TRIAL] Trial created successfully! TenantId: ${data.tenantId.substring(0, 8)}...`);
        log.info('[TRIAL] Stored tenantId in localStorage:', data.tenantId);
        log.info('[TRIAL] Verifying localStorage:', localStorage.getItem('tenantId'));
        
        return { 
          success: true, 
          tenantId: data.tenantId,
          maxAiAnalyses: data.maxAiAnalyses,
          existing: false
        };
        
      } catch (error) {
        log.error('[TRIAL] Failed to create trial:', error);
        throw error;
      }
    },
    async add(context, { email, key, trial }) {
      if (trial) {
        try {
          log.info('[TRIAL] Starting trial creation process...');
          
          // Create trial with backend integration
          const result = await context.dispatch('createTrialWithBackend');
          
          log.info('[TRIAL] Backend trial created successfully:', result);
          
          // Create local trial license (existing logic)
          await Vue.prototype.$util.send('license/createTrialLicense');
          
          // Trigger user context update to refresh AI plugin
          log.info('[TRIAL] Triggering user context update for AI plugin...');
          sendUserContextToPlugin();
          window.dispatchEvent(new CustomEvent('user-context-updated'));
          
          // Show success notification
          const maxAnalyses = result.maxAiAnalyses || 10;
          const message = result.existing
            ? `Your trial is already active with ${maxAnalyses} AI analyses!`
            : `Your 14-day free trial has started with ${maxAnalyses} AI analyses!`;
          
          await Vue.prototype.$noty.success(message);
        } catch (error) {
          log.error('[TRIAL] Error creating trial with backend:', error);
          log.error('[TRIAL] Error details:', error.message, error.stack);
          
          // Check if trial has expired
          if (error.message && error.message.includes('trial has expired')) {
            log.info('[TRIAL] Trial has expired - user should remain on free community edition');
            await Vue.prototype.$noty.error("Your trial has expired. Please upgrade to continue using AI features.");
            throw error; // Don't create local trial, keep user on community edition
          }
          
          // For other errors (network issues, etc), fallback to local trial
          await Vue.prototype.$util.send('license/createTrialLicense');
          await Vue.prototype.$noty.warning("Trial started locally. Backend connection failed - AI features may not work.");
        }
      } else {
        // Get the installation ID and device info from the backend
        const installationId = context.state.installationId
        const deviceInfo = await Vue.prototype.$util.send('license/getDeviceInfo');

        const result = await CloudClient.getLicense(
          window.platformInfo.cloudUrl,
          email,
          key,
          installationId,
          window.platformInfo,
          deviceInfo.deviceId,
          deviceInfo.deviceName,
          deviceInfo.deviceOS
        );

        // if we got here, license is good.
        const license = {} as TransportLicenseKey;
        license.key = key;
        license.email = email;
        license.validUntil = new Date(result.validUntil);
        license.supportUntil = new Date(result.supportUntil);
        license.maxAllowedAppRelease = result.maxAllowedAppRelease;
        license.licenseType = result.licenseType;
        await Vue.prototype.$util.send('appdb/license/save', { obj: license });
      }
      // allow emitting expired license events next time
      SmartLocalStorage.setBool('expiredLicenseEventsEmitted', false)
      await context.dispatch('sync')
    },
    async update(_context, license: TransportLicenseKey) {
      // This is to allow for dev switching
      const isDevUpdate = window.platformInfo.isDevelopment && license.email == "fake_email";
      try {
        // Get the installation ID and device info from the backend
        const installationId = _context.state.installationId
        const deviceInfo = await Vue.prototype.$util.send('license/getDeviceInfo');

        const data = isDevUpdate ? license : await CloudClient.getLicense(
          window.platformInfo.cloudUrl,
          license.email,
          license.key,
          installationId,
          window.platformInfo,
          deviceInfo.deviceId,
          deviceInfo.deviceName,
          deviceInfo.deviceOS
        );

        license.validUntil = new Date(data.validUntil)
        license.supportUntil = new Date(data.supportUntil)
        license.maxAllowedAppRelease = data.maxAllowedAppRelease
        await Vue.prototype.$util.send('appdb/license/save', { obj: license });
      } catch (error) {
        if (error instanceof CloudError) {
          // Check if this is a device conflict error (403)
          if (error.status === 403 && error.errors.some(e => e.includes('already activated on another device'))) {
            log.error("Device conflict detected:", error.errors);
            await Vue.prototype.$noty.error(
              "License Already Activated\n\n" +
              error.errors.join("\n") + "\n\n" +
              "Please deactivate the license on the other device first, or contact support.",
              { timeout: 10000 }
            );
          } else {
            // eg 403, 404, license not valid
            license.validUntil = new Date()
            await Vue.prototype.$util.send('appdb/license/save', { obj: license });
          }
        } else {
          log.error("Problems getting license", error)
          // eg 500 errors
          // do nothing
        }
      }
    },
    async updateAll(context) {
      for (let index = 0; index < context.getters.realLicenses.length; index++) {
        const license = context.getters.realLicenses[index];
        await context.dispatch('update', license);
      }
      await context.dispatch('sync');
    },
    async remove(context, license) {
      await Vue.prototype.$util.send('license/remove', { id: license.id })
      await context.dispatch('sync')
    },
    async sync(context) {
      const status = await Vue.prototype.$util.send('license/getStatus')
      const licenses = await Vue.prototype.$util.send('license/get')
      context.commit('set', licenses)
      context.commit('setStatus', status)
      context.commit('setNow', new Date())
    },
  }
}
