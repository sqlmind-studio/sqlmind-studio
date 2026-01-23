<template>
  <div class="chat-history">
    <div class="history-header">
      <h3>Chat History</h3>
      <button @click="$emit('close')" class="close-btn">×</button>
    </div>

    <div class="history-actions">
      <div v-if="sessions.length > 0" class="search-row">
        <input
          v-model.trim="searchTerm"
          type="text"
          class="search-input"
          placeholder="Search chats..."
        />
        <button
          v-if="searchTerm"
          class="search-clear"
          @click="searchTerm = ''"
          title="Clear search"
        >
          ×
        </button>
      </div>
      <button @click="clearAll" class="clear-btn" v-if="sessions.length > 0">
        Clear All
      </button>
    </div>

    <div class="history-list" v-if="sessions.length > 0">
      <div v-for="(sessionGroup, date) in filteredSessionsByDate" :key="date" class="date-group">
        <div class="date-header">{{ date }}</div>
        <div
          v-for="session in sessionGroup"
          :key="session.id"
          class="history-item"
          :class="{ active: session.id === currentSessionId }"
          @click="restoreSession(session.id)"
        >
          <div class="session-info">
            <div class="session-title">{{ session.title }}</div>
            <div class="session-meta">
              <span class="session-time">{{ formatTime(session.timestamp) }}</span>
              <span v-if="session.database" class="session-db">{{ session.database }}</span>
              <span class="session-messages">{{ session.messages.length }} messages</span>
            </div>
          </div>
          <button @click.stop="onDeleteSession(session.id)" class="delete-btn" title="Delete">
            🗑️
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <p>No chat history yet</p>
      <p class="empty-hint">Your conversations will be saved automatically</p>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useChatHistoryStore } from "@/stores/chatHistory";
import { mapState, mapActions } from "pinia";

export default defineComponent({
  name: "ChatHistory",
  emits: ["close", "restore", "cleared"],

  data() {
    return {
      searchTerm: "",
    };
  },

  async mounted() {
    // Ensure sessions are loaded when component mounts
    const chatHistoryStore = useChatHistoryStore();
    console.log('[ChatHistory] Component mounted, sessions:', chatHistoryStore.sessions.length);

    // Always refresh from storage so newly created sessions show up immediately
    // in the history-only iframe view.
    try {
      await chatHistoryStore.loadSessions(true);
      console.log('[ChatHistory] After load, sessions:', chatHistoryStore.sessions.length);
    } catch (e) {
      console.warn('[ChatHistory] Failed to refresh sessions on mount:', e);
    }
  },

  computed: {
    ...mapState(useChatHistoryStore, ["sessions", "currentSessionId", "sessionsByDate"]),

    isHistoryOnlyView(): boolean {
      try {
        const params = new URLSearchParams(String(window.location.search || ''));
        return params.get('view') === 'history';
      } catch (_) {
        return false;
      }
    },

    filteredSessions(): any[] {
      const term = String((this as any).searchTerm || "").trim().toLowerCase();
      const all = Array.isArray((this as any).sessions) ? (this as any).sessions : [];
      if (!term) return all;

      return all.filter((s: any) => {
        try {
          const title = String(s?.title || "").toLowerCase();
          const db = String(s?.database || "").toLowerCase();
          if (title.includes(term) || db.includes(term)) return true;

          const messages = Array.isArray(s?.messages) ? s.messages : [];
          for (const m of messages) {
            const content = typeof m?.content === 'string' ? m.content : '';
            if (content && content.toLowerCase().includes(term)) return true;

            if (Array.isArray(m?.parts)) {
              for (const p of m.parts) {
                const preview = typeof p?.preview === 'string' ? p.preview : '';
                const text = typeof p?.text === 'string' ? p.text : '';
                if (preview && preview.toLowerCase().includes(term)) return true;
                if (text && text.toLowerCase().includes(term)) return true;
              }
            }
          }

          return false;
        } catch {
          return false;
        }
      });
    },

    filteredSessionsByDate(): Record<string, any[]> {
      const grouped: Record<string, any[]> = {};
      const sorted = [...this.filteredSessions].sort((a: any, b: any) => (b?.timestamp || 0) - (a?.timestamp || 0));

      sorted.forEach((session: any) => {
        const date = new Date(session.timestamp);
        const dateKey = date.toLocaleDateString();
        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        grouped[dateKey].push(session);
      });

      return grouped;
    },
  },

  methods: {
    ...mapActions(useChatHistoryStore, ["deleteSession", "clearAllSessions", "loadSessions", "setCurrentSession"]),

    async restoreSession(sessionId: string) {
      console.log('[ChatHistory] restoreSession called with sessionId:', sessionId);
      if ((this as any).isHistoryOnlyView) {
        // Persist selection so that when the user later opens the chat view,
        // it can auto-restore the selected session even if no chat iframe is mounted right now.
        try {
          const id = String(sessionId || '').trim();
          if (id) {
            try {
              const chatHistoryStore = useChatHistoryStore();
              chatHistoryStore.hasManuallyRestoredSession = true;
            } catch (_) {}
            // This persists CURRENT_SESSION_KEY via the store.
            await (this as any).setCurrentSession(id);
          }
        } catch (_) {}
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({
              name: 'broadcast',
              args: {
                message: {
                  type: 'bks-ai/restore-chat-session',
                  sessionId,
                },
              },
            }, '*');
          }
        } catch (_) {}

        // Ask the host app to switch the secondary sidebar to the main AI Mode tab
        // and forward the restore message to that iframe.
        // This avoids navigating the history-only iframe away from ?view=history,
        // which would prevent reopening the History view via the sidebar button.
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({
              type: 'bks-ai/ai-chat-history-restore',
              sessionId,
            }, '*');
          }
        } catch (_) {}
        return;
      }

      this.$emit("restore", sessionId);
      console.log('[ChatHistory] Emitted restore event');
      this.$emit("close");
    },

    async clearAll() {
      if (confirm("Are you sure you want to clear all chat history?")) {
        await this.clearAllSessions();
        // Force-refresh from storage to reflect the cleared state
        await (this as any).loadSessions(true);
        this.$emit('cleared');
        this.$emit('close');
      }
    },

    async onDeleteSession(sessionId: string) {
      try {
        const id = String(sessionId || '').trim();
        if (!id) return;

        if (!confirm('Delete this chat session?')) return;

        // If user deletes the currently selected session, clear selection first
        // so the app doesn't immediately re-open it on reload.
        try {
          if ((this as any).currentSessionId === id) {
            await (this as any).setCurrentSession(null);
          }
        } catch (_) {}

        await (this as any).deleteSession(id);

        // Re-sync from storage (important for the history-only iframe view)
        await (this as any).loadSessions(true);
      } catch (e) {
        console.warn('[ChatHistory] Failed to delete session:', e);
      }
    },

    formatTime(timestamp: number): string {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    },
  },
});
</script>

