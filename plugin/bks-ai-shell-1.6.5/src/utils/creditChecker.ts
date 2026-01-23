import axios from 'axios';

interface UsageData {
  RemainingAnalyses: number;
  ExtraAnalysesAvailable: number;
  MaxAnalysesPerMonth?: number | null;
  CurrentMonthAnalyses?: number;
  SubscriptionStatus: string | null;
}

export async function checkCreditsAvailable(): Promise<{
  hasCredits: boolean;
  message: string;
  creditsLeft: number;
}> {
  try {
    const tenantId = localStorage.getItem('tenantId');
    
    if (!tenantId) {
      return {
        hasCredits: false,
        message: 'Not authenticated. Please log in to use AI features.',
        creditsLeft: 0,
      };
    }

    const env = (import.meta as any).env || {};
    const API_URL = (window as any)?.platformInfo?.cloudUrl || env.VITE_API_BASE_URL || env.VITE_API_URL || '';
    const PLUGIN_SECRET = env.VITE_PLUGIN_SECRET || '';
    
    const response = await axios.get<UsageData>(
      `${API_URL}/api/ai/usage/summary?tenantId=${tenantId}`,
      {
        headers: {
          'X-Plugin-Secret': PLUGIN_SECRET
        }
      }
    );

    const addOnCredits = response.data.ExtraAnalysesAvailable || 0;
    const monthlyLimit = response.data.MaxAnalysesPerMonth;
    const used = response.data.CurrentMonthAnalyses || 0;

    const creditsLeft =
      monthlyLimit != null
        ? Math.max(0, (monthlyLimit + addOnCredits) - used)
        : (response.data.RemainingAnalyses || 0);
    
    if (creditsLeft <= 0) {
      if (response.data.SubscriptionStatus === 'expired') {
        return {
          hasCredits: false,
          message: 'Your subscription has expired. Please renew your subscription to continue using AI features.',
          creditsLeft: 0,
        };
      }
      return {
        hasCredits: false,
        message: "You've used all your credits for this month. Please upgrade your plan or purchase add-ons to continue.",
        creditsLeft: 0,
      };
    }

    return {
      hasCredits: true,
      message: '',
      creditsLeft,
    };
  } catch (error) {
    console.error('[CreditChecker] Failed to check credits:', error);
    const status = (error as any)?.response?.status;
    if (status === 401 || status === 403 || status === 404) {
      return {
        hasCredits: false,
        message: 'Your account is not active or was deleted. Please sign in again or upgrade to a paid plan to use AI features.',
        creditsLeft: 0,
      };
    }

    // Fail-open only for transient errors (network/timeouts) to avoid breaking the UI unnecessarily.
    return {
      hasCredits: true,
      message: '',
      creditsLeft: -1,
    };
  }
}
