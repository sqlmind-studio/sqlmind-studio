import { useChat } from "@ai-sdk/vue";
import { computed, nextTick, ref, watch } from "vue";
import {
  AvailableProviders,
  AvailableModels,
} from "@/config";
import { getTools } from "@/tools";
import { Message } from "ai";
import { useTabState } from "@/stores/tabState";
import { notify } from "@sqlmindstudio/plugin";
import { z } from "zod";
import { createProvider } from "@/providers";
import baseInstructions from "../../instructions/base.txt?raw";
import { useConfigurationStore } from "@/stores/configuration";
import { isEmptyUIMessage, isReadQuery } from "@/utils";
import { logAIUsage } from "@/utils/usageLogger";
import { useUserContext } from "./useUserContext";
import { checkCreditsAvailable } from "@/utils/creditChecker";

type AIOptions = {
  initialMessages: Message[];
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
};

type SendOptions = {
  providerId: AvailableProviders;
  modelId: AvailableModels["id"];
  systemPrompt?: string;
}

export function useAI(options: AIOptions) {
  // Toggle for sending the global base instruction as the first system message
  const ENABLE_BASE_INSTRUCTIONS = false;
  /** FIXME: Only used because we want to retry automatically after an error.
   *  REMOVE AFTER V5 UPGRADE. */
  const sendOptions = ref<SendOptions>();
  const isSending = ref(false);
  const pendingToolCallIds = ref<string[]>([]);
  const askingPermission = computed(() => pendingToolCallIds.value.length > 0);
  const followupAfterRejected = ref("");

  const configurationStore = useConfigurationStore();

  let permitted = false;
  // 429 retry/backoff state
  const backoffRetries = ref(0);
  // Track request start time for duration logging
  const requestStartTime = ref<number>(0);
  // Get user context for logging
  const { getUserContext } = useUserContext();
  // Simple per-model throttle to avoid bursts hitting RPM/TPM
  const lastReqAtByModel: Record<string, number> = {};
  // Max retries for 429 (strict mode)
  const MAX_BACKOFF_RETRIES = 3;
  // Provider-suggested cooldowns per provider:model key
  const modelCooldownUntil: Record<string, number> = {};
  // Hard cap for request body size (approx chars of messages JSON)
  const TARGET_MAX_JSON_CHARS = 25_000;
  const ENABLE_SAFETY_NOTE = false;
  const ENABLE_INTENT_SNIPPETS = false;
  // Store hidden context that should be appended to last user message before sending to AI
  const pendingHiddenContext = ref<string>('');

  let lastAnthropicSizeNotifyAt = 0;

  // Anthropic can reject requests when the JSON body contains unpaired UTF-16 surrogates.
  // This can happen if we truncate strings mid-surrogate (emoji/unicode symbols).
  const sanitizeUnicode = (s: string) => {
    try {
      return String(s || '')
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
    } catch {
      return String(s || '');
    }
  };
  const safeSlice = (s: string, start?: number, end?: number) => {
    try {
      const str = String(s || '');
      const len = str.length;
      let a = start == null ? 0 : start;
      let b = end == null ? len : end;
      if (a < 0) a = Math.max(0, len + a);
      if (b < 0) b = Math.max(0, len + b);
      a = Math.max(0, Math.min(len, a));
      b = Math.max(0, Math.min(len, b));
      if (b <= a) return '';
      const last = str.charCodeAt(b - 1);
      if (last >= 0xD800 && last <= 0xDBFF) b = b - 1;
      const first = str.charCodeAt(a);
      if (first >= 0xDC00 && first <= 0xDFFF) a = a + 1;
      return str.slice(a, b);
    } catch {
      return String(s || '').slice(start as any, end as any);
    }
  };
  const safeTruncate = (s: string, maxLen: number, keepTail = false) => {
    const str = sanitizeUnicode(String(s || ''));
    if (str.length <= maxLen) return str;
    return keepTail ? safeSlice(str, str.length - maxLen) : safeSlice(str, 0, maxLen);
  };

  // Provider-agnostic auto-resume guardrails
  const AUTO_RESUME_COOLDOWN_MS = 25_000;
  const AUTO_RESUME_MAX_PER_USER_TURN = 1;
  let autoResumeCountForLastUser = 0;
  let lastUserHashForAutoResume = '';

  // Option A: Gate Google Gemini models that require thought_signature for tool calls.
  // Fallback to a known-good model for tool workflows.
  const GOOGLE_TOOL_FALLBACK_MODEL_ID = 'gemini-2.5-flash';
  const isGoogleThoughtSignatureModel = (modelId: string) => {
    const id = String(modelId || '').toLowerCase();
    // Observed failures on gemini-3-*-preview when tools are enabled.
    // Keep this conservative and only gate known problematic families.
    return id.includes('gemini-3') || id.includes('preview');
  };
  let lastGoogleThoughtSigFallbackAt = 0;
  let lastGoogleThoughtSigFallbackKey = '';

  // Flag to prevent saveMessages during restore to avoid race conditions
  let isRestoring = false;
  // Cache the last restored messages so we can prevent unexpected clears
  let lastRestoredMessages: any[] = [];
  // Cache the last non-empty messages to defend against unexpected clears outside restore.
  let lastNonEmptyMessages: any[] = [];
  // Timestamp of last user-initiated clear action (so we don't fight intentional clears)
  let lastUserInitiatedClearAt = 0;
  let restoreTimeout: any = null;
  let restoreGuardUntil = 0;
  let suppressRestoreReapplyUntil = 0;

  function getMessagesSignature(msgs: any): string {
    try {
      const arr = Array.isArray(msgs) ? msgs : [];
      const len = arr.length;
      const first = len > 0 ? String((arr[0] as any)?.id || '') : '';
      const last = len > 0 ? String((arr[len - 1] as any)?.id || '') : '';
      return `${len}:${first}:${last}`;
    } catch (_) {
      return '0::';
    }
  }

  const { messages, input, append, error, status, addToolResult, stop, reload } =
    useChat({
      fetch: async (url, fetchOptions) => {
        // Check credits before proceeding with API call
        const creditCheck = await checkCreditsAvailable();
        
        // If no credits, throw error to display in chat
        if (!creditCheck.hasCredits) {
          throw new Error(`❌ No Credits Available\n\n${creditCheck.message}\n\nPlease visit the Usage tab to upgrade your plan or purchase add-ons.`);
        }
        
        // Show warning if credits are very low (≤ 5 credits)
        if (creditCheck.creditsLeft > 0 && creditCheck.creditsLeft <= 5) {
          throw new Error(`⚠️ Low Credits Warning\n\nYou have only ${creditCheck.creditsLeft} credit${creditCheck.creditsLeft === 1 ? '' : 's'} remaining. Consider upgrading your plan or purchasing add-ons to avoid interruption.`);
        }
        
        const m = JSON.parse(fetchOptions.body) as any;
        // Defensive: some reload/restore paths can invoke fetch without sendOptions.
        // Fall back to the last known sendOptions.value; if still missing, abort with a friendly error.
        const resolvedSendOptions = (m?.sendOptions as any) || (sendOptions.value as any);
        if (!resolvedSendOptions || !resolvedSendOptions.providerId || !resolvedSendOptions.modelId) {
          throw new Error('Please select a provider/model before sending.');
        }
        const providerIdLc = String(resolvedSendOptions.providerId || '').toLowerCase();
        const isAnthropic = providerIdLc === 'anthropic' || providerIdLc.includes('anthropic');
        try {
          if (providerIdLc === 'google' && isGoogleThoughtSignatureModel(resolvedSendOptions.modelId || '')) {
            const prev = String(resolvedSendOptions.modelId || '');
            if (prev !== GOOGLE_TOOL_FALLBACK_MODEL_ID) {
              resolvedSendOptions.modelId = GOOGLE_TOOL_FALLBACK_MODEL_ID as any;
              try {
                notify('broadcast', {
                  message: `Google Gemini model '${prev}' is not supported for tool workflows. Using '${GOOGLE_TOOL_FALLBACK_MODEL_ID}' instead.`,
                });
              } catch {}
            }
          }
        } catch {}
        // Keep sendOptions.value in sync so retries and error handlers have access.
        try { sendOptions.value = resolvedSendOptions; } catch {}

        // IMPORTANT: do not mutate `m.messages`.
        // @ai-sdk/vue can treat the request payload as canonical message state. If we compact
        // `m.messages` to 1-2 items for token control, the UI history can collapse.
        const originalMessages: any[] = Array.isArray(m.messages) ? (m.messages as any[]) : [];
        const cloneMessage = (mm: any) => {
          try {
            const cp: any = { ...(mm || {}) };
            if (Array.isArray(cp.content)) cp.content = cp.content.map((p: any) => ({ ...(p || {}) }));
            if (Array.isArray(cp.parts)) cp.parts = cp.parts.map((p: any) => ({ ...(p || {}) }));
            return cp;
          } catch {
            return mm;
          }
        };
        let outboundMessages: any[] = originalMessages.map(cloneMessage);
        
        // If there's pending hidden context, append it to the last user message (outbound only)
        if (pendingHiddenContext.value && Array.isArray(outboundMessages) && outboundMessages.length > 0) {
          const lastMsg = outboundMessages[outboundMessages.length - 1];
          if (lastMsg && lastMsg.role === 'user' && typeof lastMsg.content === 'string') {
            lastMsg.content = lastMsg.content + pendingHiddenContext.value;
            console.log('[AI] Appended hidden context to last user message, new length:', lastMsg.content.length);
          }
          // Clear the pending context after using it
          pendingHiddenContext.value = '';
        }
        
        const provider = await createProvider(resolvedSendOptions.providerId);
        // New request -> reset backoff counter
        backoffRetries.value = 0;
        // Optionally prepend base.txt as the first system message (disabled by default)
        if (ENABLE_BASE_INSTRUCTIONS) {
          try {
            const msgs = Array.isArray(outboundMessages) ? (outboundMessages as any[]) : [];
            const alreadyHasBase = msgs.some((mm: any) => mm?.role === 'system' && typeof mm?.content === 'string' && mm.content.includes('ULTRA CRITICAL - READ THIS FIRST'));
            if (!alreadyHasBase) {
              const resolved = (baseInstructions || '').replace('{current_date}', new Date().toISOString().slice(0,10));
              msgs.unshift({ role: 'system', content: resolved });
              outboundMessages = msgs;
            }
          } catch {}
        }
        // Compact payload to reduce tokens: keep base system + tail messages.
        try {
          const msgs = Array.isArray(outboundMessages) ? (outboundMessages as any[]) : [];
          // Optional safety note (disabled by default)
          if (ENABLE_SAFETY_NOTE) {
            try {
              const safetyNote = msgs.find((mm: any) => mm?.role === 'system' && typeof mm?.content === 'string' && mm.content.includes('Do NOT claim you inserted or executed'));
              if (!safetyNote) {
                msgs.unshift({
                  role: 'system',
                  content: 'Safety: Do NOT claim you inserted or executed unless an insert_sql/run_current_query tool COMPLETED successfully in THIS turn.'
                });
              }
            } catch {}
          }
          // First, truncate overly long message contents and collapse tool results
          const sanitized = msgs.map((mm: any) => {
            const cp = { ...mm };
            if (typeof cp.content === 'string') {
              if (cp.role === 'tool') {
                // Gemini can be strict about tool-call / tool-result pairing.
                // Instead of sending role:'tool' messages (which can become orphaned after trimming),
                // convert tool results into compact assistant-visible context.
                const toolName = (cp.name || cp.toolName || cp.tool || 'tool').toString();
                const prefix = `[Tool result: ${toolName}] `;
                cp.role = 'assistant';
                cp.content = prefix + cp.content.slice(0, 900);
              } else {
                // IMPORTANT: we append <local_memory> to the END of the user message.
                // If we truncate to a prefix, we can cut off LastSQL and cause the model to ask for the query again.
                const hasLocalMemory = /<local_memory>[\s\S]*<\/local_memory>/i.test(cp.content);
                const maxLen = cp.role === 'user'
                  ? (
                      isAnthropic
                        ? (hasLocalMemory ? 2800 : 1400)
                        : (hasLocalMemory ? 5000 : 1800)
                    )
                  : (isAnthropic ? 900 : 1200);

                if (cp.content.length > maxLen) {
                  if (cp.role === 'user' && hasLocalMemory) {
                    // Preserve the tail where local_memory lives.
                    cp.content = safeTruncate(cp.content, maxLen, true);
                  } else {
                    cp.content = safeTruncate(cp.content, maxLen, false);
                  }
                }
              }
            }
            return cp;
          });
          // Aggressive windowing to reduce TPM: keep only the most recent turns.
          // We rely on <local_memory> (appended to the last user message) + memorySummary for continuity.
          const sanitizedNoNull = Array.isArray(sanitized) ? sanitized.filter(Boolean) : [];
          // IMPORTANT: baseSystem must be selected from the sanitized/truncated messages.
          // If we keep the original, we can accidentally re-send a very large system message.
          const baseSystem = sanitizedNoNull.find(
            (mm: any) => mm?.role === 'system' && typeof mm?.content === 'string' && mm.content.includes('ULTRA CRITICAL - READ THIS FIRST')
          );
          const approxChars = JSON.stringify(sanitizedNoNull).length;
          // Keep enough conversational context for multi-step investigations.
          // Over-aggressive trimming can cause the model to lose the thread and appear to "stop" mid-workflow.
          let tailNonTool = isAnthropic ? 3 : 6;
          if (approxChars > (isAnthropic ? 8_000 : 12_000)) tailNonTool = isAnthropic ? 2 : 5;
          if (approxChars > (isAnthropic ? 11_000 : 18_000)) tailNonTool = isAnthropic ? 2 : 4;
          if (approxChars > (isAnthropic ? 13_000 : 22_000)) tailNonTool = isAnthropic ? 2 : 3;
          const nonToolTail = sanitizedNoNull.slice(-tailNonTool);
          const compacted = baseSystem ? [baseSystem, ...nonToolTail] : [...nonToolTail];
          outboundMessages = compacted;
          // Enforce hard cap by repeatedly dropping oldest non-system messages until under cap
          const targetMaxJsonChars = isAnthropic ? 12_000 : TARGET_MAX_JSON_CHARS;
          let bodySize = JSON.stringify(outboundMessages || []).length;
          while (bodySize > targetMaxJsonChars) {
            const arr = outboundMessages as any[];
            if (!arr || arr.length <= 3) break;
            // preserve first system if present, and keep enough tail context.
            const first = arr[0]?.role === 'system' ? [arr[0]] : [];
            const tail = arr.slice(-3);
            outboundMessages = [...first, ...tail];
            bodySize = JSON.stringify(outboundMessages).length;
            if (arr.length <= 4) break;
          }
        } catch {}

        // CRITICAL: the AI SDK can crash if it encounters a `content` part with
        // `type: "tool-invocation"` but missing `toolInvocation` (it reads `part.toolInvocation.step`).
        // Sanitize the outgoing message payload defensively.
        try {
          const sanitizeForAISDK = (messages: any[]) => {
            for (const msg of messages) {
              if (!msg) continue;
              // NEVER send role:'tool' downstream to providers. Represent tool results as plain assistant text.
              try {
                if (msg.role === 'tool') {
                  const toolName = String((msg as any).name || (msg as any).toolName || (msg as any).tool || 'tool');
                  const raw = typeof msg.content === 'string' ? msg.content : '';
                  msg.role = 'assistant';
                  msg.content = `[Tool result: ${toolName}] ` + raw;
                }
              } catch {}
              // Drop heavy/unstable metadata that is not needed for request context.
              try {
                delete msg.toolInvocations;
                delete (msg as any).toolCalls;
                delete (msg as any).tool_calls;
                delete (msg as any).toolCall;
                delete (msg as any).tool_call;
                delete (msg as any).functionCall;
                delete (msg as any).function_call;
                delete msg.annotations;
                delete msg.experimental_providerMetadata;
                delete msg.providerMetadata;
                delete msg.response;
                delete msg.result;
              } catch {}

              const sanitizePartsArray = (arr: any[]) => {
                return arr
                  .map((p: any) => {
                    try {
                      if (!p || typeof p !== 'object') return p;
                      // IMPORTANT: NEVER send tool invocation/function call parts back to the model.
                      // Some providers (notably Gemini) require additional metadata (e.g. thought_signature)
                      // for functionCall/toolInvocation parts and will 400 if missing.
                      // Tools are already handled via the AI SDK tool-calling mechanism in THIS request.
                      // Past tool calls should be represented as plain text only.
                      if (p.type === 'tool-invocation') {
                        const toolName = String(p.toolName || p.name || p.tool || 'tool');
                        return { type: 'text', text: `[${toolName}]`, truncated: true };
                      }
                      // Some message shapes use `toolInvocation` without a `type`.
                      if ('toolInvocation' in p) {
                        const toolName = String(p.toolName || p.name || p.tool || 'tool');
                        return { type: 'text', text: `[${toolName}]`, truncated: true };
                      }
                      return p;
                    } catch {
                      return { type: 'text', text: '', truncated: true };
                    }
                  })
                  .filter((p: any) => p != null);
              };

              if (Array.isArray(msg.content)) {
                msg.content = sanitizePartsArray(msg.content);
              }

              // Some UI messages carry tool call history in `parts` instead of `content`.
              // If we send broken `parts` downstream, the AI SDK can crash while grouping steps.
              if (Array.isArray(msg.parts)) {
                msg.parts = sanitizePartsArray(msg.parts);
              }

              // Ensure `content` exists and is safe.
              // Prefer a plain string to avoid any tool part semantics being re-sent.
              if (msg.content == null || typeof msg.content !== 'string') {
                try {
                  const partsText = Array.isArray(msg.parts)
                    ? msg.parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('\n')
                    : '';
                  msg.content = partsText || '';
                } catch {
                  msg.content = '';
                }
              }

              // Final: do not send `parts` in requests (only used for rendering/tool UI).
              try { delete msg.parts; } catch {}

              // Final-final: ensure we only keep a minimal message shape.
              // Some SDKs/providers may interpret extra keys as tool/function call history.
              try {
                for (const k of Object.keys(msg)) {
                  if (k === 'role' || k === 'content') continue;
                  delete (msg as any)[k];
                }
              } catch {}
            }
          };

          if (Array.isArray(outboundMessages)) {
            sanitizeForAISDK(outboundMessages);

            // Anthropic (and some other providers) reject requests if ANY message has an empty text block.
            // After tenant/workspace switches, the UI can temporarily carry placeholder/empty messages.
            // Drop empty/whitespace messages to avoid 400: "messages: text content blocks must be non-empty".
            try {
              outboundMessages = (outboundMessages as any[])
                .filter((mm: any) => {
                  if (!mm) return false;
                  if (mm.role === 'system') return true;
                  const c = typeof mm.content === 'string' ? mm.content : '';
                  return c.trim().length > 0;
                });

              const lastUser = [...(outboundMessages as any[])].reverse().find((mm: any) => mm?.role === 'user');
              const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content.trim() : '';
              if (!lastUser || !lastUserText) {
                throw new Error('Please enter a message before sending.');
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              throw new Error(msg);
            }
          }
        } catch {}

        // Heuristics to guide behavior based on user's last message
        // 1) If user asks to analyze the execution plan, DO NOT rewrite SQL by default; focus on plan analysis.
        // 2) Else, if user asks to optimize/rewrite the CURRENT query, inject rewrite workflow guidance.
        try {
          const isRetrying = !!((m?.sendOptions as any)?.retrying);
          const msgs = Array.isArray(outboundMessages) ? (outboundMessages as any[]) : [];
          if (isRetrying) {
            // On retries, avoid re-injecting heuristics/tool prompts to reduce TPM and duplicate tool calls
            outboundMessages = msgs;
          } else if (ENABLE_INTENT_SNIPPETS) {
            const lastUser = [...msgs].reverse().find((mm: any) => mm?.role === 'user');
            const lastAssistant = [...msgs].reverse().find((mm: any) => mm?.role === 'assistant');
            const lastText = (lastUser?.content || '').toString();

            // Continuation: if user says yes/ok to a prior assistant question, proceed without greeting
            const isAffirmation = /^(ok|okay|yes|yep|sure|do it|go ahead|proceed|continue|please\s+do|sounds good|let's do it|yess?)\b/i.test((lastText || '').trim());
            if (isAffirmation && lastAssistant) {
              let lastAssistantText = '';
              try {
                if (typeof lastAssistant.content === 'string') lastAssistantText = lastAssistant.content;
                else if (Array.isArray(lastAssistant.content)) {
                  lastAssistantText = (lastAssistant.content as any[])
                    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
                    .join('\n');
                }
              } catch {}
              msgs.push({
                role: 'system',
                content: [
                  'Continuation request detected:',
                  '- Do NOT ask for the query again',
                  '- Do NOT ask what the user wants',
                  '- Do NOT greet or restart the conversation',
                  '- The query and all context are ALREADY in the conversation history',
                  '',
                  '✅ WHAT TO DO NOW:',
                  '- Look at your previous assistant message to see what you proposed',
                  '- If you proposed to run_query with a rewritten query, call run_query NOW with that exact query',
                  '- If you proposed to create indexes, call run_query NOW with those CREATE INDEX statements',
                  '- If you proposed multiple actions, execute them in the order you described',
                  '',
                  '📋 YOUR PREVIOUS PROPOSAL:',
                  lastAssistantText.slice(-500),
                  '',
                  '👉 Execute the proposed action immediately. Do not ask for anything.'
                ].join('\n')
              });
              outboundMessages = msgs;
            }

            // Detect explicit execution plan analysis intent
            const wantsPlanAnalysis = /(execution\s+plan|explain\s+plan|show\s*plan|estimated\s+plan|actual\s+plan|analy[sz]e\s+(the\s+)?plan)/i.test(lastText);
            const wantsOptimize = /(optimi[sz]e|rewrite|refactor|improv(e|ing)|fix|tune|speed\s*up|make\s+this\s+faster|performance|review|revise|simplif(y|ied)|clean\s*up|rework|diagnos(e|is)|troubleshoot|sargable|reduce\s+(reads|logical\s*reads)|why\s+is\s+(this|my)\s+.*slow|\bslow\b|high\s*cpu)/i.test(lastText);
            const wantsDefinition = /(create\s+statement|script\s+it|definition|show\s+the\s+procedure|ddl\b|sp_helptext)/i.test(lastText);
            const mentionsCurrent = /(current|this|my)\s+(query|sql)/i.test(lastText) || /above\s+query|the\s+query\s+in\s+the\s+editor/i.test(lastText);
            const mentionsQueryGeneric = /\b(query|sql)\b/i.test(lastText);
            const looksLikePastedSQL = /\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bwith\b\s*\(/i.test(lastText);
            const wantsSimpleSelect = !wantsPlanAnalysis && !wantsOptimize && !wantsDefinition && !looksLikePastedSQL && /(show|list|return|get)\b/i.test(lastText);
            const shouldForceReadRewrite = wantsOptimize && (mentionsCurrent || (mentionsQueryGeneric && !looksLikePastedSQL));

            if (wantsPlanAnalysis && ((mentionsCurrent) || mentionsQueryGeneric)) {
              msgs.unshift({
                role: 'system',
                content: [
                  'Execution Plan Analysis mode:',
                  '- First, call get_tab_list to confirm the active tab.',
                  '- Then call get_query_text to read the ACTIVE tab SQL.',
                  '- CRITICAL SCHEMA ACCURACY: Extract the EXACT schema names from the query text (e.g., [Person].[EmailAddress], [HumanResources].[Employee]).',
                  '- When recommending indexes, you MUST use the EXACT schema.table names as they appear in the query.',
                  '- NEVER guess or assume schema names - always use what is explicitly in the query.',
                  '- CRITICAL: Before recommending ANY index, you MUST fetch existing indexes for the relevant tables.',
                  '- You do not know what indexes exist yet. Do NOT guess.',
                  '- Call `get_table_metadata` for the tables involved OR query sys.indexes.',
                  '- If the query uses VIEWS or FUNCTIONS, call `get_object_definition` to see their code.',
                  '- ONLY after you see the existing indexes, propose new ones that do not conflict.',
                  '- Do NOT rewrite the SQL unless the user explicitly asks to rewrite, OR if you detect a critical issue that ONLY a rewrite can fix (e.g., non-sargable predicates, inefficient views).',
                  '- Provide a concise "Plan analysis:" section with likely bottlenecks (joins, scans, sorts, lookups, spills).',
                  '- Suggest concrete fixes: indexing, sargability, join/filter reordering, proper predicates.',
                  '- REWRITE RULE: If you suggest a rewrite (for views, functions, or query logic), you MUST output the FULL rewritten SQL in a fenced code block.',
                  '- REQUIRED STRUCTURE:',
                  '  1. Plan Analysis: Identify bottlenecks.',
                  '  2. Findings: Missing indexes, high CPU/IO, etc.',
                  '  3. Recommendations: Index changes (CREATE INDEX...).',
                  '  4. Rewritten SQL: (IF APPLICABLE) The complete, ready-to-run SQL code for any view/function/query rewrites.',
                  '- If in CODE MODE and the user wants to run, proceed with run_current_query; otherwise analyze the text only.',
                  '- Never call insert_sql as part of plan analysis unless user asks to rewrite.',
                  '',
                  '🚨 CRITICAL SAFETY RULE - DDL EXECUTION:',
                  '- NEVER offer to execute DDL statements (CREATE INDEX, ALTER TABLE, DROP, etc.) after using insert_sql.',
                  '- DDL operations require careful DBA review and should NEVER be auto-executed.',
                  '- After inserting DDL code with insert_sql, you MUST NOT ask "Do you want me to run this?" or offer to execute it.',
                  '- The user will manually review and execute DDL statements when ready.',
                  '- This rule applies to ALL DDL: CREATE INDEX, CREATE TABLE, ALTER, DROP, TRUNCATE, etc.',
                  '',
                  'Index Recommendations:',
                  '- NEVER use DROP_EXISTING = ON on constraints: primary keys (PK_*), unique constraints (UQ_*), or unique indexes enforcing constraints.',
                  '- NEVER try to modify existing constraint-based indexes (PK_*, UQ_*, AK_*). They cannot be altered with DROP_EXISTING.',
                  '- If an index name starts with PK_, UQ_, or AK_, it is likely a constraint - do NOT recommend modifying it.',
                  '- Instead, create NEW NON-CLUSTERED COVERING INDEXES with INCLUDE columns to support queries.',
                  '- Use naming convention: IX_TableName_KeyColumns (e.g., IX_Person_BusinessEntityID_Names).',
                  '- For unique indexes that are NOT constraints, you can use DROP_EXISTING = ON safely.',
                  '- ONLINE = ON requires SQL Server 2012+ Enterprise/Developer Edition. For Standard Edition or older versions, omit ONLINE option.',
                  '- Always check for existing indexes before recommending new ones to avoid duplicates.',
                  '- For filtered indexes, use WHERE clause to reduce index size (e.g., WHERE DeletedDate IS NULL).',
                  '- Consider index maintenance: larger indexes = more overhead on INSERT/UPDATE/DELETE.',
                  '- Example: CREATE NONCLUSTERED INDEX [IX_Person_BusinessEntityID_Names] ON [Person].[Person] ([BusinessEntityID]) INCLUDE ([Title], [FirstName], [LastName]);',
                  '- For Enterprise Edition: Add WITH (ONLINE = ON, DATA_COMPRESSION = PAGE) for better performance.',
                  '',
                  'Index policy:',
                  '- CRITICAL: EXISTENCE CHECK - Before recommending ANY index, you MUST verify if it already exists.',
                  '- If you lack index information, you MUST query sys.indexes/sys.index_columns or call get_table_metadata to check for existing indexes.',
                  '- Check if an index with the same name OR the same Key/Include columns already exists.',
                  '- If an index with the proposed name already exists, you MUST use a different name (e.g., append _Covering or _v2) or use DROP_EXISTING=ON if applicable.',
                  '- If an index with the exact same Key and Include columns already exists, do NOT recommend creating it (it is a duplicate).',
                  '- Prefer updating/merging existing indexes when feasible; avoid duplicates/near-duplicates.',
                  '- CRITICAL: NEVER use DROP_EXISTING=ON on constraint-based indexes (PK_*, UQ_*, AK_*). These are constraints, not regular indexes, and cannot be altered with DROP_EXISTING.',
                  '- Before proposing a new index, compare with existing indexes.',
                  '- If an existing NON-CONSTRAINT index (IX_* prefix) shares the same leading key, you can update it using WITH (DROP_EXISTING=ON) to add missing keys and/or INCLUDE columns.',
                  '- If an existing CONSTRAINT index (PK_*, UQ_*, AK_*) needs additional coverage, create a NEW non-clustered covering index with INCLUDE columns instead.',
                  '- Preserve existing filters on filtered indexes unless there is a strong reason to adjust; include WHERE when recommending filtered indexes.',
                  '- Example (updating regular index): If [Sales].[Customer] has [IX_Customer_TerritoryID] ON ([TerritoryID]) and you recommend adding columns, propose CREATE INDEX [IX_Customer_TerritoryID] ON [Sales].[Customer] ([TerritoryID],[CustomerID]) INCLUDE ([PersonID]) WITH (DROP_EXISTING=ON, ONLINE=ON, SORT_IN_TEMPDB=ON, DATA_COMPRESSION=PAGE).',
                  '- Example (covering constraint): If [Person].[Person] has [PK_Person_BusinessEntityID] and needs coverage, propose CREATE NONCLUSTERED INDEX [IX_Person_BusinessEntityID_Names] ON [Person].[Person] ([BusinessEntityID]) INCLUDE ([Title],[FirstName],[LastName]) WITH (ONLINE=ON, DATA_COMPRESSION=PAGE).',
                  '- Propose at most 5 total index changes overall; allow up to 10 only if a single table is very large and justifies it.',
                  '',
                  '⚠️ CRITICAL: NO PLACEHOLDERS OR COMMENTS IN INDEX DEFINITIONS:',
                  '- NEVER use placeholder comments like "/* Add columns here */" or "/* other columns */"',
                  '- ALWAYS specify EXACT column names in INCLUDE clause',
                  '- If you don\'t know which columns to include, either:',
                  '  1. Request TABLE_METADATA to see available columns',
                  '  2. Analyze the query to see which columns are selected/filtered',
                  '  3. Leave out INCLUDE clause entirely (only use key columns)',
                  '- Example of INVALID index (placeholder):',
                  '  * CREATE INDEX IX_Orders ON Orders (CustomerID) INCLUDE ( /* Add columns */ ) ❌',
                  '- Example of VALID index (specific columns):',
                  '  * CREATE INDEX IX_Orders ON Orders (CustomerID) INCLUDE (OrderDate, TotalAmount) ✅',
                  '- Example of VALID index (no INCLUDE if unsure):',
                  '  * CREATE INDEX IX_Orders ON Orders (CustomerID) ✅',
                  '',
                  '⚠️ FILTERED INDEX VALIDATION:',
                  '- Filtered indexes require deterministic WHERE clauses with matching data types.',
                  '- NEVER use variables or parameters (@Param) in the filter - must use literals.',
                  '- NEVER compare two columns (e.g., WHERE EndDate > StartDate) - illegal in filtered indexes.',
                  '- NEVER use complex expressions like CASE, COALESCE, ISNULL, or user-defined functions.',
                  '- Requirement: Tables with filtered indexes require SET ANSI_NULLS ON and SET QUOTED_IDENTIFIER ON during creation and modification.',
                  '- INVALID: WHERE data > GETDATE() (non-deterministic function)',
                  '- INVALID: WHERE IsActive = \'true\' (bit vs string mismatch)',
                  '- INVALID: WHERE Amount = \'1000\' (numeric vs string mismatch)',
                  '- VALID: WHERE data > \'2024-01-01\' (datetime with literal)',
                  '- VALID: WHERE status = \'Active\' (varchar with string)',
                  '- VALID: WHERE IsActive = 1 (bit with 0 or 1)',
                  '- VALID: WHERE data IS NOT NULL (NULL check)',
                  '- If you need time-based filtering, use a regular index or suggest a computed persisted column.',
                  '',
                  '⡿ VIEWS, FUNCTIONS, AND SYNONYMS:',
                  '- CRITICAL: Before creating any index, check the object type (Table, View, Function, Synonym).',
                  '- VIEWS: You CANNOT create indexes directly on views (except indexed/materialized views).',
                  '  * When a view is detected: analyze underlying base tables and recommend indexes on BASE TABLES, not the view.',
                  '- SYNONYMS: Resolve the synonym to the actual object first.',
                  '- FUNCTIONS: Inline TVFs treat like views; multi-statement TVFs cannot be indexed.',
                  '- Always specify the exact base table name in index recommendations, not the view/synonym name.',
                  '',
                  '⡿ REWRITE REQUIREMENT:',
                  '- If you suggest rewriting a view, function, or query, you MUST provide the COMPLETE rewritten SQL code in a fenced block.',
                  '- Do NOT just describe the changes (e.g. "replace nested loops with hash join"). YOU MUST SHOW THE CODE.',
                  '- If rewriting a VIEW, provide the full `CREATE OR ALTER VIEW` statement.',
                  '- If rewriting a FUNCTION, provide the full `CREATE OR ALTER FUNCTION` statement.',
                  '- If rewriting a QUERY, provide the full `SELECT` statement.'
                ].join('\n')
              });
              outboundMessages = msgs;
            } else if (wantsDefinition) {
              msgs.unshift({
                role: 'system',
                content: [
                  'Object definition request detected:',
                  '- If the user asks for the CREATE statement or definition of a procedure/view/function, do NOT call get_columns.',
                  '- Instead, call get_object_definition with the object name and schema (default schema is dbo if not provided).',
                  '- Return the definition as-is. Do NOT rewrite the SQL and do NOT execute anything.',
                  '- If the user wants definitions for multiple objects, call get_object_definition per object.'
                ].join('\n')
              });
              outboundMessages = msgs;
            } else if (shouldForceReadRewrite) {
              msgs.unshift({
                role: 'system',
                content: [
                  'When the user refers to the CURRENT/THIS query, do NOT guess the SQL:',
                  '- First, call get_tab_list to confirm the active tab (the user may have multiple tabs).',
                  '- Then call get_query_text to read the ACTIVE tab SQL.',
                  '- Provide analysis/rewrite based on that SQL.',
                  '',
                  'Session isolation:',
                  '- Treat THIS conversation as independent. Do NOT assume prior chats or prior insert_sql actions happened.',
                  '- Always re-read the ACTIVE tab in this session before acting. Never rely on memory of other tabs/sessions.',
                  '',
                  'Preserve original + append rewritten version:',
                  '- Keep the ORIGINAL query unchanged.',
                  '- Produce an "Optimization notes:" section (brief bullets).',
                  '- Then produce a clearly marked section: "-- Rewritten query:" followed by the improved SQL.',
                  '- In CODE MODE: call insert_sql ONCE with BOTH sections combined (original query + notes + rewritten). Do NOT open a new tab. Do NOT remove the original.',
                  '- In CHAT MODE: show both queries in the message using sql code fences.',
                  '',
                  'Safety:',
                  '- Do NOT call insert_sql unless you are in Code Mode or the user explicitly asks to write to the editor.',
                  '- Do NOT claim you inserted SQL unless an insert_sql call COMPLETED SUCCESSFULLY in THIS TURN. If it did not, say what you will insert and wait for permission or a follow-up.'
                ].join('\n')
              });
              outboundMessages = msgs;
            } else if (wantsSimpleSelect) {
              msgs.unshift({
                role: 'system',
                content: [
                  'Query generation mode (CODE MODE):',
                  '- The user asked for a simple result (e.g., "show/list/get/return ..."). Generate a single SELECT that answers it.',
                  '- If you need table/column names, call get_tables and get_columns to discover schema first.',
                  '- Then call insert_sql ONCE with a clearly labeled "-- Query:" section followed by the SQL.',
                  '- Do NOT claim execution. Only call run_current_query if the user explicitly asked to run or after they confirm.',
                  '- Keep it concise; no greetings. If unsure about table names, ask a brief clarification instead of guessing wildly.'
                ].join('\n')
              });
              outboundMessages = msgs;
            }
          }
        } catch {}

        // Per-model throttle and cooldown: enforce a minimal interval and any active cooldown
        try {
          const key = `${resolvedSendOptions.providerId}:${resolvedSendOptions.modelId}`;
          const last = lastReqAtByModel[key] || 0;
          const since = Date.now() - last;
          let minIntervalMs = isAnthropic ? 60_000 : 10_000; // Tier-1 Anthropic: extra spacing to keep TPM under limit
          const cooldownUntil = modelCooldownUntil[key] || 0;
          const waitExtra = Math.max(0, cooldownUntil - Date.now());
          const waitBase = since < minIntervalMs ? (minIntervalMs - since) : 0;
          const waitTotal = waitBase + waitExtra;
          if (waitTotal > 0) await new Promise((r) => setTimeout(r, waitTotal));
          lastReqAtByModel[key] = Date.now();
        } catch {}
        // Capture last user text for adaptive toolsets (reduce tokens) while keeping system prompt untouched.
        // IMPORTANT: strip the hidden <local_memory> block since it can contain keywords like "performance"
        // which would incorrectly enable token-heavy investigation tools.
        let lastUserText = '';
        try {
          const arr: any[] = Array.isArray(outboundMessages) ? (outboundMessages as any[]) : [];
          const lastUser = [...arr].reverse().find((mm: any) => mm?.role === 'user');
          if (lastUser) {
            if (typeof lastUser.content === 'string') lastUserText = lastUser.content;
            else if (Array.isArray(lastUser.content)) {
              try { lastUserText = (lastUser.content as any[]).map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('\n'); } catch {}
            }
          }
          // Remove hidden memory injection from tool-selection heuristics
          if (lastUserText) {
            const idx = lastUserText.indexOf('<local_memory>');
            if (idx >= 0) lastUserText = lastUserText.slice(0, idx);
            lastUserText = lastUserText.trim();
          }
        } catch {}

        let isDatetime2PrecisionQuestion = false;
        try {
          const t = String(lastUserText || '');
          isDatetime2PrecisionQuestion =
            /datetime2\s*\(\s*4\s*\)/i.test(t) &&
            /datetime2\s*\(\s*3\s*\)/i.test(t) &&
            /(convert|cast|truncate|round|precision)/i.test(t);
        } catch {}

        let isTypeConversionQuestion = false;
        try {
          const t = String(lastUserText || '');
          // Broad trigger: any question phrased as convert/cast X to Y or "to the <type> datatype"
          isTypeConversionQuestion =
            /(\bconvert\b|\bcast\b|\btry_cast\b|\btry_convert\b)/i.test(t) &&
            /\bto\b/i.test(t) &&
            /(data\s*type|datatype|type|as\s+[a-z0-9_]+\s*(\(|\b))/i.test(t);
        } catch {}

        let isQueryWritingRequest = false;
        try {
          const t = String(lastUserText || '');
          isQueryWritingRequest =
            /(\bwrite\b|\bgenerate\b|\bcreate\b|\bbuild\b)\s+(?:a\s+)?(?:sql\s+)?query\b/i.test(t) ||
            /\btop\s*\d+\b/i.test(t) ||
            /\btop\s+\d+\s+results\b/i.test(t) ||
            /\breport\b/i.test(t) ||
            /\bdashboard\b/i.test(t);
        } catch {}

        // Enforce a hard cap on system prompt length to keep TPM under control.
        // (Vite/minified builds can include very large prompts; trimming here is the safest guardrail.)
        const MAX_SYSTEM_PROMPT_CHARS = isAnthropic ? 6_000 : 12_000;
        const capSystemPrompt = (sp: string) => {
          if (!sp) return sp;
          if (sp.length <= MAX_SYSTEM_PROMPT_CHARS) return sp;
          // Preserve the beginning (persona/rules) and the tail (recent additions) to keep behavior consistent.
          const head = safeSlice(sp, 0, isAnthropic ? 4_500 : 9_000);
          const tail = safeSlice(sp, -(isAnthropic ? 900 : 2_000));
          return `${head}\n\n[...system prompt truncated for rate limit safety...]\n\n${tail}`;
        };
        const cappedSystemPrompt = (typeof (resolvedSendOptions as any).systemPrompt === 'string')
          ? capSystemPrompt((resolvedSendOptions as any).systemPrompt)
          : (resolvedSendOptions as any).systemPrompt;

        // Two-pass reliability: run a fast reviewer before streaming the final answer.
        // Fail open if review fails.
        let reviewedSystemPrompt = cappedSystemPrompt;
        try {
          const reviewer = await provider.generateObject({
            modelId: resolvedSendOptions.modelId,
            schema: z.object({
              reviewerNotes: z.string().describe('Concise reviewer notes: pitfalls, edge cases, safer alternatives.'),
            }),
            prompt:
              'You are a strict production DBA reviewer. Review the user request and conversation. ' +
              'Identify common pitfalls and silent failure modes. If SQL Server, check rounding vs truncation, implicit conversions, time zone assumptions, overflow risks (DATEDIFF high precision), and version-specific behavior. ' +
              'Return only concise reviewer notes.' +
              '\n\nConversation:\n```\n' +
              (originalMessages || [])
                .map((msg: any) => `${msg.role}: ${msg.content}`)
                .join('\n') +
              '\n```\n',
            temperature: 0.1,
          });

          const notes = String(reviewer?.object?.reviewerNotes || '').trim();
          if (notes) {
            const base = typeof cappedSystemPrompt === 'string' ? cappedSystemPrompt : '';
            reviewedSystemPrompt = capSystemPrompt(
              [
                base,
                '\n\n## Internal DBA Review (apply before answering)\n' + notes,
              ].join('\n').trim(),
            );
          }
        } catch (_) {
          reviewedSystemPrompt = cappedSystemPrompt;
        }

        try {
          if (isDatetime2PrecisionQuestion) {
            const base = typeof reviewedSystemPrompt === 'string' ? reviewedSystemPrompt : '';
            reviewedSystemPrompt = capSystemPrompt(
              [
                base,
                [
                  'For this question, you MUST be explicit about rounding vs truncation:',
                  '- CAST/CONVERT from DATETIME2(4) to DATETIME2(3) ROUNDS (can roll over to next second/day/year).',
                  '- Provide the simple rounding conversion (CAST/CONVERT) AND a safe truncation option.',
                  '- For truncation to DATETIME2(3) (milliseconds) without rounding, use a DATEPART/DATEADD method that cannot overflow:',
                  '  DATEADD(NANOSECOND, - (DATEPART(NANOSECOND, @dt) % 1000000), @dt)',
                  '- Do NOT recommend DATEDIFF_BIG(NANOSECOND, \'00010101\', ...) because it can overflow BIGINT.',
                ].join('\n'),
              ].join('\n\n').trim(),
            );
          }
        } catch {}

        try {
          if (isTypeConversionQuestion) {
            const base = typeof reviewedSystemPrompt === 'string' ? reviewedSystemPrompt : '';
            reviewedSystemPrompt = capSystemPrompt(
              [
                base,
                [
                  'Conversion coverage requirement (SQL Server):',
                  '- BEFORE answering any data type conversion question, you MUST call conversion_rules(fromType, toType).',
                  '- Report whether the conversion is implicit, explicit-only, or not supported (matching the Microsoft matrix concept).',
                  '- If conversion_rules reports potentialLoss=true, you MUST explain what is lossy (rounding/truncation/overflow risk) and give a safer alternative when possible (TRY_CONVERT, explicit style, truncation formula, etc.).',
                  '- If you output SQL scripts, format as multi-line: one statement per line, semicolons, and a newline after any -- comment before the next statement.',
                  '- If you cannot infer fromType/toType from the question, ask a single clarifying question and stop.',
                ].join('\n'),
              ].join('\n\n').trim(),
            );
          }
        } catch {}

        try {
          if (isQueryWritingRequest) {
            const base = typeof reviewedSystemPrompt === 'string' ? reviewedSystemPrompt : '';
            reviewedSystemPrompt = capSystemPrompt(
              [
                base,
                [
                  'Query writing workflow requirement:',
                  '- When the user asks you to write/generate a SQL query, you MUST NOT guess table/column names.',
                  '- You MUST attempt schema discovery via tools BEFORE asking any clarifying question.',
                  '- Step 1: determine the active database (call get_active_database, or use <local_memory> ActiveDatabase if present).',
                  '- Step 2: discover tables/objects (call get_tables OR get_db_objects).',
                  '- Step 3: fetch exact columns/types for candidate tables (call get_columns and/or get_user_table_schema).',
                  '- Step 4: only after schema discovery, draft the SQL query.',
                  '- If the user asks for sample output, default to TOP 10 (or the user requested TOP N).',
                  '- You may ask ONE clarifying question ONLY if schema discovery tools fail/return empty OR none of the discovered tables are relevant.',
                ].join('\n'),
              ].join('\n\n').trim(),
            );
          }
        } catch {}

        // Log payload size for debugging TPM/rate limit spikes.
        try {
          const sysLen = typeof cappedSystemPrompt === 'string' ? cappedSystemPrompt.length : 0;
          const msgChars = JSON.stringify(outboundMessages || []).length;
          const approxTotalChars = sysLen + msgChars;
          console.log('[AI] Outbound payload sizes:', {
            providerId: resolvedSendOptions.providerId,
            modelId: resolvedSendOptions.modelId,
            systemPromptChars: sysLen,
            messagesJsonChars: msgChars,
            approxTotalChars,
            messagesCount: Array.isArray(outboundMessages) ? outboundMessages.length : 0,
          });
          try {
            if (isAnthropic) {
              const now = Date.now();
              if ((now - lastAnthropicSizeNotifyAt) > 15_000) {
                lastAnthropicSizeNotifyAt = now;
                notify('broadcast', {
                  message: `Claude payload size: ~${approxTotalChars} chars (system ${sysLen}, messages ${msgChars}).`,
                });
              }
            }
          } catch {}
        } catch {}

        // Final Unicode sanitization pass (do NOT mutate originals):
        // Some code paths can still introduce unpaired surrogates (e.g., tool results, file content,
        // or provider-specific serialization). Ensure the final JSON payload is always valid.
        const sanitizeMessageForJson = (mm: any) => {
          try {
            const cp: any = { ...(mm || {}) };
            if (typeof cp.content === 'string') {
              cp.content = sanitizeUnicode(cp.content);
            } else if (Array.isArray(cp.content)) {
              cp.content = (cp.content as any[]).map((p: any) => {
                try {
                  const pp: any = { ...(p || {}) };
                  if (typeof pp.text === 'string') pp.text = sanitizeUnicode(pp.text);
                  if (typeof pp.content === 'string') pp.content = sanitizeUnicode(pp.content);
                  return pp;
                } catch {
                  return p;
                }
              });
            }
            if (Array.isArray(cp.parts)) {
              cp.parts = (cp.parts as any[]).map((p: any) => {
                try {
                  const pp: any = { ...(p || {}) };
                  if (typeof pp.text === 'string') pp.text = sanitizeUnicode(pp.text);
                  if (typeof pp.content === 'string') pp.content = sanitizeUnicode(pp.content);
                  return pp;
                } catch {
                  return p;
                }
              });
            }
            return cp;
          } catch {
            return mm;
          }
        };
        const sanitizedMessages = Array.isArray(outboundMessages)
          ? (outboundMessages as any[]).map(sanitizeMessageForJson)
          : outboundMessages;
        const sanitizedSystemPrompt = typeof reviewedSystemPrompt === 'string'
          ? sanitizeUnicode(reviewedSystemPrompt)
          : reviewedSystemPrompt;

        return provider.stream({
          providerId: resolvedSendOptions.providerId,
          modelId: resolvedSendOptions.modelId,
          messages: sanitizedMessages,
          signal: fetchOptions.signal,
          tools: getTools(
            async (name, toolCallId, params) => {
              try {
                if (name === 'validate_query') {
                  return true;
                }
                if (name === 'conversion_rules') {
                  return true;
                }
                // Auto-allow read-only queries without prompting ONLY when explicitly enabled.
                if (
                  !!configurationStore.allowExecutionOfReadOnlyQueries &&
                  (name === 'run_query' || name === 'run_diagnostic_query')
                ) {
                  const p: any = params || {};
                  const sqlText =
                    (typeof p.sql === 'string' ? p.sql : '') ||
                    (typeof p.query === 'string' ? p.query : '') ||
                    (typeof p.text === 'string' ? p.text : '');
                  if (sqlText && isReadQuery(sqlText)) {
                    return true;
                  }
                }
              } catch {}

              pendingToolCallIds.value.push(toolCallId);
              await new Promise<void>((resolve) => {
                const unwatch = watch(pendingToolCallIds, () => {
                  if (!pendingToolCallIds.value.includes(toolCallId)) {
                    unwatch();
                    resolve();
                  }
                });
              });
              pendingToolCallIds.value = pendingToolCallIds.value.filter(
                (id) => id !== toolCallId
              );
              return permitted;
            },
            (resolvedSendOptions as any).outputMode,
            { lastUserText }
          ),
          systemPrompt: sanitizedSystemPrompt,
          temperature: (resolvedSendOptions as any).temperature,
        });
      },
      onError: async (error) => {
        try { isSending.value = false; } catch {}
        // Suppress benign abort noise from cancelled streams
        const abortNoise = (error?.name === 'AbortError') || /signal is aborted without reason/i.test(error?.message || '');
        if (!abortNoise) {
          notify("pluginError", {
            message: error.message,
            name: error.name,
            stack: error.stack,
          });
          
          // Log failed AI usage
          try {
            if (sendOptions.value) {
              const duration = requestStartTime.value > 0 ? Date.now() - requestStartTime.value : 0;
              const userContext = getUserContext();
              logAIUsage({
                ...userContext,
                providerId: sendOptions.value.providerId,
                modelId: sendOptions.value.modelId,
                requestType: 'chat',
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                requestDuration: duration,
                success: false,
                errorMessage: error.message || String(error),
              }).catch(err => console.error('[AI Usage] Failed to log error:', err));
              requestStartTime.value = 0; // Reset
            }
          } catch (err) {
            console.error('[AI Usage] Error logging failure:', err);
          }
        }
        
        // Handle provider rate limits with backoff and retry
        const rateLimited = (
          (error as any)?.status === 429 ||
          /rate limit|too many requests|exceeded|quota|tpm|rpm|429/i.test(error.message || '')
        );

        // The AI SDK can already retry internally and then surface AI_RetryError.
        // If we retry again here we can create a request storm and keep hitting 429.
        // Instead, honor the suggested cooldown and let the user retry after.
        const providerAlreadyRetried =
          (error as any)?.name === 'AI_RetryError' ||
          /failed after\s+\d+\s+attempts/i.test(error.message || '');

        if (rateLimited && providerAlreadyRetried && sendOptions.value) {
          try {
            const key = `${sendOptions.value.providerId}:${sendOptions.value.modelId}`;
            let waitMs = 10_000;
            if (sendOptions.value.providerId === 'anthropic') {
              waitMs = Math.max(waitMs, 60_000);
            }
            try {
              const msMatch = /retry in\s*(\d+(?:\.\d+)?)\s*ms/i.exec(error.message || '');
              const sMatch = /retry in\s*(\d+(?:\.\d+)?)\s*s(ec|econds)?/i.exec(error.message || '');
              if (msMatch) waitMs = Math.max(waitMs, Math.ceil(parseFloat(msMatch[1])) + 250);
              else if (sMatch) waitMs = Math.max(waitMs, Math.ceil(parseFloat(sMatch[1]) * 1000) + 250);
            } catch {}
            modelCooldownUntil[key] = Date.now() + waitMs;
            try { notify('broadcast', { message: `Rate-limited by provider. Please retry in ${(waitMs / 1000).toFixed(1)}s.` }); } catch {}
          } catch {}
          return;
        }

        if (rateLimited && sendOptions.value?.providerId === 'anthropic' && sendOptions.value) {
          // Tier-1 Anthropic: never auto-retry on 429. It almost always causes immediate repeated 429s
          // because the token bucket is per-minute. We set a cooldown and require manual retry.
          try {
            const key = `${sendOptions.value.providerId}:${sendOptions.value.modelId}`;
            let waitMs = 90_000;
            try {
              const msMatch = /try again in\s*(\d+(?:\.\d+)?)\s*ms/i.exec(error.message || '');
              const sMatch = /try again in\s*(\d+(?:\.\d+)?)\s*s(ec|econds)?/i.exec(error.message || '');
              if (msMatch) waitMs = Math.max(waitMs, Math.ceil(parseFloat(msMatch[1])) + 250);
              else if (sMatch) waitMs = Math.max(waitMs, Math.ceil(parseFloat(sMatch[1]) * 1000) + 250);
            } catch {}
            modelCooldownUntil[key] = Date.now() + waitMs;
            try { notify('broadcast', { message: `Claude rate-limited (TPM). Please retry in ${(waitMs / 1000).toFixed(0)}s.` }); } catch {}
          } catch {}
          return;
        }

        if (rateLimited && backoffRetries.value < MAX_BACKOFF_RETRIES && sendOptions.value) {
          let waitMs = 1000 * Math.pow(2, backoffRetries.value); // 1s, 2s, 4s max (retries capped)
          try {
            // Try to parse suggested cooldown like: "Please try again in 336ms" or "in 5.1s"
            const msMatch = /try again in\s*(\d+(?:\.\d+)?)\s*ms/i.exec(error.message || '');
            const sMatch = /try again in\s*(\d+(?:\.\d+)?)\s*s(ec|econds)?/i.exec(error.message || '');
            if (msMatch) waitMs = Math.max(waitMs, Math.ceil(parseFloat(msMatch[1])) + 150);
            else if (sMatch) waitMs = Math.max(waitMs, Math.ceil(parseFloat(sMatch[1]) * 1000) + 150);
          } catch {}
          try {
            const key = `${sendOptions.value.providerId}:${sendOptions.value.modelId}`;
            modelCooldownUntil[key] = Date.now() + waitMs;
          } catch {}
          // Add small jitter (0-250ms) to avoid thundering herd
          waitMs += Math.floor(Math.random() * 250);
          try { notify('broadcast', { message: `Rate-limited. Retrying in ${(waitMs/1000).toFixed(1)}s...` }); } catch {}
          // Before retrying, aggressively trim messages to reduce TPM on next call
          if (error.message.includes("all messages must have non-empty content")) {
            // FIXME we dont need this once we upgrade to AI SDK v5 since we use `convertToModelMessages()`
            // See https://ai-sdk.dev/docs/troubleshooting/use-chat-tools-no-response
            // IMPORTANT: Do NOT mutate messages.value here.
            // Mutating the UI message list can make the conversation appear to "reset" mid-chat.
            // Instead, just retry; the fetch() path already sanitizes outbound messages.
            nextTick().then(() => {
              retry(sendOptions.value!);
            })
          } else {
            backoffRetries.value++;
            let waitMs = 1000 * Math.pow(2, backoffRetries.value); // 1s, 2s, 4s max (retries capped)
            try { notify('broadcast', { message: `Rate-limited. Retrying in ${(waitMs/1000).toFixed(1)}s...` }); } catch {}
            await new Promise((r) => setTimeout(r, waitMs));
            retry(sendOptions.value!);
          }
        }

        // Google Gemini thought_signature enforcement (tools): fallback to safe model and retry once.
        try {
          const errMsg = String((error as any)?.message || '');
          const isThoughtSig = /thought_signature/i.test(errMsg);
          const isGoogle = sendOptions.value?.providerId === 'google';
          if (isThoughtSig && isGoogle && sendOptions.value) {
            const now = Date.now();
            const currentModel = String(sendOptions.value.modelId || '');
            const key = `googleThoughtSig:${currentModel}`;
            if (lastGoogleThoughtSigFallbackKey !== key || (now - lastGoogleThoughtSigFallbackAt) > 30_000) {
              lastGoogleThoughtSigFallbackKey = key;
              lastGoogleThoughtSigFallbackAt = now;

              // Only switch if we're not already on the fallback.
              if (currentModel !== GOOGLE_TOOL_FALLBACK_MODEL_ID) {
                sendOptions.value = {
                  ...sendOptions.value,
                  modelId: GOOGLE_TOOL_FALLBACK_MODEL_ID as any,
                  retrying: true as any,
                } as any;
                try {
                  notify('broadcast', {
                    message: `Google Gemini model '${currentModel}' requires thought signatures for tools. Switching to '${GOOGLE_TOOL_FALLBACK_MODEL_ID}' and retrying...`,
                  });
                } catch {}
                try { retry(sendOptions.value as any); } catch {}
                return;
              }
            }
          }
        } catch {}
      },
      onFinish: (message, options) => {
        try { isSending.value = false; } catch {}
        saveMessages();
        // Reset backoff after a successful assistant message
        backoffRetries.value = 0;

        // Provider-agnostic auto-resume: some providers can stop silently mid-investigation
        // (no error surfaced) even though the assistant was clearly about to continue.
        // We retry ONCE per user turn with a hidden "continue" instruction, debounced.
        const scheduleAutoResume = (reason: string) => {
          try {
            if (!sendOptions.value) return;
            // Anthropic Tier-1: do not auto-resume/reload, it can create extra requests and hit TPM.
            if (sendOptions.value.providerId === 'anthropic') return;

            const now = Date.now();
            const lastUser = [...(messages.value || [])].reverse().find((m: any) => m?.role === 'user');
            const userText = String((lastUser as any)?.content || '').slice(0, 4000);
            const userHash = `${userText.length}:${userText.slice(0, 40)}:${userText.slice(-40)}`;
            if (lastUserHashForAutoResume !== userHash) {
              lastUserHashForAutoResume = userHash;
              autoResumeCountForLastUser = 0;
            }
            if (autoResumeCountForLastUser >= AUTO_RESUME_MAX_PER_USER_TURN) return;

            const key = `autoResume:${reason}:${userHash}`;
            const lastKey = lastAutoContinueKey;
            const lastAt = lastAutoContinueAt || 0;
            if (lastKey === key && (now - lastAt) < AUTO_RESUME_COOLDOWN_MS) return;

            lastAutoContinueKey = key;
            lastAutoContinueAt = now;
            autoResumeCountForLastUser++;

            // Append a minimal hidden instruction for the next request.
            // This is provider-agnostic and avoids re-sending large context.
            pendingHiddenContext.value = `\n\n<auto_resume reason="${String(reason).slice(0, 80)}">\nContinue exactly from where you stopped.\n- Do NOT restart the investigation.\n- Continue running the next diagnostic query if needed.\n- If you already have enough data, produce the final recommendations now.\n</auto_resume>`;
            try { console.warn('[useAI] Auto-resume triggered:', reason); } catch {}
            setTimeout(() => {
              try { reload(); } catch (_) {}
            }, 80);
          } catch (_) {}
        };

        // Some providers/hosts can end the stream with no assistant text and/or 0 token usage,
        // especially when a tool result is missing/empty. In that case, retry once automatically.
        try {
          const usage = (options as any)?.usage;
          const totalTokens = typeof usage?.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
            ? usage.totalTokens
            : null;
          const msgText = (message as any)?.content ? String((message as any).content) : '';
          const hasAssistantText = !!msgText && msgText.trim().length > 0;
          const shouldRetryEmpty = (!hasAssistantText) || (totalTokens === 0);
          if (shouldRetryEmpty && sendOptions.value) {
            if (sendOptions.value.providerId === 'anthropic') {
              return;
            }
            const key = `autoRetryEmpty:${hasAssistantText ? 'noTokens' : 'noText'}`;
            const lastKey = lastAutoContinueKey;
            const lastAt = lastAutoContinueAt || 0;
            if (lastKey !== key || (Date.now() - lastAt) > 10_000) {
              lastAutoContinueKey = key;
              lastAutoContinueAt = Date.now();
              console.warn('[useAI] Auto-retrying after empty/zero-token completion', { hasAssistantText, totalTokens });
              // IMPORTANT: do not leave behind an empty assistant message; remove it before retry.
              try {
                const arr: any[] = Array.isArray(messages.value) ? (messages.value as any[]) : [];
                const last = arr.length > 0 ? arr[arr.length - 1] : null;
                if (last && last.role === 'assistant' && isEmptyUIMessage(last as any)) {
                  messages.value = arr.slice(0, -1) as any;
                }
              } catch (_) {}
              setTimeout(() => {
                try { retry(sendOptions.value!); } catch (_) {}
              }, 150);
              return;
            }

            // We already auto-retried recently; don't leave a blank message.
            try {
              const arr: any[] = Array.isArray(messages.value) ? (messages.value as any[]) : [];
              const last = arr.length > 0 ? arr[arr.length - 1] : null;
              if (last && last.role === 'assistant' && isEmptyUIMessage(last as any)) {
                const fallbackText = '⚠️ The AI provider returned an empty response. Please retry.';
                last.content = fallbackText;
                // IMPORTANT: isEmptyUIMessage() prefers parts over content when parts exist.
                // Ensure we also add a non-empty text part so the UI doesn't render it as empty.
                try {
                  if (!Array.isArray(last.parts)) last.parts = [];
                  const hasNonEmptyTextPart = (last.parts as any[]).some(
                    (p: any) => p && p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0
                  );
                  if (!hasNonEmptyTextPart) {
                    (last.parts as any[]).push({ type: 'text', text: fallbackText });
                  }
                } catch (_) {}
              }
            } catch (_) {}
          }
        } catch (_) {}

        // Auto-continue tool-only turns: sometimes the provider stops immediately
        // after emitting tool calls/results (e.g., run_query) and never generates
        // the required assistant analysis.
        try {
          const msgText = (message as any)?.content ? String((message as any).content) : '';
          const hasAssistantText = !!msgText && msgText.trim().length > 0;
          if (!hasAssistantText) {
            const arr: any[] = Array.isArray(messages.value) ? (messages.value as any[]) : [];
            const last = arr.length > 0 ? arr[arr.length - 1] : null;
            const lastRole = last?.role;
            const lastContent = typeof last?.content === 'string' ? last.content : '';
            const looksLikeToolOnly =
              lastRole === 'tool' ||
              (lastRole === 'assistant' && /^\s*\[Tool result:/i.test(lastContent));

            if (looksLikeToolOnly) {
              scheduleAutoResume(`toolOnly:${String(lastRole || 'unknown')}`);
            }
          }
        } catch (_) {}

        // Auto-continue investigations: sometimes the model ends the stream early
        // even though run_diagnostic_query indicates continuationRequired=true.
        // In that case, trigger a reload to let the model keep chaining queries
        // until the minimum threshold is reached.
        try {
          const arr: any[] = Array.isArray(messages.value) ? (messages.value as any[]) : [];
          const lastTool = [...arr].reverse().find((mm: any) => mm?.role === 'tool' && typeof mm?.content === 'string');
          if (lastTool && typeof lastTool.content === 'string') {
            let parsed: any = null;
            try { parsed = JSON.parse(lastTool.content); } catch (_) {}
            const continuationRequired = !!(parsed && parsed.continuationRequired === true);
            const queryCount = typeof parsed?.queryCount === 'number' ? parsed.queryCount : null;
            const minimumRequired = typeof parsed?.minimumRequired === 'number' ? parsed.minimumRequired : null;

            // Only auto-continue if we are clearly below the minimum and the model didn't continue on its own.
            if (continuationRequired && queryCount !== null && minimumRequired !== null && queryCount < minimumRequired) {
              scheduleAutoResume(`investigation:${queryCount}/${minimumRequired}`);
            }
          }
        } catch (_) {}

        // Silent mid-stream stop heuristic: assistant says it will continue (e.g. "Next I will...")
        // but no further tool call happens and the turn ends. Auto-resume once.
        try {
          const msgText = (message as any)?.content ? String((message as any).content) : '';
          const t = msgText.trim();
          if (t) {
            const suggestsContinuation = /\b(next|to further investigate|i will now|i will check|i will investigate|i will look|i will run|i will query|i will examine)\b/i.test(t);
            // Avoid retrying on clearly-final answers.
            const looksFinal = /\b(conclusion|recommendations|summary|final)\b/i.test(t);
            if (suggestsContinuation && !looksFinal) {
              scheduleAutoResume('assistantPromisedNextStep');
            }
          }
        } catch (_) {}
        
        // Log AI usage
        try {
          const usage = (options as any)?.usage;
          if (usage && sendOptions.value) {
            const duration = requestStartTime.value > 0 ? Date.now() - requestStartTime.value : 0;
            const userContext = getUserContext();
            logAIUsage({
              ...userContext,
              providerId: sendOptions.value.providerId,
              modelId: sendOptions.value.modelId,
              requestType: 'chat',
              inputTokens: usage.promptTokens || 0,
              outputTokens: usage.completionTokens || 0,
              totalTokens: usage.totalTokens || 0,
              requestDuration: duration,
              success: true,
            }).catch(err => console.error('[AI Usage] Failed to log:', err));
            requestStartTime.value = 0; // Reset
          }
        } catch (err) {
          console.error('[AI Usage] Error in onFinish:', err);
        }
      },
      initialMessages: options.initialMessages,
    });

  function saveMessages() {
    // Skip saving during restore to prevent race conditions
    if (isRestoring) {
      console.log('[saveMessages] Skipping save during restore');
      return;
    }
    useTabState().setTabState("messages", messages.value);
  }

  function clearRestoreState(reason?: string) {
    try {
      if (restoreTimeout) {
        clearTimeout(restoreTimeout);
        restoreTimeout = null;
      }
    } catch (_) {}
    isRestoring = false;
    // In general we keep lastRestoredMessages to defend against late rehydration
    // overwriting the array with [].
    //
    // BUT: if the user explicitly cleared the conversation/history, we must
    // *not* re-apply restored messages (otherwise deleted messages reappear).
    try {
      const r = String(reason || '').toLowerCase();
      const userCleared =
        r.includes('startnewchat') ||
        r.includes('afterclearall') ||
        r.includes('clear') ||
        r.includes('delete');
      if (userCleared) {
        lastUserInitiatedClearAt = Date.now();
        restoreGuardUntil = 0;
        lastRestoredMessages = [];
        // Prevent the "restore protection" watcher from re-applying old messages
        // if some other async rehydration briefly wipes the array after a user action.
        suppressRestoreReapplyUntil = Date.now() + 120_000;
      }
    } catch (_) {}
    try { pendingHiddenContext.value = ''; } catch (_) {}
    if (reason) {
      console.log('[useAI] clearRestoreState:', reason);
    }
  }

  /** If toolCallId is not provided, all tool calls are accepted */
  function acceptPermission(toolCallId?: string) {
    permitted = true;
    if (toolCallId === undefined) {
      pendingToolCallIds.value = [];
    } else {
      pendingToolCallIds.value = pendingToolCallIds.value.filter(
        (id) => id !== toolCallId
      );
    }
  }

  /** After the user rejected the permission, they can provide a follow-up message.
   * If no toolCallId is provided, all tool calls are rejected.*/
  function rejectPermission(toolCallId?: string, userFollowup?: string) {
    if (userFollowup) {
      followupAfterRejected.value = userFollowup;
    }
    permitted = false;
    if (toolCallId === undefined) {
      pendingToolCallIds.value = [];
    } else {
      pendingToolCallIds.value = pendingToolCallIds.value.filter(
        (id) => id !== toolCallId
      );
    }
  }

  // Lightweight, rate-limit aware title generation
  let lastTitleAttemptAt = 0;
  const ENABLE_TITLE_GENERATION = false;
  // Debounce state for investigation auto-continue
  let lastAutoContinueKey = '';
  let lastAutoContinueAt = 0;
  async function fillTitle(options: SendOptions) {
    try {
      if (useTabState().conversationTitle) return; // already set
      if (!ENABLE_TITLE_GENERATION) return; // disabled to reduce TPM
      // Debounce attempts and avoid adding load when rate-limited
      const since = Date.now() - lastTitleAttemptAt;
      if (since < 20_000) return; // at most once every 20s
      // Skip when conversation is long to save TPM
      if ((messages.value?.length || 0) > 8) return;
      // Skip if a cooldown is active for this model
      const key = `${options.providerId}:${options.modelId}`;
      if ((modelCooldownUntil[key] || 0) > Date.now()) return;
      // Use only the last user message, trimmed
      const lastUser = [...(messages.value || [])].reverse().find((m) => m.role === 'user');
      const lastText = (lastUser?.content || '').toString().slice(0, 200);
      if (!lastText) return;
      lastTitleAttemptAt = Date.now();
      const provider = await createProvider(options.providerId);
      const res = await provider.generateObject({
        modelId: options.modelId,
        schema: z.object({
          title: z.string().describe("The title of the conversation"),
        }),
        prompt: `Name this conversation in <=30 chars or <=6 words.\nUser: ${lastText}`,
      });
      await useTabState().setTabTitle(res.object.title);
    } catch (err: any) {
      // Swallow 429s or any errors silently; title is non-critical
    }
  }

  /** Send a message to the AI */
  async function send(message: string, options: SendOptions, hiddenContext?: string) {
    console.log('[ai.send] Called with message:', message, 'Messages count before:', messages.value.length)

    // Single-flight guard: do not allow overlapping sends.
    // Overlaps + SDK retries can easily exceed provider TPM.
    try {
      if (isSending.value) {
        notify('broadcast', { message: 'AI request already in progress. Please wait for it to finish.' });
        return;
      }
    } catch {}

    // Defensive: some UI paths can call send() before a provider/model is chosen.
    // Avoid crashing the plugin; instead notify and return.
    try {
      const resolved = (options && (options as any).providerId && (options as any).modelId)
        ? options
        : (sendOptions.value as any);
      if (!resolved || !resolved.providerId || !resolved.modelId) {
        try { notify('broadcast', { message: 'Please select a provider/model before sending.' }); } catch {}
        return;
      }
      options = resolved as any;
    } catch {
      try { notify('broadcast', { message: 'Please select a provider/model before sending.' }); } catch {}
      return;
    }

    // Option A (pre-flight): prevent Google models that require thought_signature from entering tool mode.
    // We fallback to a known-good model so investigations don't fail mid-flight.
    try {
      if (options?.providerId === 'google' && isGoogleThoughtSignatureModel(options.modelId || '')) {
        const prev = String(options.modelId || '');
        if (prev !== GOOGLE_TOOL_FALLBACK_MODEL_ID) {
          options = { ...options, modelId: GOOGLE_TOOL_FALLBACK_MODEL_ID as any };
          try {
            notify('broadcast', {
              message: `Google Gemini model '${prev}' is not supported for tool workflows. Using '${GOOGLE_TOOL_FALLBACK_MODEL_ID}' instead.`,
            });
          } catch {}
        }
      }
    } catch {}
    // Enforce model/provider cooldown BEFORE we append a new message.
    // Otherwise the UI can queue up multiple sends while Gemini is rate-limiting.
    try {
      const key = `${options.providerId}:${options.modelId}`;
      const until = modelCooldownUntil[key] || 0;
      if (until > Date.now()) {
        const waitMs = Math.max(0, until - Date.now());
        try { notify('broadcast', { message: `Rate-limited. Please retry in ${(waitMs / 1000).toFixed(1)}s.` }); } catch {}
        return;
      }
    } catch {}
    
    // FIXME: Remove after v5 upgrade
    sendOptions.value = options;
    // Track request start time for duration logging
    requestStartTime.value = Date.now();
    try { isSending.value = true; } catch {}
    
    // If we're currently asking for permission and the user replies with confirmation,
    // auto-accept to unblock the pending tool call(s) for this turn.
    try {
      const isConfirm = /^(ok|okay|yes|yep|sure|do it|go ahead|proceed|continue|please\s+insert|insert\s+it|looks good|apply\s+it|run\s+it)\b/i.test(message.trim());
      if (askingPermission.value && isConfirm) {
        acceptPermission();
      }
    } catch {}
    
    // Detect sp_blitz* and sp_whoisactive* commands for bypass logic
    const messageLower = message.toLowerCase().trim();
    const commandMatch = messageLower.match(/^\/?(sp[-_]blitz[a-z]*|sp[-_]whoisactive[a-z]*)/);
    let modifiedMessage = message;
    
    if (commandMatch) {
      const command = commandMatch[1].replace(/_/g, '-');
      try {
        console.log('[AI] Detected sp_blitz/sp_whoisactive command in chat:', command);
        
        // Import buildCommandPrompt from tools
        const { buildCommandPrompt } = await import('@/tools');
        
        // Build single-phase prompt using buildCommandPrompt
        const singlePhasePrompt = buildCommandPrompt(
          command,
          null, // database - will be fetched by tools
          [], // mentions
          [], // tables
          message, // user prompt
          null, // systemObjectSchemas
          null  // mentionedObjectsWithTypes
        );
        
        // Replace message with single-phase prompt
        modifiedMessage = `${message}\n\n🚨 BYPASS 3-PHASE WORKFLOW - USE SINGLE-PHASE GENERATION:\n\n${singlePhasePrompt}`;
        console.log('[AI] Using single-phase bypass for sp_blitz command in chat');
      } catch (e) {
        console.error('[AI] Error building bypass prompt:', e);
        // Fall through to normal message if bypass fails
      }
    }
    
    // If hiddenContext is provided, store it in ref so fetch function can append it
    if (hiddenContext) {
      pendingHiddenContext.value = hiddenContext;
      console.log('[AI] Stored hidden context for next request, length:', hiddenContext.length);
    }
    
    // Clear the isRestoring flag and restore guard BEFORE appending the user message
    // This prevents the watch effect from triggering the restore guard incorrectly
    if (isRestoring) {
      console.log('[send] Clearing isRestoring flag on user message');
      isRestoring = false;
    }
    // Once the user interacts, we no longer need the restored-message cache.
    try {
      lastRestoredMessages = [];
      restoreGuardUntil = 0;
    } catch (_) {}
    
    // Add clean message to chat (hidden context will be appended in fetch function)
    console.log('[ai.send] About to call append, messages count:', messages.value.length)
    await append(
      {
        role: "user",
        content: modifiedMessage, // Modified message with bypass prompt if applicable
      },
      {
        body: {
          sendOptions: options,
        },
      },
    );
    console.log('[ai.send] After append, messages count:', messages.value.length)
    
    if (ENABLE_TITLE_GENERATION) {
      fillTitle(options);
    }
  }

  async function retry(options: SendOptions) {
    if (!options || !(options as any).providerId || !(options as any).modelId) return;
    // FIXME: Remove after v5 upgrade
    sendOptions.value = options;
    await reload({
      body: {
        sendOptions: options,
      },
    });
  }

  // Keep isSending in sync with chat stream lifecycle.
  // This prevents overlapping sends from flooding the provider.
  watch(status, (s) => {
    try {
      if (s === 'ready' || s === 'error') isSending.value = false;
      if (s === 'streaming' || s === 'submitted') isSending.value = true;
    } catch {}
  });

  function abort() {
    stop();
    try { isSending.value = false; } catch {}
    saveMessages();
  }

  // Restore messages from a saved session (used by ChatInterface restore flow)
  function restoreMessages(newMessages: Message[]) {
    try {
      console.log('[restoreMessages] Starting restore with', newMessages?.length, 'messages');
      // Set flag to prevent saveMessages from being called during restore
      isRestoring = true;
      // Keep a guard window to protect against late host rehydration clearing messages.
      // Some hosts can overwrite plugin state several seconds after initial mount.
      restoreGuardUntil = Date.now() + 60_000;
      // Suppress guard for 3000ms to allow @ai-sdk/vue internal initialization
      // This prevents false positives during the restore operation itself
      // Extended to 3s to cover very late rehydration that can happen 2-3s after restore
      suppressRestoreReapplyUntil = Date.now() + 3000;
      // Prevent tab/view-state late sync from overwriting restored messages with []
      try { useTabState().lockMessagesRestore?.(30_000 as any); } catch (_) {}
      try {
        if (restoreTimeout) clearTimeout(restoreTimeout);
        // Restore mode should only cover startup/rehydration races; do not keep it indefinitely.
        restoreTimeout = setTimeout(() => {
          // End restore mode, but keep the lastRestoredMessages cache + guard window.
          // Otherwise, late rehydration can clear messages and we lose the ability to restore.
          isRestoring = false;
          console.log('[useAI] clearRestoreState: auto-timeout after restore');
        }, 30_000);
      } catch (_) {}

      const sanitizeRestoredContent = (msg: any) => {
        try {
          const MAX_CONTENT_CHARS = 12_000;
          const MAX_PART_TEXT_CHARS = 8_000;
          const MAX_PART_JSON_CHARS = 4_000;
          const MAX_PART_PREVIEW_CHARS = 800;
          const MAX_MESSAGE_JSON_CHARS = 25_000;
          const m = { ...msg };

          // Strip known heavy fields that can balloon persisted/restored messages.
          try {
            delete (m as any).toolInvocations;
            delete (m as any).annotations;
            delete (m as any).data;
            delete (m as any).experimental_providerMetadata;
            delete (m as any).providerMetadata;
            delete (m as any).response;
            delete (m as any).result;
          } catch (_) {}

          if (typeof m.content === 'string') {
            if (m.content.length > MAX_CONTENT_CHARS) {
              m.content = m.content.slice(0, MAX_CONTENT_CHARS) + '…';
              (m as any).truncated = true;
            }
          } else if (Array.isArray(m.content)) {
            try {
              m.content = (m.content as any[]).map((p: any) => {
                if (p && typeof p.text === 'string' && p.text.length > MAX_PART_TEXT_CHARS) {
                  return { ...p, text: p.text.slice(0, MAX_PART_TEXT_CHARS) + '…', truncated: true };
                }
                return p;
              });
            } catch (_) {}
          }

          // IMPORTANT: Large payloads often live inside `parts` (tool-call/result data).
          // Compact them to keep restore + token estimation safe.
          if (Array.isArray((m as any).parts) && (m as any).parts.length > 0) {
            try {
              (m as any).parts = (m as any).parts.map((p: any) => {
                try {
                  if (!p || typeof p !== 'object') return p;
                  const json = (() => { try { return JSON.stringify(p); } catch { return ''; } })();
                  if (json && json.length <= MAX_PART_JSON_CHARS) return p;
                  const type = (p as any).type;
                  const name = (p as any).name || (p as any).toolName;
                  const id = (p as any).toolCallId || (p as any).id;
                  const text = typeof (p as any).text === 'string' ? (p as any).text : '';
                  const preview = text ? (text.length > MAX_PART_PREVIEW_CHARS ? text.slice(0, MAX_PART_PREVIEW_CHARS) + '…' : text) : undefined;
                  // CRITICAL: the AI SDK expects `type: "tool-invocation"` parts to have a `toolInvocation` object
                  // (it reads `part.toolInvocation.step`). If we strip toolInvocation but keep the type,
                  // the stream can crash after restore. Convert tool parts into harmless text parts.
                  if (type === 'tool-invocation' || (p as any).toolInvocation || (p as any).toolResult) {
                    const label = name ? String(name) : 'tool';
                    const safeText = preview ? String(preview) : `[${label}]`;
                    return { type: 'text', text: safeText, truncated: true };
                  }
                  return { type: 'text', text: preview ? String(preview) : '', truncated: true };
                } catch {
                  return { truncated: true };
                }
              });
            } catch (_) {}
          }

          // Final guard: if the message object is still huge, replace with minimal shape.
          try {
            const msgLen = JSON.stringify(m).length;
            if (msgLen > MAX_MESSAGE_JSON_CHARS) {
              return {
                id: (m as any).id,
                role: (m as any).role,
                name: (m as any).name,
                content: typeof (m as any).content === 'string'
                  ? ((m as any).content.length > 4_000 ? (m as any).content.slice(0, 4_000) + '…' : (m as any).content)
                  : (m as any).content,
                parts: Array.isArray((m as any).parts) ? (m as any).parts : [],
                truncated: true,
              };
            }
          } catch (_) {}

          return m;
        } catch (_) {
          return msg;
        }
      };
      
      // Normalize to UIMessage shape expected by @ai-sdk/vue (ensure parts[] exists)
      const normalized = (Array.isArray(newMessages) ? newMessages : [])
        .filter((m: any) => m && typeof m.role === 'string')
        .map((m: any) => {
          const id = m.id || `msg_${Math.random().toString(36).slice(2)}`;
          const parts = Array.isArray(m.parts) ? m.parts : [];
          // Keep existing content; UI layer tolerates both content and parts
          return sanitizeRestoredContent({ ...m, id, parts } as any);
        });
      console.log('[restoreMessages] Normalized', normalized.length, 'messages');
      
      // CRITICAL: Cache restored messages BEFORE setting messages.value
      // This ensures the watch effect sees the correct lastRestoredMessages when it triggers
      try {
        lastRestoredMessages = Array.isArray(normalized) ? [...normalized] : [];
        console.log('[restoreMessages] Updated lastRestoredMessages cache with', lastRestoredMessages.length, 'messages');
      } catch (_) {
        lastRestoredMessages = [];
      }
      
      // Replace entire array to ensure watchers update correctly
      (messages as any).value = normalized as any;
      console.log('[restoreMessages] Messages.value set to', (messages as any).value?.length, 'messages');

      // Sync restored messages into tab state to prevent delayed tab-state rehydration from
      // overwriting the restored list with an empty array.
      try {
        useTabState().setTabState('messages', (messages as any).value);
        console.log('[restoreMessages] Tab state synced with restored messages');
      } catch (e) {
        console.warn('[restoreMessages] Failed to sync tab state during restore', e);
      }
      
      // DO NOT update tab state here - let it stay out of sync during restore
      // The tab state will be updated naturally when the user sends the next message
      // This prevents race conditions with the reactive prop system
      console.log('[restoreMessages] Skipping tab state sync to prevent race conditions');
      
      // Keep the flag set indefinitely until the next user interaction
      // This prevents any automatic saves from clearing the restored messages
      console.log('[restoreMessages] Restore complete, keeping isRestoring flag set until next user message');
    } catch (e) {
      console.error('[restoreMessages] Error during restore:', e);
      isRestoring = false; // Reset flag on error
    }
  }

  // Extra guard: during restore, prevent any async rehydration from wiping messages to [].
  // If it happens, immediately re-apply the last restored list and re-sync tab state.
  let isReapplying = false; // Prevent watch from triggering itself
  try {
    watch(messages, (newVal: any, oldVal: any) => {
      try {
        // Prevent reentry: if we're currently re-applying messages, don't trigger again
        if (isReapplying) return;

        const newLen = Array.isArray(newVal) ? newVal.length : 0;
        const oldLen = Array.isArray(oldVal) ? oldVal.length : 0;
        const withinGuard = restoreGuardUntil > Date.now();
        const reapplySuppressed = suppressRestoreReapplyUntil > Date.now();

        // Track last known non-empty messages for general protection.
        if (newLen > 0) {
          try { lastNonEmptyMessages = Array.isArray(newVal) ? [...newVal] : []; } catch { lastNonEmptyMessages = []; }
        }

        // Stronger guard: during restore, also prevent non-empty message list from being
        // overwritten by a different non-empty list (e.g. restored 2 msgs -> overwritten by 4 msgs).
        // This happens when late view/tab-state rehydration races with manual restore.
        if (
          isRestoring &&
          withinGuard &&
          !reapplySuppressed &&
          newLen > 0 &&
          oldLen > 0 &&
          Array.isArray(lastRestoredMessages) &&
          lastRestoredMessages.length > 0
        ) {
          const newSig = getMessagesSignature(newVal);
          const restoredSig = getMessagesSignature(lastRestoredMessages);
          if (newSig !== restoredSig) {
            console.warn('[useAI] Messages overwritten during restore; re-applying lastRestoredMessages', {
              oldLen,
              newLen,
              restoredLen: lastRestoredMessages.length,
            });
            isReapplying = true;
            try {
              (messages as any).value = [...lastRestoredMessages] as any;
              try { useTabState().setTabState('messages', (messages as any).value); } catch (_) {}
            } finally {
              isReapplying = false;
            }
            return;
          }
        }

        // Only defend against clears while a restore is actually in-progress.
        // If the user intentionally cleared/deleted/started a new chat, never re-apply.
        if (isRestoring && withinGuard && !reapplySuppressed && newLen === 0 && oldLen > 0 && Array.isArray(lastRestoredMessages) && lastRestoredMessages.length > 0) {
          console.warn('[useAI] Messages cleared during restore; re-applying lastRestoredMessages', { oldLen, restoredLen: lastRestoredMessages.length });
          try {
            const stack = (new Error('[useAI] Stack trace for restore clear')).stack;
            console.warn(stack || '[useAI] Stack trace for restore clear: <no stack>');
          } catch (_) {
            console.trace('[useAI] Stack trace for restore clear');
          }
          isReapplying = true;
          try {
            (messages as any).value = [...lastRestoredMessages] as any;
            try { useTabState().setTabState('messages', (messages as any).value); } catch (_) {}
          } finally {
            isReapplying = false;
          }
        }

        // General protection (outside restore): if the message list becomes empty unexpectedly,
        // restore the last known non-empty list. This addresses intermittent "conversation restarts".
        try {
          const now = Date.now();
          const recentlyUserCleared = (now - (lastUserInitiatedClearAt || 0)) < 2000;
          if (!isRestoring && !reapplySuppressed && !recentlyUserCleared && newLen === 0 && oldLen > 0) {
            const fallbackLen = Array.isArray(lastNonEmptyMessages) ? lastNonEmptyMessages.length : 0;
            if (fallbackLen > 0) {
              console.warn('[useAI] Unexpected message clear (non-restore); restoring lastNonEmptyMessages', { oldLen, fallbackLen });
              isReapplying = true;
              try {
                (messages as any).value = [...lastNonEmptyMessages] as any;
                try { useTabState().setTabState('messages', (messages as any).value); } catch (_) {}
              } finally {
                isReapplying = false;
              }
              return;
            }
          }
        } catch (_) {}
      } catch (_) {}
    }, { deep: false });
  } catch (_) {}

  return {
    messages,
    input,
    error,
    status,
    pendingToolCallIds,
    askingPermission,
    acceptPermission,
    rejectPermission,
    send,
    abort,
    retry,
    restoreMessages,
    clearRestoreState,
  };
}
