<template>
  <div class="ai-usage-panel" :class="{ 'collapsed': isCollapsed }">
    <div class="panel-header" @click="toggleCollapse">
      <div class="header-left">
        <span class="material-symbols-outlined">analytics</span>
        <span class="panel-title">Plan</span>
      </div>
      <button class="btn-icon refresh-btn" @click.stop="refreshUsage" :disabled="loading">
        <span class="material-symbols-outlined" :class="{ 'spinning': loading }">refresh</span>
      </button>
    </div>

    <div v-if="!isCollapsed" class="panel-content">
      <!-- Loading State -->
      <div v-if="loading && !usageData" class="loading-state">
        <span class="spinner"></span>
        <span>Loading usage data...</span>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="error-state">
        <span class="material-symbols-outlined">error</span>
        <span>{{ error }}</span>
      </div>

      <!-- Usage Data -->
      <div v-else-if="usageData" class="usage-content">
        <!-- Renewal Info / Trial Info -->
        <div class="renewal-info">
          <span class="text-muted" v-if="!isTrialUser">Credits renew every month</span>
          <span class="text-muted trial-badge" v-else>
            <span class="material-symbols-outlined">schedule</span>
            Free Trial
          </span>
          <span class="renewal-date" v-if="subscriptionInfo">{{ subscriptionInfo }}</span>
          <span class="renewal-date" v-else-if="!isTrialUser">Monthly subscription</span>
        </div>

        <!-- Low Credits Warning -->
        <div v-if="isLowCredits" class="warning-banner" :class="creditWarningLevel">
          <span class="material-symbols-outlined">{{ creditWarningIcon }}</span>
          <span>{{ creditWarningMessage }}</span>
        </div>

        <!-- Credits Left -->
        <div class="credits-section">
          <div class="credits-main">
            <span class="credits-number" :class="{ 'low-credits': isLowCredits, 'no-credits': creditsLeft === 0 }">{{ creditsLeft }}</span>
            <span class="credits-label">credits left</span>
          </div>
          <button class="btn-link view-breakdown" @click="showBreakdown = !showBreakdown">
            View Breakdown
            <span class="material-symbols-outlined">{{ showBreakdown ? 'expand_less' : 'expand_more' }}</span>
          </button>
        </div>

        <!-- Breakdown Details -->
        <div v-if="showBreakdown" class="breakdown-section">
          <div class="breakdown-item">
            <span class="label">Total Analyses:</span>
            <span class="value">{{ usageData.CurrentMonthAnalyses || 0 }}</span>
          </div>
          <div class="breakdown-item">
            <span class="label">Add-on Credits:</span>
            <span class="value">{{ usageData.ExtraAnalysesAvailable || 0 }}</span>
          </div>
        </div>

        <!-- Plan Info -->
        <div class="plan-section">
          <div class="plan-name">{{ usageData.TierName || 'Free' }}</div>
          <div class="plan-email">{{ userEmail }}</div>
        </div>

        <!-- Progress Bar -->
        <div class="progress-section">
          <div class="progress-bar">
            <div 
              class="progress-fill" 
              :style="{ width: usagePercent + '%' }"
              :class="{ 'warning': usagePercent >= 80, 'danger': usagePercent >= 95 }"
            ></div>
          </div>
          <div class="progress-text">
            {{ usageData.CurrentMonthAnalyses || 0 }} / {{ maxAnalyses }} analyses used
          </div>
        </div>

        <!-- Action Links -->
        <div class="action-links">
          <a href="#" @click.prevent="openManage" class="action-link">
            <span class="material-symbols-outlined">settings</span>
            Manage →
          </a>
          <a href="#" @click.prevent="openUpgrade" class="action-link">
            <span class="material-symbols-outlined">upgrade</span>
            Upgrade →
          </a>
        </div>

        <!-- Referral Section -->
        <div class="referral-section">
          <a href="#" @click.prevent="openAddons" class="referral-text">Need more credits? Click here →</a>
          <a href="#" @click.prevent="openReferral" class="referral-bonus">Refer a friend to a paid plan to get 250 bonus add-on credits →</a>
        </div>

        <!-- Tabs -->
        <div class="tabs-section">
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'info' }"
            @click="activeTab = 'info'"
          >
            Plan Info
          </button>
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'settings' }"
            @click="activeTab = 'settings'"
          >
            Settings
          </button>
          <button 
            class="tab-btn" 
            :class="{ active: activeTab === 'shortcuts' }"
            @click="activeTab = 'shortcuts'"
          >
            AI Shortcuts
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import axios from 'axios';

