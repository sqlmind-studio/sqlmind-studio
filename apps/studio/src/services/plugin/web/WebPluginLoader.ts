import {
  Manifest,
  OnViewRequestListener,
  WebPluginContext,
  WebPluginViewInstance,
  ExtendedPluginRequestData,
} from "../types";
import {
  PluginNotificationData,
  PluginResponseData,
  GetAppInfoResponse,
  GetViewContextResponse,
  GetConnectionInfoResponse,
  GetTablesResponse,
} from "@sqlmindstudio/plugin";
import PluginStoreService from "./PluginStoreService";
import rawLog from "@bksLogger";
import _ from "lodash";
import type { UtilityConnection } from "@/lib/utility/UtilityConnection";
import { PluginMenuManager } from "./PluginMenuManager";
import { isManifestV0, mapViewsAndMenuFromV0ToV1 } from "../utils";

function joinUrlPath(a: string, b: string): string {
  return `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`;
}

const windowEventMap = new Map();
windowEventMap.set("MouseEvent", MouseEvent);
windowEventMap.set("PointerEvent", PointerEvent);
windowEventMap.set("KeyboardEvent", KeyboardEvent);
windowEventMap.set("Event", Event);

export default class WebPluginLoader {
  private viewInstances: WebPluginViewInstance[] = [];
  private onReadyListeners: Function[] = [];
  private onDisposeListeners: Function[] = [];
  private listeners: OnViewRequestListener[] = [];

  /** @deprecated use `context.log` instead */
  private log: ReturnType<typeof rawLog.scope>;
  /** @deprecated use `context.manifest` instead */
  public readonly manifest: Manifest;
  /** @deprecated use `context.store` instead */
  private pluginStore: PluginStoreService;
  /** @deprecated use `context.utility` instead */
  private utilityConnection: UtilityConnection;
  private listening = false;

  menu: PluginMenuManager;

  constructor(public readonly context: WebPluginContext) {
    this.manifest = context.manifest;
    this.pluginStore = context.store;
    this.utilityConnection = context.utility;
    this.log = context.log;

    this.menu = new PluginMenuManager(context);

    this.handleMessage = this.handleMessage.bind(this);
  }

  /** Starts the plugin */
  async load(manifest?: Manifest) {
    // FIXME dont load manifest this way. probably make a new method `setManifest`
    if (manifest) {
      // @ts-ignore
      this.manifest = manifest;
    }

    this.log.info("Loading plugin", this.manifest);

    // Add event listener for messages from iframe
    window.addEventListener("message", this.handleMessage);

    // Backward compatibility: Early version of AI Shell.
    const { views, menu } = isManifestV0(this.context.manifest)
      ? mapViewsAndMenuFromV0ToV1(this.context.manifest)
      : this.context.manifest.capabilities;

    this.pluginStore.addTabTypeConfigs(this.context.manifest, views);
    this.menu.register(views, menu);

    if (!this.listening) {
      this.registerEvents();
      this.onReadyListeners.forEach((fn) => fn());
    }
  }

  private handleMessage(event: MessageEvent) {
    const view = this.viewInstances.find(
      ({ iframe }) => iframe.contentWindow === event.source
    );
    const source = view?.iframe;

    // Check if the message is from our iframe
    if (source) {
      if (event.data.id) {
        this.handleViewRequest(
          {
            id: event.data.id,
            name: event.data.name,
            args: event.data.args,
          },
          source
        );
      } else {
        this.handleViewNotification(source, {
          name: event.data.name,
          args: event.data.args,
        });
      }
    }
  }

