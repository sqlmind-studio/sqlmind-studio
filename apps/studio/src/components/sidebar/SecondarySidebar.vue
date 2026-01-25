<template>
  <div class="sidebar secondary-sidebar" :class="{ 'is-collapsed': !secondarySidebarOpen }">
    <div class="sidebar-content">
      <div class="sidebar-body" ref="body">
        <template v-for="tab in tabs">
          <template v-if="tab.id === 'json-viewer'">
            <json-viewer-sidebar
              v-show="secondaryActiveTabId === 'json-viewer'"
              :key="`${tab.id}-json-viewer`"
            />
          </template>
          <isolated-plugin-view
            v-else
            v-show="secondaryActiveTabId === tab.id"
            :visible="secondaryActiveTabId === tab.id"
            :key="`${tab.id}-plugin`"
            :plugin-id="tab.id === 'bks-ai-shell-history' ? 'bks-ai-shell' : tab.id"
            :keep-alive="tab.id !== 'bks-ai-shell-history'"
            :url="tab.url"
            :reload="reloaders[tab.id]"
          />
        </template>
      </div>

      <div class="sidebar-rail">
        <button class="close-btn btn btn-flat btn-fab" @click="$emit('close')">
          <i class="material-icons">close</i>
        </button>

        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="rail-tab"
          :class="{ active: secondaryActiveTabId === tab.id }"
          @click="handleTabClick($event, tab)"
          @click.right="handleTabRightClick($event, tab)"
          :title="tab.label"
        >
          <i class="material-icons rail-tab-icon">{{ getTabIcon(tab.id) }}</i>
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from "vue";
import { mapActions } from "vuex";
import JsonViewerSidebar from "./JsonViewerSidebar.vue";
import HistoryList from "./core/HistoryList.vue";
import { AppEvent } from "@/common/AppEvent";
import IsolatedPluginView from "@/components/plugins/IsolatedPluginView.vue";

interface SidebarTab {
  id: string;
  label: string;
  url?: string;
}

