import type { Store } from "vuex";
import { State as RootState } from "@/store";
import Vue from 'vue';
import type {
  PluginTabContext,
  TabTypeConfig,
  TransportOpenTab,
  TransportOpenTabInit,
} from "@/common/transport/TransportOpenTab";
import {
  GetColumnsResponse,
  LoadViewParams,
  RunQueryResponse,
  TabResponse,
  ThemeChangedNotification,
} from "@sqlmindstudio/plugin";
import { findTable, PluginTabType } from "@/common/transport/TransportOpenTab";
import { AppEvent } from "@/common/AppEvent";
import { NgQueryResult } from "@/lib/db/models";
import _ from "lodash";
import { SidebarTab } from "@/store/modules/SidebarModule";
import {
  Manifest,
  PluginMenuItem,
  PluginView,
  TabType,
} from "../types";
import { ExternalMenuItem } from "@/types";
import { ContextOption } from "@/plugins/SQLMindPlugin";
import { isManifestV0, mapViewsAndMenuFromV0ToV1 } from "../utils";

/**
 * An interface that bridges plugin system and Vuex. It also stores some states
 * for context menu because they don't exist in Vuex.
 */
export default class PluginStoreService {
  constructor(
    private store: Store<RootState>,
    public appEventBus: {
      emit: (event: AppEvent, ...args: any) => void;
      on: (event: AppEvent, listener: (...args: any) => void) => void;
      off: (event: AppEvent, listener: (...args: any) => void) => void;
    }
  ) {}