interface UsageData {
  TierName: string;
  CurrentMonthAnalyses: number;
  MaxAnalysesPerMonth: number | null;
  RemainingAnalyses: number;
  ExtraAnalysesAvailable: number;
  CurrentMonthApiCost: number;
  CurrentMonthTokens: number;
  UsagePercent: number;
  SubscriptionStatus: string | null;
  SubscriptionStartDate: string | null;
  SubscriptionEndDate: string | null;
  SuccessfulAnalyses: number;
}

export default defineComponent({
  name: 'AiUsagePanel',

  data() {
    return {
      isCollapsed: false,
      showBreakdown: false,
      loading: false,
      error: null as string | null,
      usageData: null as UsageData | null,
      activeTab: 'info' as 'info' | 'settings' | 'shortcuts',
      userEmail: '',
    };
  },

  computed: {
    creditsLeft(): number {
      if (!this.usageData) return 0;
      // Avoid double-counting: RemainingAnalyses from API may already include add-on credits.
      // Always derive remaining from the displayed "X / Y analyses used" numbers.
      const monthlyLimit = this.usageData.MaxAnalysesPerMonth;
      if (monthlyLimit == null) return 0;
      const addOnCredits = this.usageData.ExtraAnalysesAvailable || 0;
      const used = this.usageData.CurrentMonthAnalyses || 0;
      const totalAvailable = monthlyLimit + addOnCredits;
      return Math.max(0, totalAvailable - used);
    },

    maxAnalyses(): string {
      if (!this.usageData || !this.usageData.MaxAnalysesPerMonth) return '∞';
      // Total = monthly plan limit + add-on credits
      const monthlyLimit = this.usageData.MaxAnalysesPerMonth;
      const addOnCredits = this.usageData.ExtraAnalysesAvailable || 0;
      const totalAvailable = monthlyLimit + addOnCredits;
      return totalAvailable.toString();
    },

    usagePercent(): number {
      if (!this.usageData || !this.usageData.MaxAnalysesPerMonth) return 0;
      // Calculate percentage based on total available credits (monthly + add-on)
      const monthlyLimit = this.usageData.MaxAnalysesPerMonth;
      const addOnCredits = this.usageData.ExtraAnalysesAvailable || 0;
      const totalAvailable = monthlyLimit + addOnCredits;
      const used = this.usageData.CurrentMonthAnalyses || 0;
      const percent = (used / totalAvailable) * 100;
      return Math.min(Math.round(percent), 100);
    },

    renewalDate(): string {
      if (!this.usageData?.SubscriptionEndDate) return 'N/A';
      const date = new Date(this.usageData.SubscriptionEndDate);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    daysUntilRenewal(): number {
      if (!this.usageData?.SubscriptionEndDate) return 0;
      const endDate = new Date(this.usageData.SubscriptionEndDate);
      const today = new Date();
      const diffTime = endDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    },

    isTrialUser(): boolean {
      if (!this.usageData) return false;
      return this.usageData.SubscriptionStatus === 'trial';
    },

    subscriptionInfo(): string | null {
      if (!this.usageData) return null;
      
      const status = this.usageData.SubscriptionStatus;
      const endDate = this.usageData.SubscriptionEndDate;
      
      // If no end date, it's a monthly subscription
      if (!endDate) {
        return status === 'active' ? 'Active subscription' : null;
      }
      
      const days = this.daysUntilRenewal;
      const formattedDate = this.renewalDate;
      
      // Show different messages based on status and days remaining
      if (status === 'trial') {
        if (days === 0) {
          return `Trial ends today`;
        } else if (days === 1) {
          return `Trial ends in 1 day`;
        } else {
          return `Trial ends in ${days} days`;
        }
      } else if (status === 'active') {
        if (days === 0) {
          return `Plan ends today (${formattedDate})`;
        } else if (days === 1) {
          return `Plan ends in 1 day (${formattedDate})`;
        } else {
          return `Plan ends in ${days} days (${formattedDate})`;
        }
      } else if (status === 'expired') {
        return `Plan expired on ${formattedDate}`;
      } else if (status === 'cancelled') {
        return `Plan cancelled, ends on ${formattedDate}`;
      }
      
      return null;
    },

    isLowCredits(): boolean {
      if (!this.usageData) return false;
      const maxCredits = this.usageData.MaxAnalysesPerMonth || 0;
      if (maxCredits === 0) return false; // Unlimited
      const percentRemaining = (this.creditsLeft / maxCredits) * 100;
      return percentRemaining <= 20 || this.creditsLeft === 0;
    },

    creditWarningLevel(): string {
      if (this.creditsLeft === 0) return 'critical';
      const maxCredits = this.usageData?.MaxAnalysesPerMonth || 0;
      if (maxCredits === 0) return '';
      const percentRemaining = (this.creditsLeft / maxCredits) * 100;
      if (percentRemaining <= 10) return 'critical';
      return 'warning';
    },

    creditWarningIcon(): string {
      if (this.creditsLeft === 0) return 'block';
      return 'warning';
    },

    creditWarningMessage(): string {
      if (this.creditsLeft === 0) {
        if (this.usageData?.SubscriptionStatus === 'expired') {
          return 'Your subscription has expired. Renew to continue using AI features.';
        }
        return "You've used all your credits for this month. Upgrade or buy add-ons to continue.";
      }
      const maxCredits = this.usageData?.MaxAnalysesPerMonth || 0;
      const percentRemaining = (this.creditsLeft / maxCredits) * 100;
      if (percentRemaining <= 10) {
        return 'Critical: Running very low on credits. Consider upgrading your plan.';
      }
      return 'Warning: Running low on credits. Consider upgrading or purchasing add-ons.';
    },

  },

  mounted() {
    console.log('[AiUsagePanel] Component mounted');
    
    // Delay initial fetch to allow user context to be set
    setTimeout(() => {
      console.log('[AiUsagePanel] Initial fetch after delay');
      this.fetchUsageData();
    }, 1000);
    
    // Listen for storage changes (when user logs in/out)
    window.addEventListener('storage', this.handleStorageChange);
    
    // Also listen for custom event from main app
    window.addEventListener('user-context-updated', this.handleContextUpdate);
    
    // Listen for postMessage from main app (will be handled by main.ts first)
    window.addEventListener('message', this.handleMessage);
  },

  beforeUnmount() {
    window.removeEventListener('storage', this.handleStorageChange);
    window.removeEventListener('user-context-updated', this.handleContextUpdate);
    window.removeEventListener('message', this.handleMessage);
  },

  methods: {
    toggleCollapse() {
      this.isCollapsed = !this.isCollapsed;
    },

    async refreshUsage() {
      await this.fetchUsageData();
    },

    async fetchUsageData() {
      console.log('[AiUsagePanel] fetchUsageData called');
      this.loading = true;
      this.error = null;

      try {
        // Get tenant ID and user email from localStorage (set by main app)
        const tenantId = localStorage.getItem('tenantId');
        const userId = localStorage.getItem('userId');
        const userEmail = localStorage.getItem('userEmail');
        const workspaceId = localStorage.getItem('workspaceId');
        const hasLoggedOut = localStorage.getItem('hasLoggedOut') === 'true';
        
        console.log('[AiUsagePanel] localStorage values:', {
          tenantId,
          userId,
          userEmail,
          workspaceId,
          hasLoggedOut
        });
        
        // If user has explicitly logged out, don't show data even if tenantId exists (from fallback)
        if (hasLoggedOut) {
          console.warn('[AiUsagePanel] User has logged out, clearing data');
          this.error = 'Not authenticated. Please sign in to view usage.';
          this.usageData = null;
          this.userEmail = '';
          return;
        }
        
        // If no tenantId AND no userEmail, user is not authenticated
        // Note: Device-based trials have tenantId but no userEmail
        if (!tenantId && !userEmail) {
          console.warn('[AiUsagePanel] No tenantId or userEmail found in localStorage');
          this.error = 'Not authenticated. Please sign in to view usage.';
          this.usageData = null; // Clear any cached data
          this.userEmail = '';
          return;
        }

        // Set user email for display (or indicate device-based trial)
        if (userEmail) {
          this.userEmail = userEmail;
        } else if (tenantId) {
          this.userEmail = '(Device-based trial)';
        }

        // Get API URL and plugin secret from environment or config
        const hostCloudUrl = (window as any)?.platformInfo?.cloudUrl;
        const env = (import.meta as any).env || {};
        const API_URL = hostCloudUrl || env.VITE_API_BASE_URL || env.VITE_API_URL || '';
        const PLUGIN_SECRET = env.VITE_PLUGIN_SECRET || '';
        
        const url = `${API_URL}/api/ai/usage/summary?tenantId=${tenantId}`;
        console.log('[AiUsagePanel] Fetching from:', url);
        
        const response = await axios.get(url, {
          headers: {
            'X-Plugin-Secret': PLUGIN_SECRET
          }
        });

        this.usageData = response.data;
        console.log('[AiUsagePanel] Usage data loaded successfully:', this.usageData);
      } catch (err: any) {
        console.error('[AiUsagePanel] Failed to fetch usage data:', err);
        console.error('[AiUsagePanel] Error response:', err.response?.data);
        this.error = err.response?.data?.error || 'Failed to load usage data';
      } finally {
        this.loading = false;
      }
    },

    formatNumber(num: number): string {
      return num.toLocaleString();
    },

    handleStorageChange(event: StorageEvent) {
      // Refresh when tenantId, userEmail, or logout flag changes
      if (event.key === 'tenantId' || event.key === 'userEmail' || event.key === 'hasLoggedOut') {
        console.log('[AiUsagePanel] Storage changed:', { key: event.key, newValue: event.newValue, oldValue: event.oldValue });
        
        // If logout flag was set, clear the data immediately
        if (event.key === 'hasLoggedOut' && event.newValue === 'true') {
          console.log('[AiUsagePanel] User logged out, clearing usage data');
          this.usageData = null;
          this.userEmail = '';
          this.error = 'Not authenticated. Please sign in to view usage.';
          return;
        }
        
        // If tenantId or userEmail was removed (logout), clear the data immediately
        if ((event.key === 'tenantId' || event.key === 'userEmail') && !event.newValue) {
          console.log('[AiUsagePanel] Auth data removed, clearing usage data');
          this.usageData = null;
          this.userEmail = '';
          this.error = 'Not authenticated. Please sign in to view usage.';
          return;
        }
        
        console.log('[AiUsagePanel] Refreshing usage data');
        this.fetchUsageData();
      }
    },

    handleContextUpdate() {
      // Refresh when user context is updated from main app
      console.log('[AiUsagePanel] User context updated, refreshing usage data');
      this.fetchUsageData();
    },

    handleMessage(event: MessageEvent) {
      // Handle postMessage from main app
      if (event.data?.type === 'bks-ai/user-context' || event.data?.type === 'user-context') {
        console.log('[AiUsagePanel] Received user context via postMessage:', event.data);
        
        // Wait a bit for main.ts to update localStorage, then fetch
        setTimeout(() => {
          console.log('[AiUsagePanel] Fetching usage data after receiving user context');
          this.fetchUsageData();
        }, 100);
      }
    },

    openManage() {
      // Open account management page
      this.$openExternal('https://sqltools.co/account/subscription');
    },

    openUpgrade() {
      // Open upgrade/pricing page
      this.$openExternal('https://sqltools.co/pricing');
    },

    openAddons() {
      // Open add-ons purchase page
      this.$openExternal('https://sqltools.co/account/addons');
    },

    openReferral() {
      // Open referral program page
      this.$openExternal('https://sqltools.co/referral');
    },
  },
});
</script>

<style scoped lang="scss">
.ai-usage-panel {
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  font-size: 13px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-bottom: 12px;

  &.collapsed .panel-content {
    display: none;
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: #f0f1f2;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: #333;

    .material-symbols-outlined {
      font-size: 20px;
    }
  }

  .refresh-btn {
    padding: 4px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: #666;

    &:hover {
      color: #333;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .spinning {
      animation: spin 1s linear infinite;
    }
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.panel-content {
  padding: 16px;
}

.loading-state,
.error-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: #666;

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #e0e0e0;
    border-top-color: #666;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
}

.error-state {
  color: #d32f2f;
}

.renewal-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
  font-size: 12px;

  .text-muted {
    color: #999;

    &.trial-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-weight: 600;
      font-size: 13px;
      width: fit-content;

      .material-symbols-outlined {
        font-size: 16px;
      }
    }
  }

  .renewal-date {
    color: #666;
    font-weight: 500;
  }
}

