// Configuration for CloudClient
// This file provides the plugin secret for API authentication

export const CloudConfig = {
  // Plugin secret for authenticating with the backend API
  // This should match the PLUGIN_SECRET in your sqltools-api/.env file
  getPluginSecret(): string {
    // Try to get from environment variables first
    if (process.env.VUE_APP_PLUGIN_SECRET) {
      return process.env.VUE_APP_PLUGIN_SECRET
    }
    if (process.env.PLUGIN_SECRET) {
      return process.env.PLUGIN_SECRET
    }
    
    // Fallback: Read from a config file or return empty string
    // In production, you should set this via environment variables
    // For development, you can temporarily set it here
    return ''
  }
}
