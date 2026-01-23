import { notify } from "@sqlmindstudio/plugin";
import { generateObject, LanguageModel, streamText, ToolSet } from "ai";
import { AvailableModels, defaultTemperature } from "@/config";
import z from "zod";
import { UserRejectedError } from "@/tools";
import { 
  APICallError,
  InvalidToolArgumentsError,
  NoSuchModelError,
  NoSuchProviderError,
  NoSuchToolError,
  ToolExecutionError,
} from "ai";
import { logAIUsage } from "@/utils/usageLogger";
import { useUserContext } from "@/composables/useUserContext";
import { checkCreditsAvailable } from "@/utils/creditChecker";

export type Messages = Parameters<typeof streamText>[0]["messages"];

export abstract class BaseProvider {
  abstract getModel(id: string): LanguageModel;

  async stream(options: {
    providerId?: string;
    modelId: string;
    messages: Messages;
    signal?: AbortSignal;
    tools?: ToolSet;
    temperature?: number;
    systemPrompt?: string;
    toolChoice?: 'auto' | 'required' | 'none';
  }) {
    const maxRetries = options.providerId === 'anthropic' ? 0 : 2;

    const tools = options.providerId === 'deepseek' ? undefined : options.tools;
    const toolChoice = options.providerId === 'deepseek' ? 'none' : options.toolChoice;
    const result = streamText({
      model: this.getModel(options.modelId),
      messages: options.messages,
      abortSignal: options.signal,
      system: options.systemPrompt,
      tools,
      toolChoice,
      maxSteps: 100,
      temperature: options.temperature ?? defaultTemperature,
      maxRetries,
    });
    return result.toDataStreamResponse({
      getErrorMessage: (error: unknown) => {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        notify("pluginError", {
          message: errorObj.message,
          name: errorObj.name,
          stack: errorObj.stack,
        });
        return this.getErrorMessage(error);
      },
    });
  }

  async generateText(options: {
    modelId: string;
    prompt: string;
    temperature?: number;
    providerId?: string; // For logging
    queryText?: string; // For logging
  }) {
    // Check credits before proceeding with AI request
    const creditCheck = await checkCreditsAvailable();
    
    // If no credits, throw error
    if (!creditCheck.hasCredits) {
      throw new Error(`❌ No Credits Available\n\n${creditCheck.message}\n\nPlease visit the Usage tab to upgrade your plan or purchase add-ons.`);
    }
    
    // Show warning if credits are very low (≤ 5 credits)
    if (creditCheck.creditsLeft > 0 && creditCheck.creditsLeft <= 5) {
      throw new Error(`⚠️ Low Credits Warning\n\nYou have only ${creditCheck.creditsLeft} credit${creditCheck.creditsLeft === 1 ? '' : 's'} remaining. Consider upgrading your plan or purchasing add-ons to avoid interruption.`);
    }
    
    const startTime = Date.now();
    let success = true;
    let errorMessage: string | undefined;
    let usage: any = null;
    
    try {
      const result = await streamText({
        model: this.getModel(options.modelId),
        prompt: options.prompt,
        temperature: options.temperature ?? defaultTemperature,
      });
      
      // Collect the full text response
      const textParts: string[] = [];
      for await (const chunk of result.textStream) {
        textParts.push(chunk);
      }
      const text = textParts.join('');
      
      // Extract usage from result
      usage = await result.usage;
      
      return { text, usage };
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      // Log usage after completion (success or failure)
      try {
        const requestDuration = Date.now() - startTime;
        const { getUserContext } = useUserContext();
        const userContext = getUserContext();
        
        if (options.providerId && usage) {
          logAIUsage({
            ...userContext,
            providerId: options.providerId,
            modelId: options.modelId,
            requestType: 'inline',
            inputTokens: usage?.promptTokens || 0,
            outputTokens: usage?.completionTokens || 0,
            totalTokens: usage?.totalTokens || 0,
            requestDuration,
            success,
            errorMessage,
            queryText: options.queryText,
          }).catch(err => console.error('[AI Usage] Failed to log inline usage:', err));
        }
      } catch (err) {
        console.error('[AI Usage] Error in generateText logging:', err);
      }
    }
  }