.warning-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 13px;
  font-weight: 500;

  .material-symbols-outlined {
    font-size: 20px;
    flex-shrink: 0;
  }

  &.warning {
    background: #fff3cd;
    border: 1px solid #ffc107;
    color: #856404;

    .material-symbols-outlined {
      color: #ffc107;
    }
  }

  &.critical {
    background: #f8d7da;
    border: 1px solid #f5c6cb;
    color: #721c24;

    .material-symbols-outlined {
      color: #dc3545;
    }
  }
}

.credits-section {
  margin-bottom: 16px;

  .credits-main {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;

    .credits-number {
      font-size: 32px;
      font-weight: 700;
      color: #333;

      &.low-credits {
        color: #f57c00;
      }

      &.no-credits {
        color: #d32f2f;
      }
    }

    .credits-label {
      font-size: 14px;
      color: #666;
    }
  }

  .view-breakdown {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #1976d2;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 13px;

    &:hover {
      text-decoration: underline;
    }

    .material-symbols-outlined {
      font-size: 18px;
    }
  }
}

.breakdown-section {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 16px;

  .breakdown-item {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #e0e0e0;

    &:last-child {
      border-bottom: none;
    }

    .label {
      color: #666;
    }

    .value {
      font-weight: 600;
      color: #333;
    }
  }
}