  getTheme(): ThemeChangedNotification["args"] {
    const cssProps = [
      "--theme-bg",
      "--theme-base",
      "--theme-primary",
      "--theme-secondary",

      "--text-dark",
      "--text",
      "--text-light",
      "--text-lighter",
      "--text-hint",
      "--text-disabled",

      "--brand-info",
      "--brand-success",
      "--brand-warning",
      "--brand-danger",
      "--brand-default",
      "--brand-purple",
      "--brand-pink",

      "--border-color",
      "--link-color",
      "--placeholder",
      "--selection",
      "--input-highlight",

      "--query-editor-bg",

      "--scrollbar-track",
      "--scrollbar-thumb",

      // BksTextEditor
      "--bks-text-editor-activeline-bg-color",
      "--bks-text-editor-activeline-gutter-bg-color",
      "--bks-text-editor-atom-fg-color",
      "--bks-text-editor-bg-color",
      "--bks-text-editor-bracket-fg-color",
      "--bks-text-editor-builtin-fg-color",
      "--bks-text-editor-comment-attribute-fg-color",
      "--bks-text-editor-comment-def-fg-color",
      "--bks-text-editor-comment-fg-color",
      "--bks-text-editor-comment-tag-fg-color",
      "--bks-text-editor-comment-type-fg-color",
      "--bks-text-editor-cursor-bg-color",
      "--bks-text-editor-fatcursor-bg-color",
      "--bks-text-editor-def-fg-color",
      "--bks-text-editor-error-bg-color",
      "--bks-text-editor-error-fg-color",
      "--bks-text-editor-fg-color",
      "--bks-text-editor-focused-outline-color",
      "--bks-text-editor-foldgutter-fg-color",
      "--bks-text-editor-foldgutter-fg-color-hover",
      "--bks-text-editor-gutter-bg-color",
      "--bks-text-editor-gutter-border-color",
      "--bks-text-editor-guttermarker-fg-color",
      "--bks-text-editor-guttermarker-subtle-fg-color",
      "--bks-text-editor-header-fg-color",
      "--bks-text-editor-highlight-bg-color",
      "--bks-text-editor-keyword-fg-color",
      "--bks-text-editor-linenumber-fg-color",
      "--bks-text-editor-link-fg-color",
      "--bks-text-editor-matchingbracket-fg-color",
      "--bks-text-editor-matchingbracket-bg-color",
      "--bks-text-editor-number-fg-color",
      "--bks-text-editor-property-fg-color",
      "--bks-text-editor-selected-bg-color",
      "--bks-text-editor-matchingselection-bg-color",
      "--bks-text-editor-string-fg-color",
      "--bks-text-editor-tag-fg-color",
      "--bks-text-editor-variable-2-fg-color",
      "--bks-text-editor-variable-3-fg-color",
      "--bks-text-editor-variable-fg-color",
      "--bks-text-editor-namespace-fg-color",
      "--bks-text-editor-type-fg-color",
      "--bks-text-editor-class-fg-color",
      "--bks-text-editor-enum-fg-color",
      "--bks-text-editor-interface-fg-color",
      "--bks-text-editor-struct-fg-color",
      "--bks-text-editor-typeParameter-fg-color",
      "--bks-text-editor-parameter-fg-color",
      "--bks-text-editor-enumMember-fg-color",
      "--bks-text-editor-decorator-fg-color",
      "--bks-text-editor-event-fg-color",
      "--bks-text-editor-function-fg-color",
      "--bks-text-editor-method-fg-color",
      "--bks-text-editor-macro-fg-color",
      "--bks-text-editor-label-fg-color",
      "--bks-text-editor-regexp-fg-color",
      "--bks-text-editor-operator-fg-color",
      "--bks-text-editor-definition-fg-color",
      "--bks-text-editor-variableName-fg-color",
      "--bks-text-editor-bool-fg-color",
      "--bks-text-editor-null-fg-color",
      "--bks-text-editor-className-fg-color",
      "--bks-text-editor-propertyName-fg-color",
      "--bks-text-editor-punctuation-fg-color",
      "--bks-text-editor-meta-fg-color",
      "--bks-text-editor-typeName-fg-color",
      "--bks-text-editor-labelName-fg-color",
      "--bks-text-editor-attributeName-fg-color",
      "--bks-text-editor-attributeValue-fg-color",
      "--bks-text-editor-heading-fg-color",
      "--bks-text-editor-url-fg-color",
      "--bks-text-editor-processingInstruction-fg-color",
      "--bks-text-editor-special-string-fg-color",
      "--bks-text-editor-name-fg-color",
      "--bks-text-editor-deleted-fg-color",
      "--bks-text-editor-character-fg-color",
      "--bks-text-editor-color-fg-color",
      "--bks-text-editor-standard-fg-color",
      "--bks-text-editor-separator-fg-color",
      "--bks-text-editor-changed-fg-color",
      "--bks-text-editor-annotation-fg-color",
      "--bks-text-editor-modifier-fg-color",
      "--bks-text-editor-self-fg-color",
      "--bks-text-editor-operatorKeyword-fg-color",
      "--bks-text-editor-escape-fg-color",
      "--bks-text-editor-strong-fg-color",
      "--bks-text-editor-emphasis-fg-color",
      "--bks-text-editor-strikethrough-fg-color",
      "--bks-text-editor-sql-alias-fg-color",
      "--bks-text-editor-sql-field-fg-color",

      // BksTextEditor context menu
      "--bks-text-editor-context-menu-bg-color",
      "--bks-text-editor-context-menu-fg-color",
      "--bks-text-editor-context-menu-item-bg-color-active",
      "--bks-text-editor-context-menu-item-fg-color-active",
      "--bks-text-editor-context-menu-item-bg-color-hover",
    ];

    const styles = getComputedStyle(document.body);
    /** Key = css property, value = css value */
    const palette: Record<string, string> = {};

    for (const name of cssProps) {
      const camelKey = _.camelCase(name);
      palette[camelKey] = styles.getPropertyValue(name).trim();
    }

    const cssString = cssProps
      .map((cssProp) => `${cssProp}: ${palette[_.camelCase(cssProp)]};`)
      .join("");

    return {
      type: this.store.getters["settings/themeType"],
      palette,
      cssString,
    };
  }