export default Vue.extend({
  name: "SecondarySidebar",
  components: { JsonViewerSidebar, IsolatedPluginView, HistoryList },
  data() {
    return {
      reloaders: {},
      _pendingAiRestore: null as null | {
        sessionId: string;
        deadline: number;
        timer: any;
      },
    };
  },
  computed: {
    secondaryActiveTabId(): string {
      return (this as any).$store.state.sidebar.secondaryActiveTabId
    },
    tabs(): SidebarTab[] {
      return (this as any).$store.state.sidebar.tabs
    },
    secondarySidebarOpen(): boolean {
      return (this as any).$store.state.sidebar.secondarySidebarOpen
    },
    rootBindings() {
      return [
        {
          event: AppEvent.selectSecondarySidebarTab,
          handler: this.setSecondaryActiveTabId,
        },
      ];
    },
  },
  methods: {
    ...mapActions("sidebar", ["setSecondaryActiveTabId", "setSecondarySidebarOpen"]),
    _onWindowMessage(event: MessageEvent) {
      try {
        const data: any = (event as any)?.data;
        if (!data || typeof data !== 'object') return;

        // ACK from AI Mode iframe that it received and started restoring a session.
        if (data.type === 'bks-ai/restore-chat-session-ack') {
          const sessionId = String(data.sessionId || '').trim();
          if (!sessionId) return;
          const pending = (this as any)._pendingAiRestore as any;
          if (pending && pending.sessionId === sessionId) {
            try { clearInterval(pending.timer); } catch (_) {}
            ;(this as any)._pendingAiRestore = null;
          }
          return;
        }

        // AI plugin history-only view requests restoring a chat session.
        if (data.type === 'bks-ai/ai-chat-history-restore') {
          const sessionId = String(data.sessionId || '').trim();
          if (!sessionId) return;

          // Open secondary sidebar and switch to the main AI Mode tab.
          try { this.setSecondarySidebarOpen(true); } catch (_) {}
          try { this.setSecondaryActiveTabId('bks-ai-shell'); } catch (_) {}

          // Forward the restore request to the AI Mode iframe.
          // We locate the iframe by src to avoid relying on internal plugin manager state.
          // NOTE: The AI Mode iframe may not be mounted yet; retry briefly until we get an ACK.
          try {
            const self: any = this as any;
            const prev = self._pendingAiRestore;
            if (prev && prev.timer) {
              try { clearInterval(prev.timer); } catch (_) {}
            }
            const deadline = Date.now() + 3000;
            const sendOnce = () => {
              try {
                const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
                const target = iframes.find((f) => {
                  const src = String((f as any).src || '');
                  return src.includes('plugin://bks-ai-shell/dist/index.html') && !src.includes('view=history');
                });
                const win: any = target?.contentWindow as any;
                if (win && typeof win.postMessage === 'function') {
                  win.postMessage({ type: 'bks-ai/restore-chat-session', sessionId }, '*');
                }
              } catch (_) {}
            };

            sendOnce();
            const timer = setInterval(() => {
              try {
                if (!self._pendingAiRestore) {
                  clearInterval(timer);
                  return;
                }
                if (Date.now() > deadline) {
                  clearInterval(timer);
                  self._pendingAiRestore = null;
                  return;
                }
                sendOnce();
              } catch {
                try { clearInterval(timer); } catch {}
                try { self._pendingAiRestore = null; } catch {}
              }
            }, 150);

            self._pendingAiRestore = { sessionId, deadline, timer };
          } catch (_) {}
        }
      } catch (_) {}
    },
    getTabIcon(tabId: string) {
      switch (tabId) {
        case 'bks-ai-shell':
          return 'smart_toy'
        case 'bks-ai-shell-history':
          return 'history'
        case 'json-viewer':
          return 'data_object'
        default:
          return 'extension'
      }
    },
    handleTabClick(_event, tab: SidebarTab) {
      if (!(this as any).secondarySidebarOpen) {
        this.setSecondarySidebarOpen(true);
      }
      this.setSecondaryActiveTabId(tab.id);
    },
    handleTabRightClick(event, tab: SidebarTab) {
      if (!window.platformInfo.isDevelopment) {
        return
      }

      this.$bks.openMenu({
        event,
        options: [
          {
            name: "[DEV] Reload View",
            handler: () => {
              this.$set(this.reloaders, tab.id, Date.now());
            },
          },
        ],
      });
    },
  },
  mounted() {
    this.registerHandlers(this.rootBindings);

    window.addEventListener('message', this._onWindowMessage as any);
  },
  beforeDestroy() {
    this.unregisterHandlers(this.rootBindings);

    try {
      const pending: any = (this as any)._pendingAiRestore;
      if (pending && pending.timer) {
        clearInterval(pending.timer);
      }
    } catch (_) {}

    window.removeEventListener('message', this._onWindowMessage as any);
  },
});
</script>

<style lang="scss" scoped>
@import '@/assets/styles/app/_variables.scss';

.sidebar.secondary-sidebar {
  min-width: 0;
  overflow: hidden;
}

.sidebar-content {
  display: flex;
  height: 100%;
  width: 100%;
  min-width: 0;
}

.sidebar-rail {
  width: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  background: rgba(255, 255, 255, 0.03);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.close-btn {
  margin: 6px 0 10px;
}

.rail-tab {
  width: 100%;
  height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.85;
  position: relative;
}

.rail-tab:before {
  content: '';
  position: absolute;
  right: 0;
  width: 2px;
  height: 20px;
  border-radius: 3px;
  background: rgba($theme-base, 0.2);
  opacity: 0;
  transition: opacity 0.15s ease-in-out;
}

.rail-tab:hover {
  opacity: 1;
}

.rail-tab:hover:before {
  opacity: 1;
}

.rail-tab.active {
  opacity: 1;
  background: transparent;
}

.rail-tab.active:before {
  background: $theme-base;
  opacity: 1;
}

.rail-tab-icon {
  font-size: 24px;
  width: 34px;
  height: 34px;
  border-radius: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.rail-tab:hover .rail-tab-icon {
  background: rgba($theme-base, 0.08);
}

.rail-tab.active .rail-tab-icon {
  background: rgba($theme-base, 0.08);
}

.sidebar-body {
  position: relative;
  height: 100%;
  width: 100%;
  
  > * {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}
</style>
