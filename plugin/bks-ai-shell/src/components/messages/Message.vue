<template>
  <div :class="['message', message.role]">
    <div class="message-content" :class="{ 'literally-empty': isEmpty && !hasToolInvocations }">
      <template v-if="message.role === 'system'" />
      <template v-else v-for="(part, index) of message.parts" :key="index">
        <template v-if="part.type === 'text'">
          <template v-if="message.role === 'user'">{{ part.text }}</template>
          <markdown v-else :content="part.text" @send-message="$emit('send-message', $event)" />
        </template>
        <tool-message v-else-if="part.type === 'tool-invocation' && part.toolInvocation" :toolCall="part.toolInvocation" :askingPermission="pendingToolCallIds.includes(part.toolInvocation.toolCallId)
          " @accept="$emit('accept-permission', part.toolInvocation.toolCallId)"
          @reject="$emit('reject-permission', part.toolInvocation.toolCallId)" />
        <tool-message v-else-if="(part as any).toolResult" :toolCall="wrapToolResult((part as any).toolResult) as any" :askingPermission="false" />
      </template>
      <span v-if="isEmpty && !hasToolInvocations">
        Empty response
      </span>
    </div>
    <div class="message-actions" v-if="status ==='ready'">
      <button class="btn btn-flat-2 copy-btn" :class="{ copied }" @click="handleCopyClick">
        <span class="material-symbols-outlined copy-icon">content_copy</span>
        <span class="material-symbols-outlined copied-icon">check</span>
        <span class="title-popup">
          <span class="copy-label">Copy</span>
          <span class="copied-label">Copied</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { PropType } from "vue";
import { UIMessage } from "ai";
import Markdown from "@/components/messages/Markdown.vue";
import ToolMessage from "@/components/messages/ToolMessage.vue";
import { clipboard } from "@sqlmindstudio/plugin";
import { isEmptyUIMessage } from "@/utils";

export default {
  name: "Message",

  components: {
    Markdown,
    ToolMessage,
  },

  props: {
    message: {
      type: Object as PropType<UIMessage>,
      required: true,
    },
    pendingToolCallIds: {
      type: Array as PropType<string[]>,
      required: true,
    },
    status: {
      type: String as PropType<"ready" | "processing">,
      required: true,
    }
  },

  data() {
    return {
      copied: false,
    };
  },

  computed: {
    text(): string {
      const parts = this.message.parts || [];
      let text = "";
      for (const part of parts) {
        if (part.type === "text") {
          text += `${part.text}\n\n`;
        } else if (
          part.type === "tool-invocation" &&
          part.toolInvocation &&
          part.toolInvocation.toolName === "run_query" &&
          part.toolInvocation.args?.query
        ) {
          text += "```sql\n" + part.toolInvocation.args.query + "\n```\n\n";
        }
      }
      return text.trim();
    },
    isEmpty() {
      return this.status === 'ready' && isEmptyUIMessage(this.message);
    },
    hasToolInvocations() {
      const parts = this.message.parts || [];
      return parts.some(part => part.type === 'tool-invocation');
    },
  },

  methods: {
    wrapToolResult(toolResult: any) {
      // Some AI SDK/provider versions emit tool output as a separate part:
      // { type: 'tool-result', toolResult: { toolCallId, toolName, result } }
      // Our ToolMessage component expects a ToolInvocation-like object.
      try {
        const toolCallId = String(toolResult?.toolCallId || toolResult?.id || `tool_${Math.random().toString(36).slice(2)}`);
        const toolName = String(toolResult?.toolName || toolResult?.name || 'tool');
        const result = toolResult?.result;
        return {
          toolCallId,
          toolName,
          state: 'result' as const,
          args: toolResult?.args,
          result,
        };
      } catch (_) {
        return {
          toolCallId: `tool_${Math.random().toString(36).slice(2)}`,
          toolName: 'tool',
          state: 'result' as const,
          result: toolResult,
        };
      }
    },
    async handleCopyClick() {
      await clipboard.writeText(this.text);
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 1000);
    },
  },
};
</script>