  addSidebarTab(tab: SidebarTab): void {
    this.store.commit("sidebar/addSecondarySidebar", tab);
  }

  removeSidebarTab(id: string): void {
    this.store.commit("sidebar/removeSecondarySidebar", id);
  }

  /** @deprecated use `addTabTypeConfigs` or `setTabDropdownItem` instead */
  addTabTypeConfigV0(params: {
    pluginId: string;
    pluginTabTypeId: string;
    name: string;
    kind: TabType;
    icon?: string;
  }): void {
    const config: TabTypeConfig.PluginConfig = {
      type: `plugin-${params.kind}` as const,
      name: params.name,
      pluginId: params.pluginId,
      pluginTabTypeId: params.pluginTabTypeId,
      menuItem: { label: `Add ${params.name}`, command: 'openView' },
      icon: params.icon,
    };
    this.store.commit("tabs/addTabTypeConfig", config);
  }

  /** @deprecated use `removeTabTypeConfigs` or `unsetTabDropdownItem` instead */
  removeTabTypeConfigV0(
    identifier: TabTypeConfig.PluginRef
  ): void {
    this.store.commit("tabs/removeTabTypeConfig", identifier);
  }

  /** Register plugin views as tabs */
  addTabTypeConfigs(manifest: Manifest, views: PluginView[]): void {
    views.forEach((view) => {
      const ref: TabTypeConfig.PluginRef = {
        pluginId: manifest.id,
        pluginTabTypeId: view.id,
      };
      const type: PluginTabType = view.type.includes("shell")
        ? "plugin-shell"
        : "plugin-base";
      const config: TabTypeConfig.PluginConfig = {
        ...ref,
        type,
        name: manifest.name,
        icon: manifest.icon,
      };
      this.store.commit("tabs/addTabTypeConfig", config);
    });
  }

  removeTabTypeConfigs(manifest: Manifest, views: PluginView[]): void {
    views.forEach((view) => {
      const ref: TabTypeConfig.PluginRef = {
        pluginId: manifest.id,
        pluginTabTypeId: view.id,
      };
      this.store.commit("tabs/removeTabTypeConfig", ref);
    })
  }

  setTabDropdownItem(options: {
    menuItem: PluginMenuItem;
    manifest: Manifest;
  }): void {
    const ref: TabTypeConfig.PluginRef = {
      pluginId: options.manifest.id,
      pluginTabTypeId: options.menuItem.view,
    };
    const menuItem: TabTypeConfig.PluginConfig['menuItem'] = {
      label: options.menuItem.name,
      command: options.menuItem.command,
    }
    this.store.commit("tabs/setMenuItem", { ...ref, menuItem });
  }

  unsetTabDropdownItem(options: {
    menuItem: PluginMenuItem;
    manifest: Manifest;
  }): void {
    const ref: TabTypeConfig.PluginRef = {
      pluginId: options.manifest.id,
      pluginTabTypeId: options.menuItem.view,
    };
    this.store.commit("tabs/unsetMenuItem", ref);
  }

  getTables() {
    return this.store.state.tables.map((t) => ({
      name: t.name,
      schema: t.schema,
    }));
  }

  private findTable(name: string, schema?: string) {
    return this.store.state.tables.find((t) => {
      if (!schema && this.store.state.defaultSchema) {
        schema = this.store.state.defaultSchema;
      }
      if (schema) {
        // Case-insensitive comparison for schema and table name
        return t.name.toLowerCase() === name.toLowerCase() && 
               t.schema?.toLowerCase() === schema.toLowerCase();
      }
      return t.name.toLowerCase() === name.toLowerCase();
    });
  }

  /** @throws {Error} Not found */
  private findTableOrThrow(name: string, schema?: string) {
    const table = this.findTable(name, schema);
    if (!table) {
      throw new Error(schema ? `Table not found (table=${name}, schema=${schema})` : `Table not found (table=${name})`);
    }
    return table;
  }