  private async handleViewRequest(
    request: ExtendedPluginRequestData,
    source: HTMLIFrameElement
  ) {
    const afterCallbacks: ((response: PluginResponseData) => void)[] = [];
    const modifyResultCallbacks: ((result: PluginResponseData['result']) => PluginResponseData['result'] | Promise<PluginResponseData['result']>)[] = [];

    for (const listener of this.listeners) {
      await listener({
        source,
        request,
        after: (callback) => {
          afterCallbacks.push(callback);
        },
        modifyResult: (callback) => {
          modifyResultCallbacks.push(callback);
        },
      });
    }

    const response: PluginResponseData = {
      id: request.id,
      result: undefined,
    };

    try {
      this.checkPermission(request);

      switch (request.name) {
        // ========= READ ACTIONS ===========
        case "getTables":
          response.result = this.pluginStore.getTables() as GetTablesResponse['result'];
          break;
        case "getColumns":
          response.result = await this.pluginStore.getColumns(
            (request as any).args.table,
            (request as any).args.schema
          );
          break;
        case "getTableKeys":
          response.result = await this.utilityConnection.send(
              'conn/getTableKeys',
            { table: (request as any).args.table, schema: (request as any).args.schema }
          );
          break;
        case "getAppInfo":
          response.result = {
            theme: this.pluginStore.getTheme(),
            version: this.context.appVersion,
          } as GetAppInfoResponse['result'];
          break;
        case "getViewContext":
          const view = this.viewInstances.find((ins) => ins.iframe === source);
          if (!view) {
            throw new Error("View context not found.");
          }
          response.result = view.context as GetViewContextResponse['result'];
          break;
        case "getConnectionInfo":
          response.result = this.pluginStore.getConnectionInfo() as GetConnectionInfoResponse['result'];
          break;
        case "getData":
        case "getEncryptedData": {
          const value = await this.utilityConnection.send(
            request.name === "getEncryptedData"
              ? "plugin/getEncryptedData"
              : "plugin/getData",
            { manifest: this.manifest, key: (request as any).args.key }
          );
          response.result = value;
          break;
        }
        case "clipboard.readText":
          response.result = window.main.readTextFromClipboard();
          break;
        case "checkForUpdate":
          response.result = await this.context.utility.send("plugin/checkForUpdates", {
            id: this.context.manifest.id,
          });
          break;
        case "getQueryText":
          try {
            response.result = this.pluginStore.getQueryText();
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "getQueryTextWithCursor":
          try {
            response.result = this.pluginStore.getQueryTextWithCursor();
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "getQueryResults":
          try {
            response.result = this.pluginStore.getQueryResults();
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "getTabList":
          try {
            response.result = this.pluginStore.getTabList();
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "getExecutionPlan":
          try {
            response.result = this.pluginStore.getExecutionPlan();
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "getStatisticsData":
          try {
            response.result = this.pluginStore.getStatisticsData();
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "getTabExecutionData":
          try {
            response.result = this.pluginStore.getTabExecutionData((request as any).args.tabId);
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "getMessagesData":
          try {
            response.result = this.pluginStore.getMessagesData();
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;

        // ======== WRITE ACTIONS ===========
        case "runQuery":
          response.result = await this.pluginStore.runQuery((request as any).args.query);
          break;
        case "executeQueryInTab":
          response.result = await this.pluginStore.executeQueryInTab();
          break;
        case "insertText":
          try {
            this.pluginStore.insertText((request as any).args.text);
            response.result = { success: true };
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "insertTextAtCursor":
          try {
            this.pluginStore.insertTextAtCursor((request as any).args.text);
            response.result = { success: true };
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "switchDatabase":
          try {
            await this.pluginStore.switchDatabase((request as any).args.databaseName);
            response.result = { success: true };
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "switchToTab":
          try {
            await this.pluginStore.switchToTab((request as any).args.tabId);
            response.result = { success: true };
          } catch (e) {
            response.error = e instanceof Error ? e : new Error(String(e));
          }
          break;
        case "setData":
        case "setEncryptedData": {
          await this.utilityConnection.send(
            request.name === "setEncryptedData"
              ? "plugin/setEncryptedData"
              : "plugin/setData",
            { manifest: this.manifest, key: (request as any).args.key, value: (request as any).args.value }
          )
          break;
        }
        case "clipboard.writeText":
          window.main.writeTextToClipboard((request as any).args.text);
          break;

        // ======== UI ACTIONS ===========
        case "expandTableResult":
          // Directly handled by the view components
          break;
        case "setTabTitle":
          // Directly handled by the view components
          break;
        case "getViewState":
          // Directly handled by the view components - If the plugin is a tab
          // plugin, each tab has its own state. To easily access/modify the
          // state while isolating it, we let each Tab component to intercept
          // the response by using `modifyResult`. And then the state can be
          // accessed via `this.tab.context.state`.
          break;
        case "setViewState":
          // Directly handled by the view components
          break;
        case "openExternal":
          // FIXME maybe we should ask user permission first before opening?
          window.main.openExternally((request as any).args.link);
          break;
        case "openTab":
          this.pluginStore.openTab((request as any).args);
          break;

        default:
          throw new Error(`Unknown request: ${(request as any).name}`);
      }

      for (const callback of modifyResultCallbacks) {
        response.result = await callback(response.result);
      }
    } catch (e) {
      response.error = e instanceof Error ? e : new Error(String(e));
    }

    this.postMessage(source, response);

    afterCallbacks.forEach((callback) => {
      callback(response);
    });
  }

  private async handleViewNotification(
    source: HTMLIFrameElement,
    notification: PluginNotificationData
  ) {
    // Some plugin views may post ad-hoc window messages directly to the host
    // (e.g. `{ type: 'bks-ai/...', ... }`) which are not part of the plugin
    // notification protocol (`{ name, args }`). These should not be treated as
    // plugin notifications, otherwise we spam `Unknown notification: undefined`.
    try {
      const n: any = notification as any;
      // Hard guard: if there is no valid notification name, ignore.
      // This prevents `Unknown notification: undefined` spam.
      if (!n?.name || typeof n.name !== 'string') {
        // If it is a typed ad-hoc message, ignore silently.
        if (n?.type && typeof n.type === 'string') {
          return;
        }
        return;
      }
      if ((!n?.name || typeof n.name !== 'string') && n?.type && typeof n.type === 'string') {
        return;
      }
    } catch (_) {}

    switch (notification.name) {
      case "windowEvent": {
        const windowEventClass = windowEventMap.get(
          notification.args.eventClass
        );

        if (!windowEventClass || typeof windowEventClass !== "function") {
          this.log.warn(
            `Invalid or unknown event class: ${notification.args.eventClass}`
          );
          return;
        }

        document.dispatchEvent(
          new windowEventClass(
            notification.args.eventType,
            notification.args.eventInitOptions
          )
        );

        break;
      }
      case "pluginError": {
        this.log.error(`Received plugin error: ${notification.args.message}`, notification.args);
        // Try to show notification using the global Vue instance
        try {
          this.log.info('Checking for window.$app...', {
            hasWindow: typeof window !== 'undefined',
            hasApp: !!(window as any).$app,
            hasNoty: !!((window as any).$app && (window as any).$app.$noty),
            hasError: !!((window as any).$app && (window as any).$app.$noty && (window as any).$app.$noty.error)
          });
          
          // @ts-ignore - accessing global Vue app instance
          if (window.$app && window.$app.$noty && window.$app.$noty.error) {
            window.$app.$noty.error(notification.args.message || 'An error occurred');
            this.log.info('Successfully showed plugin error notification to user');
          } else {
            this.log.warn('$noty not available, emitting custom event instead');
            // Fallback: Emit a custom event
            window.dispatchEvent(new CustomEvent('plugin-error-notification', {
              detail: {
                name: notification.args.name || 'Plugin Error',
                message: notification.args.message || 'An error occurred',
              }
            }));
            this.log.info('Dispatched plugin-error-notification event');
          }
        } catch (err) {
          this.log.error('Failed to show plugin error notification:', err);
        }
        break;
      }
      case "broadcast": {
        this.viewInstances.forEach(({ iframe }) => {
          if (iframe === source) {
            return;
          }
          this.postMessage(iframe, {
            name: "broadcast",
            args: {
              message: notification.args.message,
            },
          });
        });
        break;
      }

      default:
        this.log.warn(`Unknown notification: ${notification.name}`);
    }
  }

  registerViewInstance(options: WebPluginViewInstance) {
    this.viewInstances.push(options);
  }

  unregisterViewInstance(iframe: HTMLIFrameElement) {
    this.viewInstances = this.viewInstances.filter((ins) => ins.iframe !== iframe);
  }

  postMessage(iframe: HTMLIFrameElement, data: PluginNotificationData | PluginResponseData) {
    try {
      const win = iframe?.contentWindow as any;
      if (!win || typeof win.postMessage !== 'function') {
        this.log.warn('postMessage skipped: iframe contentWindow not available');
        return;
      }
      win.postMessage(data, "*");
    } catch (e) {
      this.log.warn('postMessage failed', e);
    }
  }

  broadcast(data: PluginNotificationData) {
    this.viewInstances.forEach(({ iframe }) => {
      this.postMessage(iframe, data);
    });
  }

  buildEntryUrl(entry: string) {
    return `plugin://${this.manifest.id}/${this.getEntry(entry)}`;
  }

  getEntry(entry: string) {
    if (!this.manifest.pluginEntryDir) {
      return entry;
    }
    return joinUrlPath(this.manifest.pluginEntryDir, entry);
  }

  async unload() {
    window.removeEventListener("message", this.handleMessage);

    const { views, menu } = isManifestV0(this.context.manifest)
      ? mapViewsAndMenuFromV0ToV1(this.context.manifest)
      : this.context.manifest.capabilities;

    this.menu.unregister(views, menu);
    this.pluginStore.removeTabTypeConfigs(this.context.manifest, views);
  }

  addListener(listener: OnViewRequestListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = _.without(this.listeners, listener);
    };
  }

  checkPermission(_data: ExtendedPluginRequestData) {
    // do nothing on purpose
    // if not permitted, throw error
  }

  /** Warn: please dispose only when the plugin is not used anymore, like
   * after uninstalling. */
  dispose() {
    this.unregisterEvents();
    this.onDisposeListeners.forEach((fn) => fn());
  }

  private registerEvents() {
    // Add event listener for messages from iframe
    window.addEventListener("message", this.handleMessage);
    this.listening = true;
  }

  private unregisterEvents() {
    window.removeEventListener("message", this.handleMessage);
    this.listening = false;
  }

  /** Called when the plugin is ready to be used. If the plugin uses iframes,
   * this should be called before mounting the iframes. */
  onReady(fn: Function) {
    if (this.listening) {
      fn();
    }
    this.onReadyListeners.push(fn);
    return () => {
      this.onReadyListeners = _.without(this.onReadyListeners, fn);
    }
  }

  /** Called when the plugin is disposed. */
  onDispose(fn: Function) {
    this.onDisposeListeners.push(fn);
    return () => {
      this.onDisposeListeners = _.without(this.onDisposeListeners, fn);
    }
  }
}
