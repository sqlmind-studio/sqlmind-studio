import { AvailableModels, providerConfigs } from "@/config";
import { BaseProvider, Messages } from "@/providers/BaseProvider";
import { createOpenAI } from "@ai-sdk/openai";
import { ToolSet } from "ai";
import { z } from "zod";

export class OpenAIProvider extends BaseProvider {
  constructor(private options: { apiKey: string }) {
    super();
  }

  private _shouldUseResponsesApi(modelId: string) {
    const id = String(modelId || '').toLowerCase().trim();
    // Codex + GPT-5 family models are served via the Responses API.
    // If we send them to /v1/chat/completions, OpenAI returns:
    // "This is not a chat model and thus not supported in the v1/chat/completions endpoint."
    return id.startsWith('gpt-5') || id.includes('codex');
  }

  getModel(id: string) {
    const client: any = createOpenAI({
      compatibility: "strict",
      apiKey: this.options.apiKey,
    }) as any;

    // Prefer the Responses API adapter when the SDK provides it.
    // Fall back to languageModel for older SDK versions.
    if (this._shouldUseResponsesApi(id) && typeof client.responses === 'function') {
      return client.responses(id);
    }

    return client.languageModel(id);
  }

  stream(options: {
    messages: Messages;
    signal: AbortSignal;
    tools: ToolSet;
    modelId: string;
    temperature?: number;
  }) {
    if (options.modelId.startsWith("gpt-5")) {
      // Can't set temperature for gpt-5
      return super.stream({ ...options, temperature: 1 });
    }
    return super.stream(options);
  }

  async generateObject<OBJECT>(options: {
    modelId: string;
    schema: z.Schema<OBJECT, z.ZodTypeDef, any>;
    prompt: string;
    temperature?: number;
  }) {
    if (options.modelId === "gpt-5") {
      // Can't set temperature for gpt-5
      return super.generateObject({ ...options, temperature: 1 });
    }
    return super.generateObject(options);
  }

  async listModels() {
    return providerConfigs.openai.models;
  }
}
