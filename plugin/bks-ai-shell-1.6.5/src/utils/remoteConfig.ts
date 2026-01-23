/**
 * Fetch AI provider credentials from the backend API
 */

const env = (import.meta as any).env || {};
const API_BASE_URL = (window as any)?.platformInfo?.cloudUrl || env.VITE_API_BASE_URL || env.VITE_API_URL || '';
const PLUGIN_SECRET = env.VITE_PLUGIN_SECRET || '';

function getTenantId(): string {
  try {
    return localStorage.getItem('tenantId') || '';
  } catch {
    return '';
  }
}

export async function fetchProviderApiKey(providerId: string): Promise<string> {
  try {
    const tenantId = getTenantId();
    const url = `${API_BASE_URL}/api/ai/credentials?providerId=${encodeURIComponent(providerId)}&tenantId=${encodeURIComponent(tenantId)}`;
    
    console.log('[remoteConfig] Fetching API key from:', url);
    console.log('[remoteConfig] API_BASE_URL:', API_BASE_URL);
    console.log('[remoteConfig] PLUGIN_SECRET:', PLUGIN_SECRET ? '***set***' : 'not set');
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (PLUGIN_SECRET) {
      headers['X-Plugin-Secret'] = PLUGIN_SECRET;
    }

    console.log('[remoteConfig] Request headers:', headers);

    const response = await fetch(url, { 
      method: 'GET',
      headers,
      mode: 'cors'
    });

    console.log('[remoteConfig] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[remoteConfig] Error response:', errorText);
      throw new Error(`Failed to fetch API key for ${providerId}: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const apiKey = typeof data?.apiKey === 'string' ? data.apiKey : '';
    const masked = apiKey ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '';
    console.log('[remoteConfig] API key type:', typeof data?.apiKey);
    console.log('[remoteConfig] API key length:', apiKey ? apiKey.length : 0);
    if (apiKey) console.log('[remoteConfig] API key masked preview:', masked);
    
    if (!apiKey) {
      throw new Error(`No API key returned for provider: ${providerId}`);
    }

    console.log('[remoteConfig] Successfully fetched API key for', providerId);
    return apiKey;
  } catch (error) {
    console.error(`[remoteConfig] Error fetching API key for ${providerId}:`, error);
    throw error;
  }
}

export async function fetchProviders(): Promise<any[]> {
  try {
    const tenantId = getTenantId();
    const url = `${API_BASE_URL}/api/ai/providers?tenantId=${encodeURIComponent(tenantId)}`;
    
    const headers: Record<string, string> = {};
    if (PLUGIN_SECRET) {
      headers['X-Plugin-Secret'] = PLUGIN_SECRET;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch providers: ${response.status}`);
    }

    const data = await response.json();
    return data.providers || [];
  } catch (error) {
    console.error('[remoteConfig] Error fetching providers:', error);
    return [];
  }
}

export async function fetchModels(providerId?: string): Promise<any[]> {
  try {
    const tenantId = getTenantId();
    const url = providerId 
      ? `${API_BASE_URL}/api/ai/models?providerId=${encodeURIComponent(providerId)}&tenantId=${encodeURIComponent(tenantId)}`
      : `${API_BASE_URL}/api/ai/models?tenantId=${encodeURIComponent(tenantId)}`;
    
    const headers: Record<string, string> = {};
    if (PLUGIN_SECRET) {
      headers['X-Plugin-Secret'] = PLUGIN_SECRET;
    }

    const response = await fetch(url, { 
      headers,
      cache: 'no-cache' // Prevent browser caching
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = await response.json();
    return data.models || [];
  } catch (error) {
    console.error('[remoteConfig] Error fetching models:', error);
    return [];
  }
}
