/**
 * AI User Context Helper
 * Sends user/tenant/workspace/connection context to the AI plugin iframe
 */

interface UserContext {
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  workspaceId?: string;
  connectionId?: string;
}

/**
 * Get tenant ID from localStorage or environment
 */
function getTenantId(): string | undefined {
  try {
    // Check if user has explicitly logged out
    const hasLoggedOut = localStorage.getItem('hasLoggedOut') === 'true';
    
    // Option 1: From localStorage (authenticated user or trial)
    const stored = localStorage.getItem('tenantId');
    if (stored) {
      // Clear logout flag if user has a valid tenantId (logged in or started trial)
      if (hasLoggedOut) {
        console.log('[AI Context] Found tenantId, clearing logout flag');
        localStorage.removeItem('hasLoggedOut');
      }
      return stored;
    }
    
    // If user has logged out and no tenantId exists, don't use fallback
    if (hasLoggedOut) {
      console.log('[AI Context] User has logged out and no tenantId found, not using fallback');
      return undefined;
    }
    
    // Option 2: From environment variable (for development/testing)
    if (import.meta.env.VITE_TENANT_ID) {
      return import.meta.env.VITE_TENANT_ID;
    }
    
    // Option 3: Generate a default based on machine/user (for local installations without auth)
    // This ensures consistent tenant ID for the same user
    const machineId = localStorage.getItem('machineId') || generateMachineId();
    return machineId;
  } catch (err) {
    console.warn('[AI Context] Failed to get tenantId:', err);
    return undefined;
  }
}

/**
 * Get user ID from localStorage or environment
 */
function getUserId(): string | undefined {
  try {
    // Option 1: From localStorage
    const stored = localStorage.getItem('userId');
    if (stored) return stored;
    
    // Option 2: From environment variable
    if (import.meta.env.VITE_USER_ID) {
      return import.meta.env.VITE_USER_ID;
    }
    
    // Option 3: Use same as tenant for local installations
    return getTenantId();
  } catch (err) {
    console.warn('[AI Context] Failed to get userId:', err);
    return undefined;
  }
}

/**
 * Generate a stable machine ID for local installations
 */
function generateMachineId(): string {
  try {
    let machineId = localStorage.getItem('machineId');
    if (!machineId) {
      // Generate a UUID-like ID based on timestamp and random
      machineId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      localStorage.setItem('machineId', machineId);
    }
    return machineId;
  } catch {
    return 'local-machine';
  }
}

/**
 * Get user email from localStorage
 */
function getUserEmail(): string | undefined {
  try {
    return localStorage.getItem('userEmail') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get workspace ID (if your app has workspaces)
 */
function getWorkspaceId(): string | undefined {
  try {
    return localStorage.getItem('workspaceId') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get connection ID from the active connection
 */
function getConnectionId(connection: any): string | undefined {
  try {
    // Try various possible ID fields
    return connection?.id || 
           connection?.connectionId || 
           connection?._id ||
           connection?.uuid ||
           undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find the AI plugin iframe
 */
function findAIPluginIframe(): HTMLIFrameElement | null {
  try {
    const frames = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
    const match = frames.find(f => {
      try {
        const src = (f.getAttribute('src') || f.src || '').toString();
        return src.includes('plugin://bks-ai-shell') || src.includes('/bks-ai-shell/');
      } catch {
        return false;
      }
    });
    return match || null;
  } catch (err) {
    console.error('[AI Context] Error finding iframe:', err);
    return null;
  }
}

/**
 * Send user context to the AI plugin
 */
export function sendUserContextToPlugin(connection?: any): void {
  try {
    const iframe = findAIPluginIframe();
    if (!iframe || !iframe.contentWindow) {
      console.warn('[AI Context] Plugin iframe not found or not ready');
      return;
    }

    const context: UserContext = {
      tenantId: getTenantId(),
      userId: getUserId(),
      userEmail: getUserEmail(),
      workspaceId: getWorkspaceId(),
      connectionId: getConnectionId(connection),
    };

    const message = {
      type: 'bks-ai/user-context',
      ...context,
    };
    
    iframe.contentWindow.postMessage(message, '*');

    console.log('[AI Context] Sent user context to plugin:', message);
  } catch (err) {
    console.error('[AI Context] Failed to send user context:', err);
  }
}

/**
 * Initialize user context sending
 * Call this when the app loads and when context changes
 */
export function initializeAIUserContext(connection?: any): void {
  // Send immediately
  sendUserContextToPlugin(connection);
  
  // Also send after a short delay to ensure iframe is loaded
  setTimeout(() => sendUserContextToPlugin(connection), 1000);
  setTimeout(() => sendUserContextToPlugin(connection), 3000);
}
