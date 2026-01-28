import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: { apiKey: string; headers?: Record<string, string> }) {
    super({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: options.apiKey,
      headers: {
        "HTTP-Referer": "https://sqltools.co",
        "X-Title": "SQLMind Studio AI",
        ...options.headers,
      },
    });
  }
}
