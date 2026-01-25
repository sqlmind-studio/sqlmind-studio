import Vue from "vue"
import rawLog from '@bksLogger'

const log = rawLog.scope('AppEvent')

export enum AppEvent {
  menuClick = 'menu-click',
  settingsChanged = "sc-refresh",
  newTab = 'nt',
  /** Create a new custom tab. First argument is `TransportOpenTab`. */
  newCustomTab = 'nct',
  closeTab = 'ct',
  closeAllTabs = 'close_all_tabs',
  disconnect = 'dc',
  sqlmindAdded = 'bkadd',
  openExternally = 'oe',
  togglePrimarySidebar = 'ts',
  toggleSecondarySidebar = 'toggleSecondarySidebar',
  toggleBottomPanel = 'toggleBottomPanel',
  selectSecondarySidebarTab = 'selectSecondarySidebarTab',
  beginExport = 'be',
  beginImport = 'beginImport',
  createTable = 'new_table',
  createTableFromFile = 'new_table_from_file',
  openTableProperties = 'loadTableProperties',
  loadTable = 'loadTable',
  quickSearch = 'quickSearch',
  promptLogin = 'cloud_signin',
  promptCreateWorkspace = 'cloud_create_workspace',
  promptRenameWorkspace = 'cloud_rename_workspace',
  promptQueryImport = 'cloud_q_import',
  promptQueryExport = 'q_export',
  promptConnectionImport = 'cloud_c_import',
  promptSqlFilesImport = 'q_files_import',
  openCreateCollectionModal = 'create_collection_modal',
  openAddFieldModal = 'add_field_modal',
  enterLicense = 'enter_license',
  hideEntity = 'hideEntity',
  hideSchema = 'hideSchema',
  toggleHideEntity = 'toggleHideEntity',
  toggleHideSchema = 'toggleHideSchema',
  exportTables = 'exportTables',
  setDatabaseElementName = 'setDatabaseElementName',
  deleteDatabaseElement = 'deleteDatabaseElement',
  dropDatabaseElement = 'dropDatabaseElement',
  duplicateDatabaseTable = 'duplicateDatabaseTable',
  backupDatabase = 'backupDatabase',
  restoreDatabase = 'restoreDatabase',
  upgradeModal = 'upgradeModal',
  toggleExpandTableList = 'toggleExpandTableList',
  togglePinTableList = 'togglePinTableList',
  dropzoneEnter = 'dropzoneEnter',
  dropzoneDrop = 'dropzoneDrop',
  createConfirmModal = 'createConfirmModal',
  showConfirmModal = 'showConfirmModal',
  /** Triggered when the license valid date or support date has expired */
  licenseExpired = 'licenseExpired',
  /** Triggered when the license valid date has expired */
  licenseValidDateExpired = 'licenseValidDateExpired',
  /** Triggered when the license support date has expired */
  licenseSupportDateExpired = 'licenseSupportDateExpired',
  switchLicenseState = 'switchLicenseState',
  toggleBeta = 'toggleBeta',
  switchUserKeymap = 'switchUserKeymap',
  openPluginManager = 'openPluginManager',
  updateJsonViewerSidebar = 'updateJsonViewerSidebar',
  jsonViewerSidebarExpandPath = 'jsonViewerSidebarExpandPath',
  jsonViewerSidebarValueChange = 'jsonViewerSidebarValueChange',
  /** A tab is about to be switched. First argument is the tab. */
  switchingTab = 'switchingTab',
  /** A tab has been switched. First argument is the tab. */
  switchedTab = 'switchedTab',
  /** A tab is about to be closed. First argument is the tab. */
  closingTab = 'closingTab',
  updatePin = 'updatePin',
  /** The theme has been changed. */
  changedTheme = 'changedTheme',
  /** Toggle the inline AI command bar below tabs */
  toggleInlineAI = 'toggleInlineAI',
  /** Submit an inline AI prompt */
  aiInlinePrompt = 'aiInlinePrompt',
  /** Run the active query editor tab (selection if present) */
  runActiveQuery = 'runActiveQuery',
  /** Inline AI work completed (success or fail) */
  aiInlineDone = 'aiInlineDone',
  /** Inline AI step progress (e.g., Get DB, Get Tables, Get Columns, Insert SQL) */
  aiInlineStep = 'aiInlineStep',
  /** Staged AI analysis: started */
  aiAnalysisStarted = 'aiAnalysisStarted',
  /** Staged AI analysis: completed */
  aiAnalysisCompleted = 'aiAnalysisCompleted',
  /** Staged AI analysis: log line to mirror in chat */
  aiAnalysisLog = 'aiAnalysisLog',
  /** Request database objects for @ mentions */
  requestDatabaseObjects = 'requestDatabaseObjects',
  /** Response with database objects for @ mentions */
  databaseObjectsLoaded = 'databaseObjectsLoaded',
}

export interface RootBinding {
  event: string
  handler(arg: any): void
}


export const AppEventMixin = Vue.extend({
  methods:  {
    registerHandlers(bindings: RootBinding[]) {
      bindings.forEach(({ event, handler }) => {
        this.$root.$on(event, handler)
      })
    },
    unregisterHandlers(bindings: RootBinding[]) {
      bindings.forEach(({ event, handler }) => {
        this.$root.$off(event, handler)
      })
    },
    trigger(event: AppEvent, ...args: any) {
      log.debug('trigger', event, args)
      this.$root.$emit(event.toString(), ...args)
    }
  }

})