.plan-section {
  margin-bottom: 16px;

  .plan-name {
    font-weight: 600;
    font-size: 16px;
    color: #333;
    margin-bottom: 4px;
  }

  .plan-email {
    color: #666;
    font-size: 12px;
  }
}

.progress-section {
  margin-bottom: 16px;

  .progress-bar {
    height: 8px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4caf50, #66bb6a);
      transition: width 0.3s ease;

      &.warning {
        background: linear-gradient(90deg, #ff9800, #ffb74d);
      }

      &.danger {
        background: linear-gradient(90deg, #f44336, #ef5350);
      }
    }
  }

  .progress-text {
    font-size: 12px;
    color: #666;
  }
}

.action-links {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;

  .action-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #1976d2;
    text-decoration: none;
    font-weight: 500;
    font-size: 14px;

    &:hover {
      text-decoration: underline;
      color: #1565c0;
    }

    .material-symbols-outlined {
      font-size: 18px;
    }
  }
}

.referral-section {
  background: #f0f7ff;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 16px;
  font-size: 12px;

  .referral-text {
    display: block;
    color: #1976d2;
    margin-bottom: 6px;
    cursor: pointer;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
      color: #1565c0;
    }
  }

  .referral-bonus {
    display: block;
    color: #666;
    cursor: pointer;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
      color: #333;
    }
  }
}

.tabs-section {
  display: flex;
  gap: 4px;
  border-top: 1px solid #e0e0e0;
  padding-top: 12px;

  .tab-btn {
    flex: 1;
    padding: 8px 12px;
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: #666;
    transition: all 0.2s;

    &:hover {
      background: #e9ecef;
    }

    &.active {
      background: #1976d2;
      color: white;
      border-color: #1976d2;
    }
  }
}
</style>