  async generateObject<OBJECT>(options: {
    modelId: string;
    schema: z.Schema<OBJECT, z.ZodTypeDef, any>;
    prompt: string;
    temperature?: number;
    providerId?: string; // For logging
    queryText?: string; // For logging (original query being analyzed/fixed)
  }) {
    // Check credits before proceeding with AI request
    const creditCheck = await checkCreditsAvailable();
    
    // If no credits, throw error
    if (!creditCheck.hasCredits) {
      throw new Error(`❌ No Credits Available\n\n${creditCheck.message}\n\nPlease visit the Usage tab to upgrade your plan or purchase add-ons.`);
    }
    
    // Show warning if credits are very low (≤ 5 credits)
    if (creditCheck.creditsLeft > 0 && creditCheck.creditsLeft <= 5) {
      throw new Error(`⚠️ Low Credits Warning\n\nYou have only ${creditCheck.creditsLeft} credit${creditCheck.creditsLeft === 1 ? '' : 's'} remaining. Consider upgrading your plan or purchasing add-ons to avoid interruption.`);
    }
    
    const startTime = Date.now();
    let success = true;
    let errorMessage: string | undefined;
    let usage: any = null;
    
    try {
      const result = await generateObject<OBJECT>({
        model: this.getModel(options.modelId),
        schema: options.schema,
        prompt: options.prompt,
        temperature: options.temperature,
      });
      
      // Extract usage from result
      usage = (result as any)?.usage;
      
      return result;
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      // Log usage after completion (success or failure)
      try {
        const requestDuration = Date.now() - startTime;
        const { getUserContext } = useUserContext();
        const userContext = getUserContext();
        
        if (options.providerId && usage) {
          logAIUsage({
            ...userContext,
            providerId: options.providerId,
            modelId: options.modelId,
            requestType: 'inline',
            inputTokens: usage?.promptTokens || 0,
            outputTokens: usage?.completionTokens || 0,
            totalTokens: usage?.totalTokens || 0,
            requestDuration,
            success,
            errorMessage,
            queryText: options.queryText, // Include original query text for logging
          }).catch(err => console.error('[AI Usage] Failed to log inline usage:', err));
        }
      } catch (err) {
        console.error('[AI Usage] Error in generateObject logging:', err);
      }
    }
  }

  abstract listModels(): Promise<
    readonly { id: string; displayName: string }[]
  >;

  getErrorMessage(error: unknown) {
    if (NoSuchToolError.isInstance(error)) {
      return "The model tried to call a unknown tool.";
    } else if (InvalidToolArgumentsError.isInstance(error)) {
      return "The model called a tool with invalid arguments.";
    } else if (ToolExecutionError.isInstance(error)) {
      if (UserRejectedError.isInstance(error.cause)) {
        return `User rejected tool call. (toolCallId: ${error.toolCallId})`;
      } else {
        return "An error occurred during tool execution.";
      }
    } else if (APICallError.isInstance(error)) {
      const apiError = error as any;
      if (
        apiError.data?.error?.code === "invalid_api_key" ||
        apiError.data?.error?.message === "invalid x-api-key" ||
        apiError.data?.error?.code === 400
      ) {
        return `The API key is invalid.`;
      }
      return `An error occurred during API call. (${error.message})`;
    } else if (NoSuchProviderError.isInstance(error)) {
      return `Provider ${error.providerId} does not exist.`;
    } else if (NoSuchModelError.isInstance(error)) {
      return `Model ${error.modelId} does not exist.`;
    }
    const errorObj = error instanceof Error ? error : { message: String(error) };
    return  `An error occurred. (${errorObj.message})`;
  }
}
