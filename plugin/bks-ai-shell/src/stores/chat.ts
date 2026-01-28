import { defineStore } from "pinia";
import {
  AvailableModels,
  AvailableProviders,
  AvailableProvidersWithDynamicModels,
  getDefaultInstructions,
  providerConfigs,
} from "@/config";
import { useConfigurationStore } from "./configuration";
import { useInternalDataStore } from "./internalData";
import { useTabState } from "./tabState";
import { createProvider } from "@/providers";
import { fetchModels } from "@/utils/remoteConfig";
import _ from "lodash";
import { ProviderSyncError } from "@/utils/ProviderSyncError";

export type Model<T extends AvailableProviders = AvailableProviders> = (
  | AvailableModels<T>
  | { id: string; displayName: string; supportsTools?: boolean }
) & {
  provider: T;
  providerDisplayName: (typeof providerConfigs)[T]["displayName"];
  enabled: boolean;
  /** Available if the api key is set. */
  available: boolean;
  removable: boolean;
  supportsTools?: boolean;
  creditMultiplier?: number;
};

type ChatState = {
  /** The active model. E.g. Claude 4 Sonnet, Claude 3.5, etc. */
  model?: Model;
  errors: ProviderSyncError[];
  defaultInstructions: string;
  /** Models fetched from backend API */
  backendModels: any[];
};

// the first argument is a unique id of the store across your application
export const useChatStore = defineStore("chat", {
  state: (): ChatState => ({
    model: undefined,
    errors: [],
    defaultInstructions: "",
    backendModels: [],
  }),
  getters: {
    models() {
      const config = useConfigurationStore();
      
      // All models now come from backend database
      const backendModelsFormatted = this.backendModels.map((m) => {
        const providerId = m.ProviderId || m.providerId;
        const modelId = m.ModelId || m.modelId;
        const displayName = m.DisplayName || m.displayName || modelId;
        const rawCreditMultiplier = m.CreditMultiplier ?? m.creditMultiplier;
        const creditMultiplier =
          typeof rawCreditMultiplier === "number"
            ? rawCreditMultiplier
            : rawCreditMultiplier != null
              ? parseInt(String(rawCreditMultiplier), 10)
              : undefined;
        const supportsTools = m.SupportsTools ?? m.supportsTools ?? true;
        const isDefault = m.IsDefault ?? m.isDefault ?? false;
        
        return {
          id: modelId,
          displayName: displayName,
          provider: providerId as AvailableProviders,
          providerDisplayName: providerConfigs[providerId as AvailableProviders]?.displayName || providerId,
          available: true, // Backend models are always available
          enabled: !config.disabledModels.some(
            (disabled) => disabled.modelId === modelId && disabled.providerId === providerId
          ),
          removable: false, // Backend models cannot be removed from UI
          supportsTools: supportsTools,
          isDefault: isDefault, // Default model from database
          creditMultiplier: Number.isFinite(creditMultiplier as number) && (creditMultiplier as number) > 0 ? (creditMultiplier as number) : undefined,
        };
      });

      return backendModelsFormatted;
    },
    systemPrompt(state) {
      const config = useConfigurationStore();
      return (state.defaultInstructions + "\n" + config.customInstructions).trim();
    },
  },
  actions: {
    async initialize() {
      const internal = useInternalDataStore();
      const config = useConfigurationStore();
      const tabState = useTabState();
      await config.sync();
      await internal.sync();
      await tabState.sync();

      // All providers now use backend database
      // Clear any cached models from previous syncs
      await config.setModels("openrouter", []);
      await config.setModels("openaiCompat", []);
      await config.setModels("ollama", []);
      await this.syncBackendModels();

      await this.ensureModelSelected();

      internal.lastUsedModelId = this.model?.id;

      await this.refreshInstructions();
    },
    async syncBackendModels() {
      try {
        console.log('[chat] Fetching models from backend API...');
        const models = await fetchModels();
        console.log('[chat] Fetched', models.length, 'models from backend');
        this.backendModels = models;
      } catch (error) {
        console.error('[chat] Failed to fetch backend models:', error);
        // Don't throw - just log and continue with empty backend models
        this.backendModels = [];
      }
    },
    async ensureModelSelected() {
      const internal = useInternalDataStore();
      const models = ((this as any).models as any[]) || [];
      // Select model: 1) Last used, 2) Default from DB, 3) First enabled
      const nextModel =
        models.find((m) => m.id === internal.lastUsedModelId && m.enabled) ||
        models.find((m) => m.enabled && (m as any).isDefault) ||
        models.find((m) => m.enabled);

      this.model = nextModel;
      internal.lastUsedModelId = this.model?.id;
    },
    async refreshInstructions() {
      getDefaultInstructions().then((instructions) => {
        this.defaultInstructions = instructions;
      }).catch(console.error);
    },
    /** List the models for a provider and store them in the internal data store. */
    async syncProvider(provider: AvailableProvidersWithDynamicModels) {
      const config = useConfigurationStore();
      try {
        const errorIdx = this.errors.findIndex(
          (e) => e.providerId === provider,
        );
        if (errorIdx !== -1) {
          this.errors.splice(errorIdx, 1);
        }
        // Special-cases to avoid noisy errors when not configured
        // Ollama: skip if no base URL to avoid CORS/fetch errors
        if (provider === "ollama") {
          const base = (config.providers_ollama_baseUrl || '').trim();
          if (!base) {
            console.warn("[syncProvider] Skipping Ollama sync: no base URL configured");
            config.setModels(provider, []);
            return;
          }
        }
        // OpenAI-compatible: skip if no base URL to avoid "Missing API base URL"
        if (provider === "openaiCompat") {
          const base = (config.providers_openaiCompat_baseUrl || '').trim();
          if (!base) {
            console.warn("[syncProvider] Skipping openaiCompat sync: no base URL configured");
            config.setModels(provider, []);
            return;
          }
        }

        console.log(`[syncProvider] Fetching models for ${provider}...`);
        const providerInstance = await createProvider(provider);
        const models = await providerInstance.listModels();
        console.log(`[syncProvider] Successfully fetched ${models.length} models for ${provider}`);
        config.setModels(provider, models);
      } catch (e) {
        console.error(`[syncProvider] Error fetching models for ${provider}:`, e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        if (provider === "ollama" && e instanceof TypeError && errorMessage === "Failed to fetch") {
          this.errors.push(
            new ProviderSyncError(
              "Failed to fetch models from Ollama. [1]",
              {
                providerId: provider,
                cause: e,
              },
            )
          )
        } else {
          this.errors.push(
            new ProviderSyncError(errorMessage, {
              providerId: provider,
              cause: e,
            }),
          );
        }
        config.setModels(provider, []);
      }
    },
  },
});