  async getColumns(
    tableName: string,
    schema?: string
  ): Promise<GetColumnsResponse['result']> {
    const table = this.findTableOrThrow(tableName, schema);

    if (!table.columns || table.columns.length === 0) {
      await this.store.dispatch("updateTableColumns", table);
    }

    return this.findTable(tableName, schema).columns.map((c) => ({
      name: c.columnName,
      type: c.dataType,
    }));
  }

  getConnectionInfo() {
    return {
      id: this.store.state.usedConfig.id,
      workspaceId: this.store.state.workspaceId,
      connectionName: this.store.state.usedConfig.name || "",
      connectionType: this.store.state.connectionType,
      databaseType: this.store.state.connectionType,
      databaseName: this.store.state.database,
      defaultSchema: this.store.state.defaultSchema,
      readOnlyMode: this.store.state.usedConfig.readOnlyMode,
    };
  }

  serializeTab(tab: TransportOpenTab): TabResponse {
    if (tab.tabType === "query") {
      return {
        type: "query",
        id: tab.id,
        title: tab.title,
        data: {
          query: tab.unsavedQueryText,
          result: null,
        },
      };
    } else if (tab.tabType === "table") {
      return {
        type: "table",
        id: tab.id,
        title: tab.title,
        data: {
          table: findTable(tab, this.store.state.tables),
          filters: [], // FIXME
          result: null, // FIXME
        },
      };
    }

    return {
      type: tab.tabType,
      id: tab.id,
      title: tab.title,
    };
  }

  private serializeQueryResponse(result: NgQueryResult) {
    return {
      fields: result.fields.map((field) => ({
        id: field.id,
        name: field.name,
        dataType: field.dataType,
      })),
      rows: result.rows,
      rowCount: result.rowCount,
      affectedRows: result.affectedRows,
    };
  }

  /* Run query in the background */
  async runQuery(query: string): Promise<RunQueryResponse['result']> {
    const results = await this.store.state.connection.executeQuery(query);

    return {
      results: results.map(this.serializeQueryResponse),
    };
  }

  /* Get the current query text from the active query tab */
  getQueryText(): string {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab to get text from');
    }
    
