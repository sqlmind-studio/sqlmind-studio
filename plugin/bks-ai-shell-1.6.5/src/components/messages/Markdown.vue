<template>
  <div class="markdown" v-html="html" @click="handleClick" ref="message"></div>
</template>

<script lang="ts">
import { clipboard, openTab } from "@sqlmindstudio/plugin";
import { parseMarkdownToHTML } from "@/markdownParser";

export default {
  props: ["content"],

  data() {
    return {
      copyTimeout: null as NodeJS.Timeout | null,
    };
  },

  computed: {
    html() {
      const raw = (this.content ?? '').toString();
      const trimmed = raw.trim();

      // If the model returns raw SQL without fencing, wrap it so it is always formatted.
      // This keeps the UI consistent and enables syntax highlighting + copy/open buttons.
      const alreadyFenced = /```/m.test(trimmed);
      const looksLikeSqlStart = /^\s*(with\b|select\b|insert\b|update\b|delete\b|merge\b|create\b|alter\b|drop\b|exec\b|execute\b|declare\b|begin\b)/i.test(trimmed);
      const hasSqlSignals = /\b(from|join|where|group\s+by|order\s+by|having)\b/i.test(trimmed) || /;\s*$/.test(trimmed);
      const looksLikeSqlOnly = looksLikeSqlStart && hasSqlSignals;

      const content = (!alreadyFenced && looksLikeSqlOnly)
        ? `\n\n\`\`\`sql\n${trimmed}\n\`\`\`\n`
        : raw;

      return parseMarkdownToHTML(content);
    },
  },

  methods: {
    async handleClick(e: MouseEvent) {
      console.log('[Markdown] Click event:', e.target);
      let target: HTMLButtonElement;

      if ((e.target as HTMLElement).hasAttribute("data-action")) {
        target = e.target as HTMLButtonElement;
      } else if (
        (e.target as HTMLElement).parentElement?.hasAttribute("data-action")
      ) {
        target = (e.target as HTMLElement).parentElement as HTMLButtonElement;
      } else {
        console.log('[Markdown] No data-action found on target or parent');
        return;
      }

      const action = target.getAttribute("data-action");
      const actionTargetId = target.getAttribute("data-action-target");
      
      console.log('[Markdown] Action:', action, 'Target ID:', actionTargetId);
      console.log('[Markdown] Button disabled:', target.disabled);
      console.log('[Markdown] Button has disabled attribute:', target.hasAttribute('disabled'));

      // Check if button is disabled
      if (target.disabled || target.hasAttribute('disabled')) {
        console.log('[Markdown] Button is disabled, ignoring click');
        return;
      }

      if (!action || !actionTargetId) {
        console.log('[Markdown] Missing action or target ID');
        return;
      }

      const el = (this.$refs.message as HTMLElement).querySelector(
        `#${actionTargetId}`,
      ) as HTMLElement | null;

      const rawAttr = el?.getAttribute('data-raw');
      const rawText = rawAttr
        ? (() => {
            try { return decodeURIComponent(rawAttr); } catch { return rawAttr; }
          })()
        : null;

      const text = rawText ?? el?.textContent;

      console.log('[Markdown] Text content:', text ? text.substring(0, 50) : 'null');

      if (!text) {
        console.log('[Markdown] No text content found for target ID:', actionTargetId);
        return;
      }

      switch (action) {
        case "copy": {
          clipboard.writeText(text);
          target.classList.add("copied");
          if (this.copyTimeout) {
            clearTimeout(this.copyTimeout);
          }
          this.copyTimeout = setTimeout(
            () => target.classList.remove("copied"),
            1000,
          );
          break;
        }
        case "open-in-query-editor": {
          try {
            console.log('[Markdown] Opening query in new tab');
            console.log('[Markdown] Query text length:', text.length);
            console.log('[Markdown] Query preview:', text.substring(0, 100));
            
            const result = await openTab("query", { query: text });
            console.log('[Markdown] openTab result:', result);
            console.log('[Markdown] Query tab opened successfully');
            
            // Visual feedback
            target.classList.add("copied");
            setTimeout(() => target.classList.remove("copied"), 1000);
          } catch (error) {
            console.error('[Markdown] Failed to open query tab:', error);
            console.error('[Markdown] Error details:', {
              name: error instanceof Error ? error.name : 'Unknown',
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined
            });
            alert('Failed to open query in editor. Check console for details.');
          }
          break;
        }
        case "run": {
          target.classList.add("running");
          // TODO call request("runQuery") here
          target.classList.remove("running");
          break;
        }
        case "send-message": {
          // Send the button text as a user message to continue the conversation
          console.log('[Markdown] Sending message:', text);
          this.$emit('send-message', text);
          
          // Visual feedback
          target.classList.add("copied");
          setTimeout(() => target.classList.remove("copied"), 500);
          break;
        }
      }
    },
  },
};
</script>
