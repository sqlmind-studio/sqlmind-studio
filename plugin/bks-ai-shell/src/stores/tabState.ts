/**
 * Data that is specific to a tab instance. Anything in here are recovarable.
 * Example: If you close the AI Mode Tab, and then re-open it with ctrl+shift+t
 * the messages and all data in here are restored. Thanks to getViewState!
 *
 * Usage:
 *
 * 1. Call `sync()` if it hasn't been called yet.
 * 2. Read the state by accessing it normally.
 * 3. Use `setTabState()` to update the state.
 *
 **/

import { getViewState, setTabTitle, setViewState } from "@sqlmindstudio/plugin";
import { Message } from "ai";
import { defineStore } from "pinia";
import { StoredMessage } from "@langchain/core/messages";
import { mapLangChainStoredMessagesToAISdkMessages } from "@/utils/langchainToAISdk";
import _ from "lodash";

let messagesRestoreLockUntil = 0;

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

type Old_TabState = {
  messages: StoredMessage[];
  conversationTitle: string;
}

type TabState = {
  version: "2"
  messages: Message[];
  conversationTitle: string;
};

function isOldTabState(viewState: any): viewState is Old_TabState {
  return viewState && !("version" in viewState);
}

export const useTabState = defineStore("tabState", {
  state: (): TabState => ({
    version: "2",
    messages: [],
    conversationTitle: "",
  }),

  actions: {
    async sync() {
      const state = await getViewState<TabState>();
      if (state) {
        // Restore lock: during/after a restore we may receive a late empty tab-state payload.
        // Never let it overwrite non-empty in-memory messages.
        try {
          const incomingLen = Array.isArray((state as any).messages) ? (state as any).messages.length : 0;
          const currentLen = Array.isArray((this as any).messages) ? (this as any).messages.length : 0;
          if (Date.now() < messagesRestoreLockUntil && incomingLen === 0 && currentLen > 0) {
            this.conversationTitle = (state as any).conversationTitle || this.conversationTitle;
            return;
          }
        } catch (_) {}
        try {
          const now = Date.now();
          const incoming = (state as any).messages;
          const current = (this as any).messages;
          const incomingLen = Array.isArray(incoming) ? incoming.length : 0;
          const currentLen = Array.isArray(current) ? current.length : 0;
          if (now < messagesRestoreLockUntil && incomingLen > 0 && currentLen > 0) {
            const incomingSig = getMessagesSignature(incoming);
            const currentSig = getMessagesSignature(current);
            if (incomingSig !== currentSig) {
              this.conversationTitle = (state as any).conversationTitle || this.conversationTitle;
              return;
            }
          }
        } catch (_) {}
        // Guard against startup/restore races:
        // if the persisted view state has no messages but we already have messages in memory,
        // do not overwrite the in-memory messages with [].
        // This prevents restored chat sessions from being wiped by late tab-state rehydration.
        try {
          const incomingLen = Array.isArray((state as any).messages) ? (state as any).messages.length : 0;
          const currentLen = Array.isArray((this as any).messages) ? (this as any).messages.length : 0;
          if (incomingLen === 0 && currentLen > 0) {
            this.conversationTitle = (state as any).conversationTitle || this.conversationTitle;
            return;
          }
        } catch (_) {}
        if (isOldTabState(state)) {
          this.messages = mapLangChainStoredMessagesToAISdkMessages(state.messages);
        } else {
          this.messages = state.messages;
        }
        this.conversationTitle = state.conversationTitle;
      }
    },
    async setTabState(key: keyof TabState, value: TabState[keyof TabState]) {
      this.$patch({ [key]: value });
      // Any time we set messages to a non-empty array, protect them from being overwritten by
      // a late empty view-state sync for a short window.
      try {
        if (key === 'messages') {
          const len = Array.isArray(value as any) ? (value as any).length : 0;
          if (len > 0) messagesRestoreLockUntil = Date.now() + 30_000;
        }
      } catch (_) {}
      setViewState<TabState>({
        version: "2",
        messages: _.cloneDeep(this.messages),
        conversationTitle: this.conversationTitle,
      });
    },
    lockMessagesRestore(ms = 30_000) {
      messagesRestoreLockUntil = Date.now() + Math.max(0, ms);
    },
    async setTabTitle(title: string) {
      this.setTabState("conversationTitle", title);
      await setTabTitle(title);
    },
  },
});