    return activeTab.unsavedQueryText || '';
  }

  /* Get query text with cursor position */
  getQueryTextWithCursor(): { text: string; cursorIndex: number } {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab to get text from');
    }
    
    return {
      text: activeTab.unsavedQueryText || '',
      cursorIndex: activeTab.editor?.cursorIndex || 0
    };
  }

  /* Get query results from the active query tab */
  getQueryResults(): RunQueryResponse['result'] {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab to get results from');
    }
    
    // Prefer current results; if empty, fall back to last successful results
    let resultSource = activeTab.result;
    if ((!resultSource || !resultSource.length) && activeTab.lastResult && activeTab.lastResult.length) {
      resultSource = activeTab.lastResult;
    }
    if (!resultSource || !resultSource.length) {
      throw new Error('No query results available in the active tab. Please execute the query first.');
    }
    
    return {
      results: resultSource.map(this.serializeQueryResponse),
    };
  }

  /* Get execution plan XML from the active query tab */
  getExecutionPlan(): { planXml: string | null; planXmls: string[] | null } {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab');
    }
    
    return {
      planXml: activeTab.planXml || null,
      planXmls: activeTab.planXmls || null
    };
  }

  /* Get statistics data from the active query tab */
  getStatisticsData(): { statsData: string | null } {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab');
    }
    
    return {
      statsData: activeTab.statsData || null
    };
  }

  /* Get messages data from the active query tab */
  getMessagesData(): { messages: any[] | null } {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab');
    }
    
    return {
      messages: activeTab.queryMessages || null
    };
  }

  /* Get execution plan and statistics from a specific tab by ID */
  getTabExecutionData(tabId: number): { planXml: string | null; planXmls: string[] | null; statsData: string | null } {
    const tabs = (this.store.state as any).tabs.tabs || [];
    const targetTab = tabs.find((tab: any) => tab.id === tabId);
    
    if (!targetTab) {
      throw new Error(`Tab with ID ${tabId} not found`);
    }
    
    if (targetTab.tabType !== 'query') {
      throw new Error(`Tab ${tabId} is not a query tab`);
    }
    
    return {
      planXml: targetTab.planXml || null,
      planXmls: targetTab.planXmls || null,
      statsData: targetTab.statsData || null
    };
  }

  /* Insert text into the active query tab */
  insertText(text: string): void {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab to insert text into');
    }
    
    // Use the Vuex mutation to ensure proper reactivity
    this.store.commit('tabs/updateTabText', { tabId: activeTab.id, text });
  }

  /* Insert text at cursor position in the active query tab */
  insertTextAtCursor(text: string): void {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab to insert text into');
    }
    
    const currentText = activeTab.unsavedQueryText || '';
    const cursorIndex = activeTab.editor?.cursorIndex || currentText.length;
    
    // Insert text at cursor position
    const newText = currentText.slice(0, cursorIndex) + text + currentText.slice(cursorIndex);
    
    // Use the Vuex mutation to ensure proper reactivity
    this.store.commit('tabs/updateTabText', { tabId: activeTab.id, text: newText });
  }

  /* Switch to a different database */
  async switchDatabase(databaseName: string): Promise<void> {
    await this.store.dispatch('changeDatabase', databaseName);
  }

  /* Trigger query execution in the active query tab (simulates clicking the Run button) */
  async executeQueryInTab(): Promise<RunQueryResponse['result']> {
    const activeTab = (this.store.state as any).tabs.active;
    if (!activeTab || activeTab.tabType !== 'query') {
      throw new Error('No active query tab to execute');
    }
    
    // Get the query text from the active tab
    const queryText = activeTab.unsavedQueryText || '';
    if (!queryText || queryText.trim() === '') {
      throw new Error('The query tab is empty. There is no query to run.');
    }
    
    // Mark the tab as running
    activeTab.isRunning = true;
    
    try {
      // Execute the query using the connection
      const queryStartTime = Date.now();
      const queryObj = await this.store.state.connection.query(queryText);
      const results = await queryObj.execute();
      const queryEndTime = Date.now();
      
      // Process results similar to how TabQueryEditor does it
      results.forEach((result: any) => {
        result.rowCount = result.rowCount || 0;
        // Truncate if needed
        if (result.rowCount > (this.store.state as any).settings?.queryEditor?.maxResults || 50000) {
          const maxResults = (this.store.state as any).settings?.queryEditor?.maxResults || 50000;
          result.rows = result.rows.slice(0, maxResults);
          result.truncated = true;
          result.totalRowCount = result.rowCount;
        }
      });
      
      // Store results in the tab (this makes them visible in the UI)
      // Use Vue.set to ensure reactivity (same as TabModule.updateTabText)
      Vue.set(activeTab, 'result', Object.freeze(results));
      Vue.set(activeTab, 'executeTime', queryEndTime - queryStartTime);
      Vue.set(activeTab, 'isRunning', false);
      
      console.log('[executeQueryInTab] Results stored in tab with Vue.set:', {
        resultCount: results.length,
        firstResultRows: results[0]?.rows?.length,
        tabId: activeTab.id
      });
      
      // Save the tab to persist changes
      await this.store.dispatch('tabs/save', activeTab);
      
      console.log('[executeQueryInTab] Tab saved, results should be visible in UI');
      
      // Return the serialized results
      return {
        results: results.map(this.serializeQueryResponse),
      };
    } catch (error) {
      activeTab.isRunning = false;
      throw error;
    }
  }

  /* Get list of all open tabs with their IDs and positions */
  getTabList(): Array<{ id: number | null; title: string; tabType: string; position: number; active: boolean; hasContent?: boolean }> {
    const tabs = (this.store.state as any).tabs.tabs || [];
    const activeTab = (this.store.state as any).tabs.active;
    
    return tabs.map((tab: TransportOpenTab, index: number) => ({
      id: tab.id,
      title: tab.title || `Tab ${index + 1}`,
      tabType: tab.tabType,
      position: tab.position,
      active: activeTab?.id === tab.id,
      // For query tabs, include if they have content
      hasContent: tab.tabType === 'query' && !!(tab.unsavedQueryText && tab.unsavedQueryText.trim())
    }));
  }

  /* Switch to a specific tab by ID */
  async switchToTab(tabId: number): Promise<void> {
    const tabs = (this.store.state as any).tabs.tabs || [];
    const targetTab = tabs.find((tab: TransportOpenTab) => tab.id === tabId);
    
    if (!targetTab) {
      throw new Error(`Tab with ID ${tabId} not found`);
    }
    
    // Use the Vuex mutation to set the active tab
    this.store.commit('tabs/setActive', targetTab);
  }

  openTab(options: 
    | { type: "query"; query?: string }
    | { type: "tableStructure"; table: string; schema?: string }
    | { type: "tableTable"; table: string; schema?: string; filters?: any }
  ): void {
    if (options.type === "query") {
      // Check if there's an active query tab
      const activeTab = (this.store.state as any).tabs.active;
      
      if (activeTab && activeTab.tabType === 'query' && options.query) {
        // Insert into existing active query tab using the Vuex mutation
        this.store.commit('tabs/updateTabText', { tabId: activeTab.id, text: options.query });
      } else {
        // Create new tab
        if (!options.query) {
          this.appEventBus.emit(AppEvent.newTab)
        } else {
          this.appEventBus.emit(AppEvent.newTab, options.query)
        }
      }
      return;
    }

    if (options.type === "tableStructure") {
      const table = this.findTableOrThrow(options.table, options.schema);
      this.appEventBus.emit(AppEvent.openTableProperties, { table });
      return;
    }

    if (options.type === "tableTable") {
      const table = this.findTableOrThrow(options.table, options.schema);
      this.appEventBus.emit(AppEvent.loadTable, {
        table,
        filters: options.filters,
      });
      return;
    }

    throw new Error(`Unsupported tab type: ${(options as any).type}`);
  }

  addPopupMenuItem(menuId: string, item: ContextOption) {
    this.store.commit("popupMenu/add", { menuId, item });
  }

  removePopupMenuItem(menuId: string, slug: string) {
    this.store.commit("popupMenu/remove", { menuId, slug });
  }

  addMenuBarItem(item: ExternalMenuItem<PluginTabContext>) {
    this.store.commit("menuBar/add", item);
  }

  removeMenuBarItem(id: string) {
    this.store.commit("menuBar/remove", id);
  }

  buildPluginTabInit(options: {
    manifest: Manifest;
    viewId: string;
    params?: LoadViewParams;
    command: string;
  }): TransportOpenTabInit<PluginTabContext> {
    // FIXME(azmi): duplicated code from CoreTabs.vue
    const tabItems = this.store.getters["tabs/sortedTabs"];
    let title = options.manifest.name;
    let tNum = 0;
    do {
      tNum = tNum + 1;
      title = `${options.manifest.name} #${tNum}`;
    } while (tabItems.filter((t) => t.title === title).length > 0);

    const views = isManifestV0(options.manifest)
      ? mapViewsAndMenuFromV0ToV1(options.manifest).views
      : options.manifest.capabilities.views;
    const view = views.find((v) => v.id === options.viewId);
    const tabType: PluginTabType = view.type.includes("shell")
      ? "plugin-shell"
      : "plugin-base";

    return {
      tabType,
      title: options.manifest.name,
      unsavedChanges: false,
      context: {
        pluginId: options.manifest.id,
        pluginTabTypeId: options.viewId,
        params: options.params,
        command: options.command,
      },
    };
  }
}
