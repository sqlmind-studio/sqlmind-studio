import { defineStore } from "pinia";
import { getData, setData } from "@sqlmindstudio/plugin";

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  messages: any[];
  database?: string;
  connectionType?: string;
  memorySummary?: string;
  memoryLastSql?: string;
  memoryLastDatabase?: string;
}

type ChatHistoryState = {
  sessions: ChatSession[];
  currentSessionId: string | null;
  hasManuallyRestoredSession: boolean;
};

const STORAGE_KEY = "chat_history_sessions";
const CURRENT_SESSION_KEY = "chat_history_current_session_id";
const CLEAR_MARKER_KEY = "chat_history_cleared_at";
const MAX_SESSIONS = 50; // Keep last 50 sessions
const SAVE_DEBOUNCE_MS = 2000; // Debounce saves to every 2 seconds

// Flag to abort in-flight save operations during manual restore
let abortSave = false;
let abortSaveUntil = 0; // Timestamp until which saves should be aborted
let abortSaveTimer: any = null;

function clearAbortSave() {
  abortSave = false;
  abortSaveUntil = 0;
  if (abortSaveTimer) {
    clearTimeout(abortSaveTimer);
    abortSaveTimer = null;
  }
}

export function setAbortSave(value: boolean) {
  if (value) {
    abortSave = true;
    // Keep abort flag active for 5 seconds to catch any delayed saves
    abortSaveUntil = Date.now() + 5000;
    if (abortSaveTimer) {
      clearTimeout(abortSaveTimer);
      abortSaveTimer = null;
    }
    abortSaveTimer = setTimeout(() => {
      // Auto-clear so we don't keep aborting saves minutes later.
      clearAbortSave();
      console.log('[ChatHistory] Abort save window expired; auto-cleared abort flag');
    }, 5500);
    console.log('[ChatHistory] Abort save flag set to true, active until:', new Date(abortSaveUntil).toISOString());
  } else {
    clearAbortSave();
    console.log('[ChatHistory] Abort save flag cleared');
  }
}

function compactSessionMessages(messages: any[]) {
  try {
    const MAX_MESSAGE_CHARS = 24_000; // Doubled from 12,000
    const MAX_MESSAGE_JSON_CHARS = 50_000; // Doubled from 25,000
    const MAX_MESSAGES_PER_SESSION = 150; // Increased from 80
    const MAX_PART_JSON_CHARS = 8_000; // Doubled from 4,000
    const MAX_PART_STRING_CHARS = 1600; // Doubled from 800
    const arr = Array.isArray(messages) ? messages : [];
    const sliced = arr.length > MAX_MESSAGES_PER_SESSION ? arr.slice(-MAX_MESSAGES_PER_SESSION) : arr;
    return sliced.map((m: any) => {
      try {
        if (!m || typeof m !== 'object') return m;
        const out: any = { ...m };

        // Strip known heavy fields that should never be persisted verbatim.
        try {
          delete out.toolInvocations;
          delete out.annotations;
          delete out.data;
          delete out.experimental_providerMetadata;
          delete out.providerMetadata;
          delete out.response;
          delete out.result;
        } catch (_) {}

        if (typeof out.content === 'string' && out.content.length > MAX_MESSAGE_CHARS) {
          out.content = out.content.slice(0, MAX_MESSAGE_CHARS) + '…';
          out.truncated = true;
        }

        // Compact parts payloads (tool calls/results often live here and can be huge)
        if (Array.isArray(out.parts) && out.parts.length > 0) {
          out.parts = out.parts.map((p: any) => {
            try {
              if (!p || typeof p !== 'object') return p;
              const partJson = (() => {
                try { return JSON.stringify(p); } catch { return ''; }
              })();
              if (partJson && partJson.length <= MAX_PART_JSON_CHARS) return p;

              const type = (p as any).type;
              const name = (p as any).name || (p as any).toolName;
              const id = (p as any).toolCallId || (p as any).id;

              // Preserve a tiny preview for text-like parts if present
              const text = typeof (p as any).text === 'string' ? (p as any).text : '';
              const preview = text ? (text.length > MAX_PART_STRING_CHARS ? text.slice(0, MAX_PART_STRING_CHARS) + '…' : text) : undefined;

              return {
                type,
                name,
                toolCallId: id,
                preview,
                truncated: true,
              };
            } catch {
              return { truncated: true };
            }
          });
        }

        // Final guard: if a single message is still too large, drop parts and clip content harder.
        try {
          const msgLen = JSON.stringify(out).length;
          if (msgLen > MAX_MESSAGE_JSON_CHARS) {
            const minimal: any = {
              id: out.id,
              role: out.role,
              name: out.name,
              content: typeof out.content === 'string'
                ? (out.content.length > 4_000 ? out.content.slice(0, 4_000) + '…' : out.content)
                : out.content,
              parts: Array.isArray(out.parts) ? out.parts : [],
              truncated: true,
            };
            return minimal;
          }
        } catch (_) {}

        return out;
      } catch {
        return m;
      }
    });
  } catch {
    return messages;
  }
}

