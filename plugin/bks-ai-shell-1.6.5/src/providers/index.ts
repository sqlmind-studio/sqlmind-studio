import { AvailableProviders } from "@/config";
import { AnthropicProvider } from "@/providers/AnthropicProvider";
import { OpenAIProvider } from "@/providers/OpenAIProvider";
import { OpenAICompatibleProvider } from "@/providers/OpenAICompatibleProvider";
import { GoogleProvider } from "@/providers/GoogleProvider";
import { OpenRouterProvider } from "@/providers/OpenRouterProvider";
import { DeepSeekProvider } from "@/providers/DeepSeekProvider";
import { useConfigurationStore } from "@/stores/configuration";
import { OllamaProvider } from "./OllamaProvider";
import { parseHeaders } from "@/utils";
import { fetchProviderApiKey } from "@/utils/remoteConfig";
import _ from "lodash";

export async function createProvider(id: AvailableProviders) {
  const configuration = useConfigurationStore();
  switch (id) {
    case "anthropic":
      // Fetch API key from backend
      const anthropicKey = await fetchProviderApiKey("anthropic");
      return new AnthropicProvider({
        apiKey: anthropicKey,
      });
    case "openai":
      // Fetch API key from backend
      const openaiKey = await fetchProviderApiKey("openai");
      return new OpenAIProvider({
        apiKey: openaiKey,
      });
    case "google":
      // Fetch API key from backend
      const googleKey = await fetchProviderApiKey("google");
      return new GoogleProvider({
        apiKey: googleKey,
      });
    case "openaiCompat":
      if (_.isEmpty(configuration.providers_openaiCompat_baseUrl)) {
        throw new Error("Missing API base URL [2]");
      }
      return new OpenAICompatibleProvider({
        baseURL: configuration.providers_openaiCompat_baseUrl,
        apiKey: configuration.providers_openaiCompat_apiKey,
        headers: parseHeaders(configuration.providers_openaiCompat_headers),
      });
    case "ollama":
      if (_.isEmpty(configuration.providers_ollama_baseUrl)) {
        throw new Error("Missing API base URL [2]");
      }
      return new OllamaProvider({
        baseURL: configuration.providers_ollama_baseUrl,
        headers: parseHeaders(configuration.providers_ollama_headers),
        apiKey: "",
      });
    case "openrouter":
      // Fetch API key from backend instead of local config
      const openrouterKey = await fetchProviderApiKey("openrouter");
      return new OpenRouterProvider({
        apiKey: openrouterKey,
      });
    case "deepseek":
      // Fetch API key from backend instead of local config
      const deepseekKey = await fetchProviderApiKey("deepseek");
      console.log('[createProvider] DeepSeek key fetched, length:', deepseekKey?.length);
      console.log('[createProvider] DeepSeek key starts with:', deepseekKey?.substring(0, 10));
      return new DeepSeekProvider({
        apiKey: deepseekKey,
      });
    default:
      throw new Error(`Provider ${id} does not exist.`);
  }
}