<style scoped>
.chat-history {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  background: var(--query-editor-bg);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.history-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--theme-base);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--brand-danger);
  line-height: 1;
}

.close-btn:hover {
  background: rgb(from var(--brand-danger) r g b / 10%);
}

.history-actions {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

 .search-row {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 10px;
 }

 .search-input {
  width: 100%;
  padding: 8px 28px 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: rgb(from var(--query-editor-bg) r g b / 60%);
  color: var(--theme-base);
  outline: none;
 }

 .search-input:focus {
  border-color: rgb(from var(--theme-primary) r g b / 60%);
 }

 .search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
  padding: 0;
 }

 .search-clear:hover {
  background: rgb(from var(--theme-base) r g b / 8%);
  color: var(--theme-base);
 }

.clear-btn {
  padding: 6px 12px;
  background: var(--brand-danger);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.clear-btn:hover {
  background: color-mix(in srgb, var(--brand-danger) 90%, black);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  width: 100%;
  box-sizing: border-box;
}

.date-group {
  margin-bottom: 16px;
  width: 100%;
  box-sizing: border-box;
}

.date-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 8px 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  margin: 4px 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.history-item:hover {
  background: rgb(from var(--theme-base) r g b / 5%);
}

.history-item.active {
  background: rgb(from var(--theme-primary) r g b / 15%);
  border-left: 3px solid var(--theme-primary);
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-weight: 500;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--theme-base);
}

.session-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.session-time {
  font-weight: 500;
  color: var(--theme-base);
}

.session-db {
  color: var(--theme-primary);
}

.session-messages {
  color: var(--text-muted);
}

.delete-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.delete-btn:hover {
  opacity: 1;
  background: rgb(from var(--brand-danger) r g b / 10%);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
}

.empty-state p {
  margin: 8px 0;
  color: var(--theme-base);
}

.empty-hint {
  font-size: 14px;
  opacity: 0.8;
  color: var(--text-muted);
}
</style>