// Debounce timer for saving
let saveTimer: NodeJS.Timeout | null = null;

// Guard against accidental overwrites of non-empty storage with an empty array.
// We only allow writing [] when the user explicitly cleared history.
let allowEmptyWriteOnce = false;

let loadSessionsInFlight: Promise<void> | null = null;
let hasLoadedOnce = false;

export const useChatHistoryStore = defineStore("chatHistory", {
  state: (): ChatHistoryState => ({
    sessions: [],
    currentSessionId: null,
    hasManuallyRestoredSession: false,
  }),

  getters: {
    currentSession(state): ChatSession | undefined {
      return state.sessions.find((s) => s.id === state.currentSessionId);
    },

    sortedSessions(state): ChatSession[] {
      return [...state.sessions].sort((a, b) => b.timestamp - a.timestamp);
    },

    sessionsByDate(state): Record<string, ChatSession[]> {
      const grouped: Record<string, ChatSession[]> = {};
      const sorted = [...state.sessions].sort((a, b) => b.timestamp - a.timestamp);

      sorted.forEach((session) => {
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

  actions: {
    async loadSessions(force = false) {
      if (!force && hasLoadedOnce) return;
      if (loadSessionsInFlight) return loadSessionsInFlight;

      loadSessionsInFlight = (async () => {
        try {
          console.log('Loading chat history from storage key:', STORAGE_KEY);
          const data = await getData(STORAGE_KEY);
          console.log('Loaded chat history data:', data);

          if (Array.isArray(data)) {
            let changed = false;
            const next = data.map((s: any) => {
              try {
                if (!s || typeof s !== 'object') return s;
                const before = (s as any).messages;
                const compacted = compactSessionMessages(before);
                try {
                  const beforeJson = JSON.stringify(before);
                  const afterJson = JSON.stringify(compacted);
                  if (beforeJson !== afterJson) changed = true;
                } catch (_) {}
                return { ...s, messages: compacted };
              } catch {
                return s;
              }
            });
            this.sessions = next;
            console.log('Successfully loaded', data.length, 'chat sessions');
            if (changed) {
              try { await this.saveSessions(true); } catch (_) {}
            }
          } else {
            this.sessions = [];
            console.log('No chat history data found or invalid format');
          }

          try {
            const currentId = await getData(CURRENT_SESSION_KEY);
            if (typeof currentId === 'string' && currentId.trim()) {
              this.currentSessionId = currentId.trim();
              console.log('[ChatHistory] Restored currentSessionId:', this.currentSessionId);
            } else {
              this.currentSessionId = null;
            }
          } catch (e) {
            console.warn('[ChatHistory] Failed to load currentSessionId:', e);
          }

          hasLoadedOnce = true;
        } catch (error) {
          console.error("Failed to load chat history:", error);
        } finally {
          loadSessionsInFlight = null;
        }
      })();

      return loadSessionsInFlight;
    },

    async saveSessions(immediate = false) {
      // Clear existing timer
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }

      // If immediate save requested, save now
      if (immediate) {
        return this._performSave();
      }

      // Otherwise, debounce the save
      return new Promise<void>((resolve) => {
        saveTimer = setTimeout(async () => {
          await this._performSave();
          resolve();
        }, SAVE_DEBOUNCE_MS);
      });
    },

    async _performSave() {
      try {
        // Check abort flag at the start (timestamp-based)
        if (abortSave && Date.now() >= abortSaveUntil) {
          clearAbortSave();
        }
        if (abortSave || Date.now() < abortSaveUntil) {
          console.log('[ChatHistory] Aborting save operation due to manual restore (flag:', abortSave, 'until:', new Date(abortSaveUntil).toISOString(), ')');
          return;
        }

        let sessionsToSave = this.sessions
          .slice(0, MAX_SESSIONS);

        // Cross-iframe safety: if the user cleared history in another iframe/tab,
        // we may still have a stale in-memory list here. Avoid re-saving stale
        // sessions and resurrecting cleared history.
        try {
          const clearedAtRaw = await getData(CLEAR_MARKER_KEY);
          const clearedAt = typeof clearedAtRaw === 'number' && Number.isFinite(clearedAtRaw)
            ? clearedAtRaw
            : 0;
          if (clearedAt > 0 && Array.isArray(sessionsToSave) && sessionsToSave.length > 0) {
            const before = sessionsToSave.length;
            sessionsToSave = sessionsToSave.filter((s: any) => {
              const ts = typeof s?.timestamp === 'number' ? s.timestamp : 0;
              return ts >= clearedAt;
            });
            const after = sessionsToSave.length;
            if (after !== before) {
              console.warn('[ChatHistory] Dropped stale sessions older than last clear marker', {
                clearedAt,
                dropped: before - after,
                remaining: after,
              });
            }
          }
        } catch (e) {
          console.warn('[ChatHistory] Clear-marker guard check failed; proceeding with save', e);
        }
        
        // Deep clone to remove all Pinia reactivity and make it serializable
        const plainSessions = JSON.parse(JSON.stringify(sessionsToSave));

        // If we are about to save an empty list, but storage already has sessions,
        // skip the write to avoid wiping history due to startup/race conditions.
        try {
          if (Array.isArray(plainSessions) && plainSessions.length === 0 && !allowEmptyWriteOnce) {
            const existing = await getData(STORAGE_KEY);
            if (Array.isArray(existing) && existing.length > 0) {
              console.warn('[ChatHistory] Skipping save of empty sessions to avoid wiping existing history', {
                existingCount: existing.length,
              });
              return;
            }
          }
        } catch (e) {
          console.warn('[ChatHistory] Empty-save guard check failed; proceeding with save', e);
        } finally {
          // One-shot allowance (used only by clearAllSessions)
          allowEmptyWriteOnce = false;
        }
        
        // Final check before writing to storage - abort if manual restore is in progress
        if (abortSave && Date.now() >= abortSaveUntil) {
          clearAbortSave();
        }
        if (abortSave || Date.now() < abortSaveUntil) {
          console.log('[ChatHistory] Aborting save at final checkpoint due to manual restore (flag:', abortSave, 'until:', new Date(abortSaveUntil).toISOString(), ')');
          return;
        }
        
        console.log('[ChatHistory] Saving', plainSessions.length, 'sessions');
        await setData(STORAGE_KEY, plainSessions);
        console.log('[ChatHistory] Save completed');
      } catch (error) {
        console.error("[ChatHistory] Failed to save:", error);
      }
    },

    async createSession(
      messages: any[],
      database?: string,
      connectionType?: string,
      memory?: { summary?: string; lastSql?: string; lastDatabase?: string }
    ): Promise<string> {
      // Option 1: do not auto-create an empty/placeholder session.
      // Only create a session when we have meaningful message content.
      try {
        const arr = Array.isArray(messages) ? messages : [];
        const hasMeaningful = arr.some((m: any) => {
          if (!m || typeof m !== 'object') return false;
          const role = String((m as any).role || '').toLowerCase();
          const content = (m as any).content;
          const text = typeof content === 'string' ? content.trim() : '';
          if (role === 'user' || role === 'assistant') {
            return text.length > 0;
          }
          return false;
        });
        if (!hasMeaningful) {
          console.warn('[ChatHistory] Skipping createSession: no meaningful messages');
          return '';
        }
      } catch (_) {}

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Serialize messages to plain objects (remove functions, circular refs, etc.)
      const serializedMessages = compactSessionMessages(JSON.parse(JSON.stringify(messages)));
      
      // Generate title from first user message or use default
      let title = "New Chat";
      const firstUserMessage = serializedMessages.find((m: any) => m.role === "user");
      if (firstUserMessage && firstUserMessage.content) {
        title = firstUserMessage.content.substring(0, 50);
        if (firstUserMessage.content.length > 50) {
          title += "...";
        }
      }
      
      const session: ChatSession = {
        id: sessionId,
        title,
        messages: serializedMessages,
        timestamp: Date.now(),
        database,
        connectionType,
        memorySummary: memory?.summary,
        memoryLastSql: memory?.lastSql,
        memoryLastDatabase: memory?.lastDatabase,
      };
      
      this.sessions.push(session);
      this.currentSessionId = sessionId;
      try {
        await setData(CURRENT_SESSION_KEY, sessionId);
      } catch (e) {
        console.warn('[ChatHistory] Failed to persist currentSessionId:', e);
      }
      await this.saveSessions();
      
      return sessionId;
    },

    async updateSession(
      sessionId: string,
      messages: any[],
      database?: string,
      connectionType?: string,
      memory?: { summary?: string; lastSql?: string; lastDatabase?: string }
    ) {
      const session = this.sessions.find((s) => s.id === sessionId);
      if (session) {
        console.log('[ChatHistory.updateSession] Updating session:', sessionId, 'with', messages.length, 'messages');
        // Serialize messages to plain objects
        session.messages = compactSessionMessages(JSON.parse(JSON.stringify(messages)));
        session.timestamp = Date.now();
        if (database) session.database = database;
        if (connectionType) session.connectionType = connectionType;
        if (memory?.summary) session.memorySummary = memory.summary;
        if (memory?.lastSql) session.memoryLastSql = memory.lastSql;
        if (memory?.lastDatabase) session.memoryLastDatabase = memory.lastDatabase;
        // Do NOT persist CURRENT_SESSION_KEY here.
        // Only explicit selection/restore should update which session is considered "current".
        // Persisting during background saves can race with user selection and cause jumps.
        await this.saveSessions();
      } else {
        console.warn('[ChatHistory.updateSession] Session not found:', sessionId);
      }
    },

    async deleteSession(sessionId: string) {
      this.sessions = this.sessions.filter((s) => s.id !== sessionId);
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
        try {
          await setData(CURRENT_SESSION_KEY, '');
        } catch (e) {
          console.warn('[ChatHistory] Failed to clear currentSessionId:', e);
        }
      }
      // Explicit user action: if this delete results in an empty list, allow a single
      // empty write so the delete persists (otherwise the empty-save guard will keep
      // the last session in storage).
      try {
        if (Array.isArray(this.sessions) && this.sessions.length === 0) {
          allowEmptyWriteOnce = true;
        }
      } catch (_) {}
      await this.saveSessions(true); // Immediate save for delete
    },

    async clearAllSessions() {
      this.sessions = [];
      this.currentSessionId = null;
      // Explicit user action: allow a single empty write to storage.
      allowEmptyWriteOnce = true;
      try {
        await setData(CLEAR_MARKER_KEY, Date.now());
      } catch (e) {
        console.warn('[ChatHistory] Failed to persist clear marker:', e);
      }
      await setData(STORAGE_KEY, []); // Direct save for clear
      try {
        await setData(CURRENT_SESSION_KEY, '');
      } catch (e) {
        console.warn('[ChatHistory] Failed to clear currentSessionId:', e);
      }
    },

    async setCurrentSession(sessionId: string | null) {
      console.log('[ChatHistory] setCurrentSession called:', {
        oldSessionId: this.currentSessionId,
        newSessionId: sessionId,
        hasManuallyRestoredSession: this.hasManuallyRestoredSession
      });
      console.trace('[ChatHistory] setCurrentSession stack trace');
      this.currentSessionId = sessionId;
      // Persist selection so the last session can be auto-restored after reload
      try {
        await setData(CURRENT_SESSION_KEY, sessionId || '');
      } catch (e) {
        console.warn('[ChatHistory] Failed to persist currentSessionId:', e);
      }
    },

    getSession(sessionId: string): ChatSession | undefined {
      return this.sessions.find((s) => s.id === sessionId);
    },
  },
});
