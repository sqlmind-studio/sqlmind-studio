import { BaseProvider } from "@/providers/BaseProvider";
import { createOpenAI } from "@ai-sdk/openai";

export class OpenAICompatibleProvider extends BaseProvider {
  constructor(
    protected options: {
      baseURL: string;
      headers: Record<string, string>;
      apiKey: string;
      name?: string;
    },
  ) {
    super();
  }

  getModel(id: string) {
    return createOpenAI({
      compatibility: "compatible",
      baseURL: this.options.baseURL,
      apiKey: this.options.apiKey,
      headers: this.options.headers,
      name: this.options.name,
    }).languageModel(id);
  }

  async listModels() {
    // Ensure baseURL ends with / for correct URL resolution
    const baseURL = this.options.baseURL.endsWith('/') 
      ? this.options.baseURL 
      : this.options.baseURL + '/';
    const url = new URL("models", baseURL);

    const headers: Record<string, string> = {
      ...this.options.headers,
    };
    
    // Add Authorization header if API key is provided
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }

    console.log(`[OpenAICompatibleProvider] Fetching models from ${url.toString()}`);
    const res = await fetch(url.toString(), {
      headers,
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[OpenAICompatibleProvider] Failed to fetch models: ${res.status} ${res.statusText}`, errorText);
      throw new Error(`Failed to list models: ${res.statusText}`);
    }
    const data = await res.json();
    if (data.error) {
      console.error(`[OpenAICompatibleProvider] API returned error:`, data.error);
      throw new Error(`Failed to list models: ${JSON.stringify(data.error)}`);
    }
    try {
      const models = data.data?.map((m: any) => {
        // Check if model supports tools/function calling
        const supportsTools = m.supported_parameters?.includes('tools') || 
                             m.supported_parameters?.includes('tool_choice');
        
        return {
          id: m.id,
          displayName: m.name || m.id,
          supportsTools,
        };
      }) || [];
      console.log(`[OpenAICompatibleProvider] Successfully parsed ${models.length} models`);
      return models;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`[OpenAICompatibleProvider] Error parsing models:`, e);
      throw new Error(`Failed to list models: ${errorMessage}`);
    }
  }
}
