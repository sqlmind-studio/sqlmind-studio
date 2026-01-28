import { getAppInfo, log } from "@sqlmindstudio/plugin";
// FIXME move this to SQLMind Studio as injected script
window.addEventListener("error", (e) => {
  try {
    const err = (e as any)?.error || (e as any)?.message || e
    log.error(err)
  } catch (_err) {
    log.error('Unhandled error event')
  }
});
window.addEventListener("unhandledrejection", (e) => {
  try {
    const err = (e as any)?.reason || e
    log.error(err)
  } catch (_err) {
    log.error('Unhandled rejection')
  }
});
// -------------------

import "typeface-roboto";
import "./assets/styles/main.scss";
import "@material-symbols/font-400/outlined.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import pluralize from "pluralize";
import App from "@/App.vue";
// Register Inline AI bridge (window message listener) at startup
import "@/tools/index";
import {
  addNotificationListener,
  setDebugComms,
  openExternal,
} from "@sqlmindstudio/plugin";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";
import "@sqlmindstudio/plugin/dist/eventForwarder";
import { createAppEvent } from "@/plugins/appEvent";
import { VueKeyboardTrapDirectivePlugin } from '@pdanpdan/vue-keyboard-trap';
import { useUserContext } from "@/composables/useUserContext";
import { useChatStore } from "@/stores/chat";

setDebugComms(true);

hljs.registerLanguage("sql", sql);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);

// Apply theme from SQLMind Studio
getAppInfo()
  .then((info) => {
    document.querySelector("#injected-style")!.textContent =
      `:root { ${info.theme.cssString} }`;
  })
  .catch((e) => {
    if (e.message === "Unknown request: getAppInfo") {
      // This means we are running in an older version of SQLMind
      // Studio (< 5.4.0-beta.2).
      return;
    }

    throw new Error("cannot get app info", { cause: e });
  });

addNotificationListener("themeChanged", (args) => {
  document.querySelector("#injected-style")!.textContent =
    `:root { ${args.cssString} }`;
});

// Create and mount the Vue app
const app = createApp(App);
const pinia = createPinia();
const appEvent = createAppEvent();
app.use(pinia);
app.use(appEvent);
app.use(VueKeyboardTrapDirectivePlugin, {});

// In production builds, disable devtools/perf hooks from the plugin side.
try {
  if (import.meta.env.MODE === 'production') {
    (app.config as any).devtools = false;
    (app.config as any).performance = false;
  }
} catch (_) {}

app.config.globalProperties.$pluralize = pluralize;
app.config.globalProperties.$openExternal = openExternal;
app.mount("#app");

// Listen for user context updates from main app
const { setUserContext } = useUserContext();
let lastTenantId: string | null = null;
window.addEventListener('message', async (event: MessageEvent) => {
  const data = event.data;
  if (data && data.type === 'bks-ai/user-context') {
    console.log('[main.ts] Received user context from main app:', data);
    
    // Update the composable
    setUserContext({
      tenantId: data.tenantId,
      userId: data.userId,
      workspaceId: data.workspaceId,
      connectionId: data.connectionId,
    });
    
    // Also update localStorage for components that read from it directly
    // Remove items if undefined, otherwise set them
    if (data.tenantId) {
      localStorage.setItem('tenantId', data.tenantId);
    } else {
      localStorage.removeItem('tenantId');
    }
    
    if (data.userId) {
      localStorage.setItem('userId', data.userId);
    } else {
      localStorage.removeItem('userId');
    }
    
    if (data.userEmail) {
      localStorage.setItem('userEmail', data.userEmail);
    } else {
      localStorage.removeItem('userEmail');
    }
    
    if (data.workspaceId) {
      localStorage.setItem('workspaceId', data.workspaceId);
    } else {
      localStorage.removeItem('workspaceId');
    }
    
    console.log('[main.ts] Updated localStorage with user context');

    try {
      const nextTenantId = data.tenantId ? String(data.tenantId) : null;
      if (nextTenantId && nextTenantId !== lastTenantId) {
        lastTenantId = nextTenantId;
        const chat = useChatStore(pinia);
        await chat.syncBackendModels();
        await chat.ensureModelSelected();
      }
    } catch (e) {
      console.error('[main.ts] Failed to refresh backend models after user context change:', e);
    }
  }
});
