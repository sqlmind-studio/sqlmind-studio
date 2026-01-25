/**
 * Generate a unique device ID for trial tracking
 * This ID is hardware-based and cannot be easily changed
 * Uses machine ID as the TenantId to prevent trial abuse
 */
export async function getDeviceId(): Promise<string> {
  try {
    // Use Electron's IPC to get device ID from main process
    // This is necessary because Node.js modules (os, crypto) are not available in renderer
    const Vue = (window as any).Vue
    if (Vue?.prototype?.$util?.send) {
      const deviceId = await Vue.prototype.$util.send('license/getDeviceId')
      if (deviceId) {
        return deviceId
      }
    }
    
    // Fallback: generate a simple browser-based ID
    return generateBrowserDeviceId()
  } catch (error) {
    console.error('Failed to generate device ID:', error)
    return generateBrowserDeviceId()
  }
}

/**
 * Generate a browser-based device ID as fallback
 * Uses available browser APIs
 */
function generateBrowserDeviceId(): string {
  const info = [
    navigator.userAgent,
    navigator.language,
    navigator.hardwareConcurrency?.toString() || '0',
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset().toString()
  ].join('|')
  
  // Simple hash function
  let hash = 0
  for (let i = 0; i < info.length; i++) {
    const char = info.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  
  const hashStr = Math.abs(hash).toString(16).padStart(32, '0')
  
  // Format as UUID
  return [
    hashStr.substring(0, 8),
    hashStr.substring(8, 12),
    hashStr.substring(12, 16),
    hashStr.substring(16, 20),
    hashStr.substring(20, 32)
  ].join('-')
}

/**
 * Check if device ID is valid UUID format
 */
export function isValidDeviceId(deviceId: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(deviceId)
}

/**
 * Get or create device ID from localStorage
 * This ensures consistency across app restarts
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const stored = localStorage.getItem('deviceId')
  
  if (stored && isValidDeviceId(stored)) {
    return stored
  }
  
  const newDeviceId = await getDeviceId()
  localStorage.setItem('deviceId', newDeviceId)
  return newDeviceId
}
