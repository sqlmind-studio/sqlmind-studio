/**
 * Log AI usage to the backend API
 */

const env = (import.meta as any).env || {};
const API_BASE_URL = (window as any)?.platformInfo?.cloudUrl || env.VITE_API_BASE_URL || env.VITE_API_URL || '';
// Secret should come from environment variables only
const PLUGIN_SECRET = env.VITE_PLUGIN_SECRET || '';

export interface UsageLogData {
  tenantId?: string;
  workspaceId?: string;
  connectionId?: string;
  userId?: string;
  providerId: string;
  modelId: string;
  requestType: 'chat' | 'inline' | 'analysis' | 'completion';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestDuration: number; // milliseconds
  success: boolean;
  errorMessage?: string;
  queryText?: string; // For inline AI / query generation
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

/**
 * Log AI usage to the backend
 */
export async function logAIUsage(data: UsageLogData): Promise<void> {
  try {
    const url = `${API_BASE_URL}/api/ai/usage`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (PLUGIN_SECRET) {
      headers['X-Plugin-Secret'] = PLUGIN_SECRET;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...data,
        estimatedCost: calculateCost(
          data.inputTokens,
          data.outputTokens,
          data.inputPricePerMillion,
          data.outputPricePerMillion
        ),
        actualCost: calculateCost(
          data.inputTokens,
          data.outputTokens,
          data.inputPricePerMillion,
          data.outputPricePerMillion
        ),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[usageLogger] Failed to log usage:', errorText);
    } else {
      console.log('[usageLogger] Successfully logged AI usage:', data.modelId, data.totalTokens, 'tokens');
    }
  } catch (error) {
    // Don't throw - logging failures shouldn't break the app
    console.error('[usageLogger] Error logging AI usage:', error);
  }
}

/**
 * Calculate cost based on token usage and pricing
 */
function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillion?: number,
  outputPricePerMillion?: number
): number {
  if (!inputPricePerMillion || !outputPricePerMillion) {
    return 0;
  }
  
  const inputCost = (inputTokens / 1_000_000) * inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * outputPricePerMillion;
  
  return inputCost + outputCost;
}
