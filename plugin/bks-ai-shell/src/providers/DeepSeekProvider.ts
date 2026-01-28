import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";

// Provider wrapper for DeepSeek's OpenAI-compatible API
// Users configure the API key in configuration store (providers.deepseek.apiKey).
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(options: { apiKey: string; headers?: Record<string, string> }) {
    super({
      // DeepSeek exposes an OpenAI-compatible endpoint at api.deepseek.com
      baseURL: "https://api.deepseek.com",
      apiKey: options.apiKey,
      headers: {
        ...(options.headers || {}),
      },
    });
  }
}
