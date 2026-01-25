<template>
  <div
    class="core-tabs"
    v-hotkey="keymap"
  >
    <div
      v-if="showInlineAI && activeTab?.tabType === 'query'"
      class="inline-ai-modal"
    >
      <div
        class="inline-ai-modal-bg"
        @mousedown.prevent="closeInlineAI"
      />
      <div
        class="inline-ai-modal-wrap"
        @mousedown.stop
        @mousedown="focusInlineAI"
        @keydown.stop
        @keyup.stop
        @keypress.stop
      >
        <InlineAICommand />
      </div>
    </div>
    <div class="tabs-header">
      <!-- <div class="nav-tabs nav"> -->
      <Draggable
        :options="dragOptions"
        v-model="tabItems"
        tag="ul"
        class="nav-tabs nav"
        chosen-class="nav-item-wrap-chosen"
      >
        <core-tab-header
          v-for="tab in tabItems"
          :key="tab.id"
          :tab="tab"
          :tabs-count="tabItems.length"
          :selected="activeTab?.id === tab.id"
          @click="click"
          @close="close"
          @closeAll="closeAll"
          @closeOther="closeOther"
          @closeToRight="closeToRight"
          @forceClose="forceClose"
          @duplicate="duplicate"
          @copyName="copyName"
          @reloadPluginView="handleReloadPluginView"
        />
      </Draggable>
      <!-- </div> -->
      <span class="actions expand">
        <a
          @click.prevent="createQuery(null)"
          class="btn-fab add-query"
        ><i class=" material-icons">add_circle</i></a>
      </span>
      <a
        @click.prevent="showUpgradeModal"
        class="btn btn-brand btn-icon btn-upgrade"
        v-tooltip="'Upgrade for: backup/restore, import from file, larger query results, and more!'"
        v-if="$store.getters.isCommunity"
      >
        <i class="material-icons">stars</i> Upgrade
      </a>
    </div>
    <div class="tab-content">
      <div class="empty-editor-group empty flex-col  expand">
        <div class="expand layout-center">
          <shortcut-hints />
        </div>
      </div>
      <div
        v-for="(tab, idx) in tabItems"
        class="tab-pane"
        :id="'tab-' + idx"
        :key="tab.id"
        :class="{active: (activeTab?.id === tab.id)}"
        v-show="activeTab?.id === tab.id"
      >
        <QueryEditor
          v-if="tab.tabType === 'query'"
          :ref="`tab-${tab.id}`"
          :active="activeTab?.id === tab.id"
          :tab="tab"
          :tab-id="tab.id"
        />
        <Shell
          v-if="tab.tabType === 'shell'"
          :active="activeTab?.id === tab.id"
          :tab="tab"
          :tab-id="tab.id"
        />
        <PluginBase
          v-if="tab.tabType === 'plugin-base'"
          :tab="tab"
          :active="activeTab?.id === tab.id"
          :reload="reloader[tab.id]"
          @close="close"
        />
        <PluginShell
          v-if="tab.tabType === 'plugin-shell'"
          :tab="tab"
          :active="activeTab?.id === tab.id"
          :reload="reloader[tab.id]"
          @close="close"
        />
        <tab-with-table
          v-if="tab.tabType === 'table'"
          :tab="tab"
          @close="close"
        >
          <template v-slot:default="slotProps">
            <TableTable
              :tab="tab"
              :active="activeTab?.id === tab.id"
              :table="slotProps.table"
            />
          </template>
        </tab-with-table>
        <tab-with-table
          v-if="tab.tabType === 'table-properties'"
          :tab="tab"
          @close="close"
        >
          <template v-slot:default="slotProps">
            <TableProperties
              :active="activeTab?.id === tab.id"
              :tab="tab"
              :tab-id="tab.id"
              :table="slotProps.table"
            />
          </template>
        </tab-with-table>
        <TableBuilder
          v-if="tab.tabType === 'table-builder'"
          :active="activeTab?.id === tab.id"
          :tab="tab"
          :tab-id="tab.id"
        />
        <ImportExportDatabase
          v-if="tab.tabType === 'import-export-database'"
          :schema="tab.schemaName"
          :tab="tab"
          :active="activeTab?.id === tab.id"
          @close="close"
        />
        <DatabaseBackup
          v-if="tab.tabType === 'backup'"
          :connection="connection"
          :is-restore="false"
          :active="activeTab?.id === tab.id"
          :tab="tab"
          @close="close"
        />
        <DatabaseBackup
          v-if="tab.tabType === 'restore'"
          :connection="connection"
          :is-restore="true"
          :active="activeTab?.id === tab.id"
          :tab="tab"
          @close="close"
        />
        <ImportTable
          v-if="tab.tabType === 'import-table'"
          :tab="tab"
          :schema="tab.schemaName"
          :table="tab.tableName"
          :active="activeTab?.id === tab.id"
          :connection="connection"
          @close="close"
        />
        <TabStatistics
          v-if="tab.tabType === 'statistics'"
          :tab="tab"
          :active="activeTab?.id === tab.id"
          :connection="connection"
        />
        <TabExecutionPlan
          v-if="tab.tabType === 'executionplan'"
          :tab="tab"
          :active="activeTab?.id === tab.id"
          :show-paste-area="true"
        />
      </div>
    </div>
    <portal to="modals">
      <modal
        :name="modalName"
        class="sqlmind-modal vue-dialog sure header-sure"
        @opened="sureOpened"
        @closed="sureClosed"
        @before-open="beforeOpened"
      >
        <div v-kbd-trap="true">
          <div class="dialog-content">
            <div class="dialog-c-title">
              Really {{ dbAction | titleCase }} <span class="tab-like"><tab-icon
                :tab="tabIcon"
              /> {{ dbElement ?? '' }}</span>?
            </div>
            <p>This change cannot be undone</p>
          </div>
          <div class="vue-dialog-buttons">
            <span class="expand" />
            <button
              ref="no"
              @click.prevent="$modal.hide(modalName)"
              class="btn btn-sm btn-flat"
            >
              Cancel
            </button>
            <button
              @focusout="handleDeleteButtonFocusout"
              @click.prevent="completeDeleteAction"
              class="btn btn-sm btn-primary"
            >
              {{ titleCaseAction ?? '' }} {{ dbElement ?? '' }}
            </button>
          </div>
        </div>
      </modal>

      <!-- Duplicate Modal -->

      <modal
        :name="duplicateTableModal"
        class="sqlmind-modal vue-dialog sure header-sure"
        @opened="sureOpened"
        @closed="sureClosed"
        @before-open="beforeOpened"
      >
        <div v-kbd-trap="true">
          <div
            class="dialog-content"
            v-if="dialectData?.disabledFeatures?.duplicateTable"
          >
            <div class="dialog-c-title text-center">
              Table Duplication not supported for {{ dialectTitle ?? 'this database' }} yet. Stay tuned!
            </div>
          </div>
          <div
            class="dialog-content"
            v-else
          >
            <div class="dialog-c-title">
              {{ dbAction | titleCase }} <span class="tab-like"><tab-icon :tab="tabIcon" />
                {{ dbElement ?? '' }}</span>?
            </div>
            <div class="form-group">
              <label for="duplicateTableName">New table name</label>
              <input
                type="text"
                name="duplicateTableName"
                class="form-control"
                required
                v-model="duplicateTableName"
                autofocus
                ref="duplicateTableNameInput"
              >
            </div>
            <small>This will create a new table and copy all existing data into it. Keep in mind that any indexes,
              relations, or triggers associated with the original table will not be duplicated in the new table</small>
          </div>
          <div
            v-if="!dialectData?.disabledFeatures?.duplicateTable"
            class="vue-dialog-buttons"
          >
            <span class="expand" />
            <button
              ref="no"
              @click.prevent="$modal.hide(duplicateTableModal)"
              class="btn btn-sm btn-flat"
            >
              Cancel
            </button>
            <pending-changes-button
              :submit-apply="duplicateTable"
              :submit-sql="duplicateTableSql"
            />
          </div>
        </div>
      </modal>
    </portal>

    <confirmation-modal :id="confirmModalId">
      <template v-slot:title>
        Really close
        <span
          class="tab-like"
          v-if="closingTab"
        >
          <tab-icon :tab="closingTab" /> {{ closingTab.title }}
        </span>
        ?
      </template>
      <template v-slot:message>
        You will lose unsaved changes
      </template>
    </confirmation-modal>

    <sql-files-import-modal @submit="importSqlFiles" />
    <create-collection-modal />
  </div>
</template>

<script lang="ts">

import _ from 'lodash'

import QueryEditor from './TabQueryEditor.vue'
import InlineAICommand from './ai/InlineAICommand.vue'
import Statusbar from './common/StatusBar.vue'
import CoreTabHeader from './CoreTabHeader.vue'
import TableTable from './tableview/TableTable.vue'
import TableProperties from './TabTableProperties.vue'
import TableBuilder from './TabTableBuilder.vue'
import ImportExportDatabase from './importexportdatabase/ImportExportDatabase.vue'
import ImportTable from './TabImportTable.vue'
import DatabaseBackup from './TabDatabaseBackup.vue'
import PluginShell from './TabPluginShell.vue'
import PluginBase from './TabPluginBase.vue'
import TabStatistics from './TabStatistics.vue'
import TabExecutionPlan from './TabExecutionPlan.vue'
import { AppEvent } from '../common/AppEvent'
import { mapGetters, mapState } from 'vuex'
import Draggable from 'vuedraggable'
import ShortcutHints from './editor/ShortcutHints.vue'
import { FormatterDialect } from '@shared/lib/dialects/models'
import Vue from 'vue';
import { CloseTabOptions } from '@/common/appdb/models/CloseTab';
import TabWithTable from './common/TabWithTable.vue';
import TabIcon from './tab/TabIcon.vue'
import { DatabaseEntity } from "@/lib/db/models"
import PendingChangesButton from './common/PendingChangesButton.vue'
import { DropzoneDropEvent } from '@/common/dropzone'
import { readWebFile } from '@/common/utils'
import Noty from 'noty'
import ConfirmationModal from './common/modals/ConfirmationModal.vue'
import CreateCollectionModal from './common/modals/CreateCollectionModal.vue'
import SqlFilesImportModal from '@/components/common/modals/SqlFilesImportModal.vue'
import Shell from './TabShell.vue'

import { safeSqlFormat as safeFormat } from '@/common/utils';
import { TabTypeConfig, TransportOpenTab, TransportPluginTab, setFilters, matches, duplicate } from '@/common/transport/TransportOpenTab'
import { sendUserContextToPlugin, initializeAIUserContext } from '@/lib/aiUserContext'

export default Vue.extend({
  props: [],
  components: {
    Statusbar,
    QueryEditor,
    CoreTabHeader,
    TableTable,
    TableProperties,
    ImportExportDatabase,
    ImportTable,
    Draggable,
    ShortcutHints,
    TableBuilder,
    TabWithTable,
    TabIcon,
    DatabaseBackup,
    PendingChangesButton,
    ConfirmationModal,
    SqlFilesImportModal,
    CreateCollectionModal,
    Shell,
    TabStatistics,
    TabExecutionPlan,
    PluginShell,
    PluginBase,
    InlineAICommand,
  },
  data() {
    return {
      showExportModal: false,
      tableExportOptions: null,
      dragOptions: {
        handle: '.nav-item'
      },
      // inline-ai request tracking
      aiPending: {},
      aiChatPending: {},
      _aiMessageHandler: null,
      sureOpen: false,
      lastFocused: null,
      dbAction: null,
      dbElement: null,
      dbEntityType: null,
      dbDeleteElementParams: null,
      // below are connected to the modal for duplicate
      dbDuplicateTableParams: null,
      duplicateTableName: null,
      closingTab: null,
      confirmModalId: 'core-tabs-close-confirmation',
      reloader: {},
      showInlineAI: false,
      inlineAIKeyHandler: null,
    }
  },
  watch: {
    showInlineAI() {
      if (this.showInlineAI) {
        this.$nextTick(() => {
          this.focusInlineAI()
        })
        this.inlineAIKeyHandler = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            this.closeInlineAI()
          }
        }
        document.addEventListener('keydown', this.inlineAIKeyHandler, true)
      } else {
        if (this.inlineAIKeyHandler) {
          document.removeEventListener('keydown', this.inlineAIKeyHandler, true)
          this.inlineAIKeyHandler = null
        }
      }
    },
    async usedConfig() {
      await this.$store.dispatch('tabs/load')
      if (!this.tabItems?.length) {
        this.createQuery()
      }
    },
    // Send updated context when connection changes
    connection: {
      handler(newConnection) {
        sendUserContextToPlugin(newConnection)
      },
      deep: false
    }
  },
  filters: {
    titleCase: function (value) {
      if (!value) return ''
      value = value.toString()
      return value.charAt(0).toUpperCase() + value.slice(1)
    }
  },
  computed: {
    ...mapState(['selectedSidebarItem']),
    ...mapState('tabs', { 'activeTab': 'active', 'tabs': 'tabs' }),
    ...mapState(['connection', 'connectionType', 'usedConfig', 'database']),
    ...mapGetters({ 
       'dialect': 'dialect', 
       'dialectData': 'dialectData', 
       'dialectTitle': 'dialectTitle',
       'tabTypeConfigs': 'tabs/tabTypeConfigs',
    }),
    tabIcon() {
      return {
        type: this.dbEntityType,
        tabType: this.dbEntityType,
        entityType: this.dbEntityType
      }
    },
    titleCaseAction() {
      return _.capitalize(this.dbAction)
    },
    modalName() {
      return "dropTruncateModal"
    },
    duplicateTableModal() {
      return "duplicateTableModal"
    },
    tabItems: {
      get() {
        return this.$store.getters['tabs/sortedTabs']
      },
      set(newTabs: TransportOpenTab[]) {
        this.$store.dispatch('tabs/reorder', newTabs)
      }
    },
    rootBindings() {
      return [
        { event: AppEvent.closeTab, handler: this.closeCurrentTab },
        { event: AppEvent.closeAllTabs, handler: this.closeAll },
        { event: AppEvent.newTab, handler: this.createQuery },
        { event: AppEvent.newCustomTab, handler: this.addTab },
        { event: AppEvent.createTable, handler: this.openTableBuilder },
        { event: AppEvent.createTableFromFile, handler: this.beginImport },
        { event: 'historyClick', handler: this.createQueryFromItem },
        { event: AppEvent.loadTable, handler: this.openTable },
        { event: AppEvent.openTableProperties, handler: this.openTableProperties },
        { event: 'loadSettings', handler: this.openSettings },
        { event: 'loadTableCreate', handler: this.loadTableCreate },
        { event: 'loadRoutineCreate', handler: this.loadRoutineCreate },
        { event: 'favoriteClick', handler: this.favoriteClick },
        { event: 'exportTable', handler: this.openExportModal },
        { event: AppEvent.toggleHideEntity, handler: this.toggleHideEntity },
        { event: AppEvent.toggleHideSchema, handler: this.toggleHideSchema },
        { event: AppEvent.deleteDatabaseElement, handler: this.deleteDatabaseElement },
        { event: AppEvent.dropDatabaseElement, handler: this.dropDatabaseElement },
        { event: AppEvent.duplicateDatabaseTable, handler: this.duplicateDatabaseTable },
        { event: AppEvent.dropzoneDrop, handler: this.handleDropzoneDrop },
        { event: AppEvent.promptQueryExport, handler: this.handlePromptQueryExport },
        { event: AppEvent.exportTables, handler: this.importExportTables },
        { event: AppEvent.backupDatabase, handler: this.backupDatabase },
        { event: AppEvent.beginImport, handler: this.beginImport },
        { event: AppEvent.restoreDatabase, handler: this.restoreDatabase },
        { event: AppEvent.switchUserKeymap, handler: this.switchUserKeymap },
        { event: 'statistics:open', handler: this.openStatistics },
        { event: 'executionplan:open', handler: this.openExecutionPlan },
        { event: AppEvent.requestDatabaseObjects, handler: this.handleRequestDatabaseObjects },
      ]
    },
    lastTab() {
      return this.tabItems[this.tabItems.length - 1];
    },
    firstTab() {
      return this.tabItems[0]
    },
    activeIdx() {
      return _.indexOf(this.tabItems, this.activeTab)
    },
    keymap() {
      const result = this.$vHotkeyKeymap({
        'tab.nextTab': this.nextTab,
        'tab.previousTab': this.previousTab,
        'tab.reopenLastClosedTab': this.reopenLastClosedTab,
        'tab.switchTab1': this.handleSwitchTab.bind(this, 0),
        'tab.switchTab2': this.handleSwitchTab.bind(this, 1),
        'tab.switchTab3': this.handleSwitchTab.bind(this, 2),
        'tab.switchTab4': this.handleSwitchTab.bind(this, 3),
        'tab.switchTab5': this.handleSwitchTab.bind(this, 4),
        'tab.switchTab6': this.handleSwitchTab.bind(this, 5),
        'tab.switchTab7': this.handleSwitchTab.bind(this, 6),
        'tab.switchTab8': this.handleSwitchTab.bind(this, 7),
        'tab.switchTab9': this.handleSwitchTab.bind(this, 8),
      })
      // FIXME (azmi): move this to default config file
      if(this.$config.isMac) {
        result['meta+shift+t'] = this.reopenLastClosedTab
      }

      return result
    },
  },
  created() {
    this.$root.$refs.CoreTabs = this;
    // Register inline AI events as early as possible
    this.$root.$on(AppEvent.toggleInlineAI, this.handleToggleInlineAI)
    this.$root.$on(AppEvent.aiInlinePrompt, this.handleInlineAIPrompt)
    // Listen for LLM plugin responses
    this._aiMessageHandler = async (ev) => {
      try {
        const data = ev?.data || {}
        // console.log('[InlineAI] Received message:', { type: data.type, hasData: !!data });
        if (!data || !data.type) return
        if (data.type === 'bks-ai/chat-inline-prompt') {
          const prompt = String(data.prompt || '').trim()
          if (!prompt) return
          const chatRequestId = String(data.requestId || '').trim() || null
          const aiMode = (String(data.aiMode || 'developer') || 'developer').trim()
          const previewOnly = !!data.previewOnly
          const requestId = `inline_${Date.now()}_${Math.random().toString(36).slice(2)}`
          if (chatRequestId) {
            try { this.aiChatPending[requestId] = { chatRequestId, aiMode, previewOnly } } catch (_) {}
          }
          try { console.log('[InlineAI] received chat-inline-prompt', { length: prompt.length }) } catch {}
          // Reuse the exact InlineAI schema pipeline (active DB -> tables -> columns -> plugin generation -> insert SQL)
          await this.handleInlineAIPrompt({
            prompt,
            command: null,
            mentions: [],
            mentionedObjects: [],
            runAfterInsert: false,
            aiMode,
            requestId,
          })
          return
        }

        if (data.type === 'bks-ai/chat-inline-apply') {
          const sql = String(data.sql || '').trim()
          if (!sql) return
          const runAfterInsert = !!data.runAfterInsert
          const currentDb = (this.database || '').toString().trim()
          let finalSql = sql
          try {
            if (this.connectionType === 'sqlserver' && currentDb) {
              const hasUse = /^\s*USE\s+\[?[^\]\s;]+\]?\s*;?/i.test(finalSql)
              if (!hasUse) {
                const escaped = `[${String(currentDb).replace(/]/g, ']]')}]`
                finalSql = `USE ${escaped};\n${finalSql}`
              }
            }
          } catch (_) {}
          this.insertSqlIntoActiveQuery(finalSql, true)
          if (runAfterInsert) {
            this.$nextTick(() => {
              try { console.log('[InlineAI] executing query after chat-inline-apply') } catch {}
              this.$root.$emit(AppEvent.runActiveQuery)
            })
          }
          return
        }

        if (data.type === 'bks-ai/inline-code/insert-sql') {
          try { console.log('[InlineAI] received insert-sql reply from plugin', { requestId: data.requestId, hasSql: !!data.sql, sqlLength: (data.sql || '').length, replaceMode: !!data.replaceMode }) } catch {}
          const { requestId, sql, run, replaceMode } = data
          const pending = requestId ? this.aiPending[requestId] : null
          const allowInsert = pending && typeof pending.allowInsert !== 'undefined' ? !!pending.allowInsert : true
          const chatPending = requestId ? this.aiChatPending[requestId] : null
          if (requestId && this.aiPending[requestId]) {
            delete this.aiPending[requestId]
          }
          if (requestId && this.aiChatPending[requestId]) {
            delete this.aiChatPending[requestId]
          }
          const isDiagnosticPlaceholder = (typeof sql === 'string') && /^\s*--\s*Inline AI did not return SQL/i.test(sql)
          if (!allowInsert) {
            try { console.log('[InlineAI] blocking SQL insert for analysis flow (aiMode=analysis)') } catch {}
          } else if (isDiagnosticPlaceholder) {
            try { console.log('[InlineAI] skipping diagnostic placeholder insert from plugin') } catch {}
          } else if (sql && typeof sql === 'string' && sql.trim()) {
            const currentDb = (this.database || '').toString().trim()
            const shouldForceReplace = true
            let finalSql = String(sql)
            // Ensure SQL Server executes in the selected database context (tab execution may still be on master).
            // Only prepend if not already present.
            try {
              if (this.connectionType === 'sqlserver' && currentDb) {
                const hasUse = /^\s*USE\s+\[?[^\]\s;]+\]?\s*;?/i.test(finalSql)
                if (!hasUse) {
                  const escaped = `[${String(currentDb).replace(/]/g, ']]')}]`
                  finalSql = `USE ${escaped};\n${finalSql}`
                }
              }
            } catch (_) {}
            try { console.log('[InlineAI] inserting SQL into active query', { sqlLength: finalSql.length, runAfter: !!run, replaceMode: true, currentDb }) } catch {}
            if (allowInsert) {
              this.insertSqlIntoActiveQuery(finalSql, shouldForceReplace)
            }
            try {
              if (chatPending?.chatRequestId) {
                const w = this.getBksAiShellWindow()
                const response = {
                  type: 'bks-ai/chat-inline-result',
                  requestId: chatPending.chatRequestId,
                  aiMode: chatPending.aiMode,
                  database: currentDb,
                  sql: finalSql,
                }
                if (w) w.postMessage(response, '*')
                else window.postMessage(response, '*')
              }
            } catch (_) {}
            if (run) {
              this.$nextTick(() => {
                try { console.log('[InlineAI] executing query after insert') } catch {}
                this.$root.$emit(AppEvent.runActiveQuery)
              })
            }
          } else {
            try { console.warn('[InlineAI] received empty SQL from plugin') } catch {}
            try {
              if (chatPending?.chatRequestId) {
                const w = this.getBksAiShellWindow()
                const response = {
                  type: 'bks-ai/chat-inline-error',
                  requestId: chatPending.chatRequestId,
                  aiMode: chatPending.aiMode,
                  database: (this.database || '').toString().trim(),
                  error: 'InlineAI did not return SQL',
                }
                if (w) w.postMessage(response, '*')
                else window.postMessage(response, '*')
              }
            } catch (_) {}
          }
          // Step: Insert SQL -> done
          this.$root.$emit(AppEvent.aiInlineStep, { id: 'insert', status: 'done' })
          this.$root.$emit(AppEvent.aiInlineDone)
        } else if (data.type === 'bks-ai/analysis-need-sections') {
          const { requestId, request } = data
          try { console.log('[InlineAI] received analysis-need-sections from plugin', { requestId, request }) } catch {}
          // Forward to Toolbar.vue which handles Stage 2 data collection
          try { this.$root.$emit('aiAnalysisNeedSections', request) } catch {}
          // Don't mark as done - waiting for Stage 2 completion
        } else if (data.type === 'bks-ai/analysis-final-text') {
          const { requestId, text } = data
          try { console.log('[InlineAI] received analysis-final-text from plugin', { requestId, length: (text || '').length }) } catch {}
          if (requestId && this.aiPending[requestId]) {
            delete this.aiPending[requestId]
          }
          // Forward to Toolbar/Chat validator, which enforces AI_FINAL markers
          try { this.$root.$emit('aiAnalysisFinalText', { text: String(text || '') }) } catch {}
          // Mark flow done for status tracking
          this.$root.$emit(AppEvent.aiInlineStep, { id: 'insert', status: 'done' })
          this.$root.$emit(AppEvent.aiInlineDone)
        } else if (data.type === 'bks-ai/analysis-error') {
          const { requestId, error } = data
          try { console.log('[InlineAI] received analysis-error from plugin', { requestId, error }) } catch {}
          if (requestId && this.aiPending[requestId]) {
            delete this.aiPending[requestId]
          }
          // Forward error to Toolbar for display
          try { this.$root.$emit('aiAnalysisError', { error: String(error || 'Unknown error') }) } catch {}
          // Mark flow done
          this.$root.$emit(AppEvent.aiInlineDone)
        } else if (data.type === 'bks-ai/fetch-system-schemas') {
          // TWO-PHASE AGENTIC WORKFLOW: Handle system object schema fetch request
          const { requestId, systemObjects } = data
          try { console.log('[CoreTabs] Received system schema fetch request:', { requestId, systemObjects }) } catch {}
          
          // Fetch schemas for requested system objects
          const schemas = await this.fetchSystemObjectSchemas(systemObjects)
          
          // Send schemas back to plugin
          const w = this.getBksAiShellWindow()
          const response = {
            type: 'bks-ai/system-schemas-response',
            requestId,
            schemas
          }
          try { console.log('[CoreTabs] Sending system schemas to plugin:', { requestId, schemaCount: Object.keys(schemas).length }) } catch {}
          if (w) w.postMessage(response, '*')
          else window.postMessage(response, '*')
        } else if (data.type === 'bks-ai/inline-error') {
          const { requestId, error } = data
          try { console.log('[InlineAI] received inline-error from plugin', { requestId, error }) } catch {}
          if (requestId && this.aiPending[requestId]) {
            delete this.aiPending[requestId]
          }
          // Show error notification to user
          if (this.$noty && this.$noty.error) {
            this.$noty.error(String(error || 'AI request failed'))
          } else {
            console.error('[InlineAI] Error:', error)
          }
          // Mark flow done
          this.$root.$emit(AppEvent.aiInlineDone)
        }
      } catch (err) {
        try { console.error('[InlineAI] error in message handler', err) } catch {}
        this.$root.$emit(AppEvent.aiInlineDone)
      }
    }
    window.addEventListener('message', this._aiMessageHandler)
  },
  beforeDestroy() {
    this.$root.$off(AppEvent.toggleInlineAI, this.handleToggleInlineAI)
    this.$root.$off(AppEvent.aiInlinePrompt, this.handleInlineAIPrompt)
    try { if (this._aiMessageHandler) window.removeEventListener('message', this._aiMessageHandler) } catch {}
    try {
      if (this.inlineAIKeyHandler) {
        document.removeEventListener('keydown', this.inlineAIKeyHandler, true)
        this.inlineAIKeyHandler = null
      }
    } catch {}
    this.unregisterHandlers(this.rootBindings)
  },
  methods: {
    focusInlineAI() {
      try {
        const input = this.$el?.querySelector?.('.inline-ai-modal .inline-ai-input') as HTMLInputElement
        if (input) input.focus()
      } catch (_) {}
    },
    closeInlineAI() {
      this.showInlineAI = false
    },
    handleToggleInlineAI() {
      this.showInlineAI = !this.showInlineAI
      // Remove notification to avoid UI lag
      // Focus will happen in InlineAICommand's mounted hook
    },
    async handleInlineAIPrompt({ prompt, command, mentions, mentionedObjects, runAfterInsert, aiMode, requestId }) {
      console.log('[CoreTabs] handleInlineAIPrompt called with:', { prompt, command, mentions, mentionedObjects, runAfterInsert, aiMode });
      // Schema-only: get active database, list tables, and columns
      try {
        const conn: any = this.connection as any
        let activeDb: string | undefined
        // Step: Get Active Database -> pending
        console.log('[CoreTabs] Emitting aiInlineStep: db pending');
        this.$root.$emit(AppEvent.aiInlineStep, { id: 'db', status: 'pending' })
        // Try selected database from store first, then common getters
        const dbCandidates = [
          () => (this.database),
          () => (conn?.getCurrentDatabase ? conn.getCurrentDatabase() : undefined),
          () => (conn?.currentDatabase ? conn.currentDatabase() : undefined),
          () => (typeof conn?.database === 'string' ? conn.database : undefined),
          () => (this.usedConfig && (this.usedConfig as any).defaultDatabase),
        ]
        for (const fn of dbCandidates) {
          try { const v = await fn(); if (v) { activeDb = v; break } } catch { /* ignore */ }
        }
        if (!activeDb) {
          // Dialect-specific SQL fallback to detect current database
          try {
            let sql = null
            if (this.dialect === 'mssql' || this.connectionType === 'sqlserver') sql = 'SELECT DB_NAME() AS name'
            else if (this.dialect === 'mysql' || this.connectionType === 'mysql' || this.connectionType === 'mariadb' || this.connectionType === 'tidb') sql = 'SELECT DATABASE() AS name'
            else if (this.dialect === 'psql' || this.connectionType === 'postgresql' || this.connectionType === 'redshift' || this.connectionType === 'cockroachdb') sql = 'SELECT current_database() AS name'
            else if (this.connectionType === 'sqlite') sql = null // single-file DB; use filename below

            if (sql && conn?.executeQuery) {
              const results = await conn.executeQuery(sql)
              const row0 = Array.isArray(results) ? results[0]?.rows?.[0] : null
              activeDb = row0?.name || row0?.current_database || row0?.database
            }
            if (!activeDb && this.connectionType === 'sqlite') {
              activeDb = this.usedConfig?.defaultDatabase || 'main'
            }
          } catch { /* ignore */ }

          if (!activeDb) {
            this.$noty && this.$noty.warning ? this.$noty.warning('No active database selected') : console.warn('No active database selected')
          }
        }
        // Step: Get Active Database -> done
        this.$root.$emit(AppEvent.aiInlineStep, { id: 'db', status: 'done' })

        // Get tables using the current connection's selected DB
        // Prefer store tables if already loaded
        this.$root.$emit(AppEvent.aiInlineStep, { id: 'tables', status: 'pending' })
        let tables: any[] = []
        if (Array.isArray(this.$store.state.tables) && this.$store.state.tables.length) {
          tables = this.$store.state.tables
        } else if (conn?.listTables) {
          tables = await conn.listTables(null)
        } else if (conn?.getTables) {
          tables = await conn.getTables()
        } else if (conn?.getAllTables) {
          tables = await conn.getAllTables()
        } else {
          try { await this.$store.dispatch('updateTables') } catch { /* ignore */ }
          tables = this.$store.state.tables || []
        }

        // Normalize tables to array of { name, schema }
        let normTables = (tables || []).map((t: any) => ({
          name: t?.name || t?.tableName || t,
          schema: t?.schema || t?.tableSchema || t?.schemaName,
        })).filter((t: any) => t.name)
        // Retry once if empty: trigger a tables refresh and re-normalize
        if (!normTables.length) {
          try { await this.$store.dispatch('updateTables') } catch {}
          let retryTables: any[] = []
          try { retryTables = this.$store.state.tables || [] } catch {}
          if ((!retryTables || !retryTables.length) && conn?.getTables) {
            try { retryTables = await conn.getTables() } catch {}
          }
          normTables = (retryTables || []).map((t: any) => ({
            name: t?.name || t?.tableName || t,
            schema: t?.schema || t?.tableSchema || t?.schemaName,
          })).filter((t: any) => t.name)
          // If still empty, poll briefly for the store to finish loading
          if (!normTables.length) {
            for (let i = 0; i < 10; i++) { // ~1.5s total
              await new Promise(r => setTimeout(r, 150))
              try {
                const late = this.$store.state.tables || []
                if (late && late.length) {
                  normTables = late.map((t: any) => ({
                    name: t?.name || t?.tableName || t,
                    schema: t?.schema || t?.tableSchema || t?.schemaName,
                  })).filter((t: any) => t.name)
                  if (normTables.length) break
                }
              } catch {}
            }
          }
        }
        this.$root.$emit(AppEvent.aiInlineStep, { id: 'tables', status: 'done' })

        // Fetch columns for tables referenced in the query (if available), otherwise first 3 tables
        this.$root.$emit(AppEvent.aiInlineStep, { id: 'columns', status: 'pending' })
        
        // Get current query text early to parse for table references
        const tab = this.activeTab
        let currentQuery = ''
        if (tab && tab.tabType === 'query') {
          currentQuery = tab.unsavedQueryText || tab.query || ''
        }
        
        // Parse current query to find referenced tables
        let tablesToFetch: any[] = [] // Prefer tables explicitly referenced in the current query
        if (currentQuery) {
          const referencedTables = new Set<string>()
          // Match table references like: FROM/JOIN schema.table or FROM/JOIN table
          const tablePattern = /(?:FROM|JOIN)\s+(?:(\w+)\.)?(\w+)/gi
          let match
          while ((match = tablePattern.exec(currentQuery)) !== null) {
            const schema = match[1] || null
            const tableName = match[2]
            if (tableName) {
              referencedTables.add(schema ? `${schema}.${tableName}` : tableName)
            }
          }
          
          // Find matching tables from normTables
          if (referencedTables.size > 0) {
            const matchedTables = normTables.filter(t => {
              const fullName = t.schema ? `${t.schema}.${t.name}` : t.name
              const nameOnly = t.name
              return referencedTables.has(fullName) || 
                     referencedTables.has(nameOnly) ||
                     Array.from(referencedTables).some(ref => 
                       ref.toLowerCase() === fullName.toLowerCase() || 
                       ref.toLowerCase() === nameOnly.toLowerCase()
                     )
            })
            if (matchedTables.length > 0) tablesToFetch = matchedTables
          }
        }
        // Fallbacks when no referenced tables found
        if ((!tablesToFetch || tablesToFetch.length === 0) && normTables && normTables.length > 0) {
          if (aiMode === 'developer' && typeof prompt === 'string' && prompt.trim()) {
            // TWO-STAGE APPROACH: Send ALL table names first (lightweight)
            // AI will analyze and tell us which tables it needs
            // Then we fetch columns only for those specific tables
            tablesToFetch = normTables // Send all table names (no columns yet)
          } else if (aiMode === 'dba') {
            // For DBA mode: Don't send user tables at all
            // DBA mode uses system DMVs only (handled by plugin)
            tablesToFetch = []
          } else {
            // For other modes without prompt, use first few tables as generic context
            const cap = 3
            tablesToFetch = normTables.slice(0, Math.min(cap, normTables.length))
          }
        }
        
        const columnsByTable: Record<string, any[]> = {}
        // Only fetch columns if we have a reasonable number of tables
        // If we have many tables (>30), send table names only and let AI request columns
        const shouldFetchColumns = tablesToFetch.length > 0 && tablesToFetch.length <= 30
        
        if (shouldFetchColumns) {
          for (const t of tablesToFetch) {
            try {
              let cols: any[] = []
              // Prefer driver-accurate call per dialect
              if (this.connectionType === 'sqlserver' && conn?.listTableColumns) cols = await conn.listTableColumns(t.name, t.schema)
              else if (conn?.getColumns) cols = await conn.getColumns(t.name, t.schema)
              else if (conn?.listColumns) cols = await conn.listColumns(t.name, t.schema)
              else if (conn?.getTableColumns) cols = await conn.getTableColumns(t.name, t.schema)
              columnsByTable[`${t.schema ? t.schema + '.' : ''}${t.name}`] = (cols || []).map((c: any) => c?.name || c?.columnName || c)
            } catch { /* ignore a single table failure */ }
          }
        }
        this.$root.$emit(AppEvent.aiInlineStep, { id: 'columns', status: 'done' })

        // Fetch CREATE statements for mentioned objects (views, procedures, tables)
        const objectDefinitions: Record<string, string> = {}
        const mentionedObjectsWithTypes: Array<{schema: string, name: string, type: string}> = []
        
        if (mentionedObjects && Array.isArray(mentionedObjects) && mentionedObjects.length > 0) {
          console.log('[CoreTabs] Fetching CREATE statements for mentioned objects:', mentionedObjects)
          
          for (const obj of mentionedObjects) {
            try {
              console.log('[CoreTabs] Processing object:', obj)
              const objKey = `${obj.schema}.${obj.name}`
              const objType = (obj.type || '').toLowerCase()
              console.log(`[CoreTabs] objKey: ${objKey}, objType: ${objType}, connectionType: ${this.connectionType}`)
              
              // Track object types for AI parameter selection
              mentionedObjectsWithTypes.push({
                schema: obj.schema,
                name: obj.name,
                type: objType
              })
              
              // SQL Server: Fetch CREATE statement based on object type
              if (this.connectionType === 'sqlserver') {
                let sql = ''
                
                if (objType === 'view') {
                  // Get view definition
                  sql = `
SELECT m.definition AS create_statement
FROM sys.views v
JOIN sys.schemas s ON v.schema_id = s.schema_id
JOIN sys.sql_modules m ON v.object_id = m.object_id
WHERE s.name = '${obj.schema.replace(/'/g, "''")}' 
  AND v.name = '${obj.name.replace(/'/g, "''")}'`
                } else if (objType === 'procedure') {
                  // Get stored procedure definition
                  sql = `
SELECT m.definition AS create_statement
FROM sys.procedures p
JOIN sys.schemas s ON p.schema_id = s.schema_id
JOIN sys.sql_modules m ON p.object_id = m.object_id
WHERE s.name = '${obj.schema.replace(/'/g, "''")}' 
  AND p.name = '${obj.name.replace(/'/g, "''")}'`
                } else if (objType === 'table') {
                  // Get table CREATE statement with columns, constraints, indexes
                  sql = `
DECLARE @schema sysname = N'${obj.schema.replace(/'/g, "''")}';
DECLARE @table  sysname = N'${obj.name.replace(/'/g, "''")}';

SELECT 
  'CREATE TABLE ' + QUOTENAME(@schema) + '.' + QUOTENAME(@table) + ' (' + CHAR(13) + CHAR(10) +
  STUFF((
    SELECT ',' + CHAR(13) + CHAR(10) + '  ' + 
      QUOTENAME(c.name) + ' ' + 
      t.name + 
      CASE 
        WHEN t.name IN ('varchar', 'nvarchar', 'char', 'nchar') 
        THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(c.max_length AS VARCHAR) END + ')'
        WHEN t.name IN ('decimal', 'numeric') 
        THEN '(' + CAST(c.precision AS VARCHAR) + ',' + CAST(c.scale AS VARCHAR) + ')'
        ELSE ''
      END +
      CASE WHEN c.is_nullable = 0 THEN ' NOT NULL' ELSE ' NULL' END
    FROM sys.columns c
    JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@table))
    ORDER BY c.column_id
    FOR XML PATH(''), TYPE
  ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') + 
  CHAR(13) + CHAR(10) + ')' AS create_statement
FROM sys.tables tb
JOIN sys.schemas s ON tb.schema_id = s.schema_id
WHERE s.name = @schema AND tb.name = @table`
                } else if (objType === 'function') {
                  // Get function definition
                  sql = `
SELECT m.definition AS create_statement
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
JOIN sys.sql_modules m ON o.object_id = m.object_id
WHERE s.name = '${obj.schema.replace(/'/g, "''")}' 
  AND o.name = '${obj.name.replace(/'/g, "''")}'
  AND o.type IN ('FN', 'IF', 'TF')`
                }
                
                if (sql) {
                  console.log(`[CoreTabs] Executing SQL for ${objKey}:`, sql)
                  const q = await conn.executeQuery(sql)
                  console.log(`[CoreTabs] Query result for ${objKey}:`, q)
                  const result = Array.isArray(q) ? q[0] : q
                  console.log(`[CoreTabs] Extracted result for ${objKey}:`, result)
                  const row = result?.rows?.[0]
                  console.log(`[CoreTabs] First row for ${objKey}:`, row)
                  if (row && row.create_statement) {
                    objectDefinitions[objKey] = row.create_statement
                    console.log(`[CoreTabs] Fetched CREATE statement for ${objKey} (${objType})`)
                  } else {
                    console.warn(`[CoreTabs] No CREATE statement found for ${objKey} (${objType}). Row:`, row)
                  }
                }
              }
            } catch (e) {
              console.error(`[CoreTabs] Failed to fetch CREATE statement for ${obj.schema}.${obj.name}:`, e)
            }
          }
        }

        // System object schemas will be fetched by the plugin in a two-phase approach
        // Phase 1: AI requests which system objects it needs
        // Phase 2: We fetch those schemas and AI generates SQL
        const systemObjectSchemas: Record<string, any> = {}

        // Guard: if no tables at all, skip LLM and avoid inserting diagnostic SQL
        const hasAnyTables = Array.isArray(normTables) && normTables.length > 0
        if (!hasAnyTables) {
          try {
            new Noty({
              type: 'warning',
              text: 'Inline AI: No tables/columns available. Open a database or refresh schema to proceed.',
              timeout: 3000,
            }).show()
          } catch {}
          // mark and exit without contacting the plugin
          this.$root.$emit(AppEvent.aiInlineStep, { id: 'insert', status: 'done' })
          this.$root.$emit(AppEvent.aiInlineDone)
          return
        }

        // Ask LLM plugin to generate final SQL using schema-only tools
        const resolvedRequestId = requestId || `inline_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const requestIdToUse = resolvedRequestId
        const previewOnly = !!this.aiChatPending?.[requestIdToUse]?.previewOnly
        this.aiPending[requestIdToUse] = { allowInsert: (aiMode !== 'analysis') && !previewOnly }
        
        // Get query results and errors from active tab (currentQuery already declared above)
        let currentResults: any = null
        let allResults: any[] = []
        let queryError: any = null
        if (tab && tab.tabType === 'query') {
          // currentQuery already set above, now get results
          
          // Get ALL query results if available (for multiple result sets)
          if (tab.results && Array.isArray(tab.results)) {
            allResults = tab.results.map((result: any, index: number) => ({
              resultNumber: index + 1,
              rowCount: result.rows?.length || 0,
              columnCount: result.fields?.length || 0,
              columns: result.fields?.map((f: any) => f.name || f.columnName || f) || [],
              sampleRows: (result.rows || []).slice(0, 5),
            }))
            // Use the last result as the primary one for backward compatibility
            currentResults = allResults[allResults.length - 1] || null
          } else if (tab.result) {
            // Single result (legacy)
            currentResults = {
              resultNumber: 1,
              rowCount: tab.result.rows?.length || 0,
              columnCount: tab.result.fields?.length || 0,
              columns: tab.result.fields?.map((f: any) => f.name || f.columnName || f) || [],
              sampleRows: (tab.result.rows || []).slice(0, 5),
            }
            allResults = [currentResults]
          }
          
          // Get error information if query failed
          // Prefer tab.error (persisted), fallback to component error
          const tabComponent: any = this.$refs[`tab-${tab.id}`]
          const tabError = (tab as any).error || (tabComponent && tabComponent[0] ? tabComponent[0].error : null)
          
          console.log('[CoreTabs] ========== ERROR DETECTION DEBUG ==========')
          console.log('[CoreTabs] hasTabError:', !!(tab as any).error)
          console.log('[CoreTabs] hasComponentError:', !!(tabComponent && tabComponent[0] && tabComponent[0].error))
          console.log('[CoreTabs] tab.error:', (tab as any).error)
          console.log('[CoreTabs] component.error:', tabComponent && tabComponent[0] ? tabComponent[0].error : null)
          console.log('[CoreTabs] finalError:', tabError)
          console.log('[CoreTabs] finalError.message:', tabError ? tabError.message : 'NO ERROR')
          console.log('[CoreTabs] ===============================================')
          
          if (tabError) {
            queryError = {
              message: tabError.message || String(tabError),
              code: tabError.code || null,
              line: tabError.line || null,
              position: tabError.position || null,
            }
          }
        }
        
        // Build schema context to send to plugin
        const schemaContext = {
          database: activeDb || null,
          tables: tablesToFetch.map(t => ({
            name: t.name,
            schema: t.schema || null,
            columns: columnsByTable[`${t.schema ? t.schema + '.' : ''}${t.name}`] || []
          })),
          currentQuery: currentQuery || null,
          currentResults: currentResults || null,
          allResults: allResults.length > 0 ? allResults : null,
          queryError: queryError || null,
          objectDefinitions: Object.keys(objectDefinitions).length > 0 ? objectDefinitions : null, // CREATE statements for mentioned objects
          systemObjectSchemas: Object.keys(systemObjectSchemas).length > 0 ? systemObjectSchemas : null, // System DMV/procedure schemas for slash commands
          mentionedObjectsWithTypes: mentionedObjectsWithTypes.length > 0 ? mentionedObjectsWithTypes : null, // Object types for parameter selection
        }
        const payload = {
          type: 'bks-ai/inline-code/request',
          requestId: requestIdToUse,
          mode: 'code',
          schemaOnly: true,
          prompt,
          command: command || null, // Slash command (e.g., 'fix-index', 'sp-blitz')
          mentions: mentions || [], // @ mentions (e.g., ['Sales.Orders', 'dbo.Customers'])
          context: schemaContext,
          runAfterInsert: !!runAfterInsert,
          aiMode: aiMode || 'developer', // Pass AI mode (developer/dba)
        }
        try { console.log('[InlineAI] context being sent to plugin', { 
          tableCount: schemaContext.tables.length, 
          tables: schemaContext.tables.map(t => `${t.schema ? t.schema + '.' : ''}${t.name}`).slice(0, 5),
          tablesWithColumns: Object.keys(columnsByTable),
          hasCurrentQuery: !!currentQuery,
          queryLength: currentQuery.length,
          currentQueryPreview: currentQuery.substring(0, 100),
          hasResults: !!currentResults,
          resultRowCount: currentResults?.rowCount || 0,
          totalResultSets: allResults.length,
          hasError: !!queryError,
          errorMessage: queryError?.message || null,
          objectDefinitionsCount: Object.keys(objectDefinitions).length,
          objectDefinitions: Object.keys(objectDefinitions)
        }) } catch {}
        // Step: Insert SQL -> pending (await plugin)
        this.$root.$emit(AppEvent.aiInlineStep, { id: 'insert', status: 'pending' })
        const w = this.getBksAiShellWindow()
        try { console.log('[InlineAI] posting request', { target: w ? 'iframe' : 'window', requestId: requestIdToUse, hasIframe: !!w, payload }) } catch {}
        if (w) w.postMessage(payload, '*')
        else window.postMessage(payload, '*')

        // Fallback after timeout if plugin does not respond
        // Increased to 30 seconds to allow AI more time to process complex queries
        setTimeout(() => {
          if (!this.aiPending[requestIdToUse]) return
          delete this.aiPending[requestIdToUse]
          if (this.aiChatPending[requestIdToUse]) {
            delete this.aiChatPending[requestIdToUse]
          }
          try { console.log('[InlineAI] timeout with no plugin reply; skipping preview insert', { requestId: requestIdToUse }) } catch {}
          // Step: Insert SQL -> done (fallback)
          this.$root.$emit(AppEvent.aiInlineStep, { id: 'insert', status: 'done' })
          this.$root.$emit(AppEvent.aiInlineDone)
        }, 30000)

        // Keep input open; InlineAICommand clears its input on submit
      } catch (e) {
        const msg = (e && (e as any).message) || 'Inline AI failed'
        this.$noty && this.$noty.error ? this.$noty.error(msg) : console.error(msg)
      }
    },
    async fetchSystemObjectSchemas(systemObjects: string[]): Promise<Record<string, any>> {
      const schemas: Record<string, any> = {}
      const conn: any = this.connection as any
      
      if (!conn || this.connectionType !== 'sqlserver') {
        try { console.warn('[CoreTabs] Cannot fetch system schemas: not SQL Server or no connection') } catch {}
        return schemas
      }
      
      for (const sysObj of systemObjects) {
        try {
          // Parse database.schema.object (e.g., "msdb.dbo.backupset") or schema.object (e.g., "sys.dm_exec_query_stats")
          const parts = sysObj.split('.')
          const database = parts.length === 3 ? parts[0] : null
          const schema = parts.length === 3 ? parts[1] : (parts.length === 2 ? parts[0] : 'sys')
          const objectName = parts.length === 3 ? parts[2] : (parts.length === 2 ? parts[1] : parts[0])
          const dbPrefix = database ? `[${database}].` : ''
          
          // First, detect object type from sys.objects
          const objectTypeSql = `
SELECT 
  o.type AS object_type,
  o.type_desc AS object_type_desc
FROM ${dbPrefix}sys.all_objects o
JOIN ${dbPrefix}sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${schema}'
  AND o.name = '${objectName}'`
          
          try { console.log(`[CoreTabs] Fetching object type for ${sysObj}`) } catch {}
          const typeResult = await conn.executeQuery(objectTypeSql)
          const typeRows = Array.isArray(typeResult) ? typeResult[0]?.rows : typeResult?.rows
          
          let objectType = null
          let objectTypeDesc = null
          
          if (typeRows && typeRows.length > 0) {
            objectType = typeRows[0].object_type?.trim()
            objectTypeDesc = typeRows[0].object_type_desc?.trim()
            try { console.log(`[CoreTabs] Object type for ${sysObj}: ${objectType} (${objectTypeDesc})`) } catch {}
          }

          // Fetch parameter signature for procedures and functions (including TVFs)
          // This prevents the AI from guessing argument counts/types.
          let parameters: any[] = []
          try {
            const paramSql = `
SELECT 
  p.parameter_id,
  p.name AS parameter_name,
  t.name AS data_type,
  p.max_length,
  p.precision,
  p.scale,
  p.is_output
FROM ${dbPrefix}sys.parameters p
JOIN ${dbPrefix}sys.types t ON p.user_type_id = t.user_type_id
JOIN ${dbPrefix}sys.all_objects o ON p.object_id = o.object_id
JOIN ${dbPrefix}sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${schema}'
  AND o.name = '${objectName}'
  AND o.type IN ('P', 'PC', 'X', 'IF', 'TF', 'FN', 'FS', 'FT')
ORDER BY p.parameter_id`

            const paramResult = await conn.executeQuery(paramSql)
            const paramRows = Array.isArray(paramResult) ? paramResult[0]?.rows : paramResult?.rows
            if (paramRows && paramRows.length > 0) {
              parameters = paramRows.map((row: any) => ({
                name: row.parameter_name,
                type: row.data_type,
                maxLength: row.max_length,
                precision: row.precision,
                scale: row.scale,
                isOutput: row.is_output,
              }))
              try { console.log(`[CoreTabs] Fetched ${paramRows.length} parameters for ${sysObj}`) } catch {}
            }
          } catch (e) {
            try { console.warn(`[CoreTabs] Parameter fetch failed for ${sysObj}`, e) } catch {}
          }
          
          // Fetch column information for views/tables/functions
          const sql = `
SELECT 
  c.name AS column_name,
  t.name AS data_type,
  c.max_length,
  c.precision,
  c.scale,
  c.is_nullable
FROM ${dbPrefix}sys.all_columns c
JOIN ${dbPrefix}sys.types t ON c.user_type_id = t.user_type_id
JOIN ${dbPrefix}sys.all_objects o ON c.object_id = o.object_id
JOIN ${dbPrefix}sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${schema}'
  AND o.name = '${objectName}'
ORDER BY c.column_id`
          
          try { console.log(`[CoreTabs] Fetching schema for ${sysObj}`) } catch {}
          const result = await conn.executeQuery(sql)
          const rows = Array.isArray(result) ? result[0]?.rows : result?.rows
          
          if (rows && rows.length > 0) {
            // Determine friendly object type
            let friendlyType = 'view'
            if (objectType === 'V') friendlyType = 'view'
            else if (objectType === 'U') friendlyType = 'table'
            else if (objectType === 'IF') friendlyType = 'inline_table_valued_function'
            else if (objectType === 'TF') friendlyType = 'table_valued_function'
            else if (objectType === 'FN') friendlyType = 'scalar_function'
            else if (objectTypeDesc && objectTypeDesc.includes('FUNCTION')) friendlyType = 'function'
            
            schemas[sysObj] = {
              objectType: friendlyType,
              objectTypeCode: objectType,
              objectTypeDesc: objectTypeDesc,
              parameters: parameters.length ? parameters : undefined,
              columns: rows.map((row: any) => ({
                name: row.column_name,
                type: row.data_type,
                maxLength: row.max_length,
                precision: row.precision,
                scale: row.scale,
                nullable: row.is_nullable,
              }))
            }
            try { console.log(`[CoreTabs] Fetched ${rows.length} columns for ${sysObj} (${friendlyType})`) } catch {}
          } else {
            // For stored procedures, fetch parameter information
            const procSql = `
SELECT 
  p.name AS parameter_name,
  t.name AS data_type,
  p.max_length,
  p.precision,
  p.scale,
  p.is_output
FROM ${dbPrefix}sys.parameters p
JOIN ${dbPrefix}sys.types t ON p.user_type_id = t.user_type_id
JOIN ${dbPrefix}sys.all_objects o ON p.object_id = o.object_id
JOIN ${dbPrefix}sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${schema}'
  AND o.name = '${objectName}'
  AND o.type IN ('P', 'PC', 'X')
ORDER BY p.parameter_id`
            
            const procResult = await conn.executeQuery(procSql)
            const procRows = Array.isArray(procResult) ? procResult[0]?.rows : procResult?.rows
            
            if (procRows && procRows.length > 0) {
              schemas[sysObj] = {
                objectType: 'stored_procedure',
                objectTypeCode: objectType,
                objectTypeDesc: objectTypeDesc,
                parameters: procRows.map((row: any) => ({
                  name: row.parameter_name,
                  type: row.data_type,
                  maxLength: row.max_length,
                  precision: row.precision,
                  scale: row.scale,
                  isOutput: row.is_output,
                }))
              }
              try { console.log(`[CoreTabs] Fetched ${procRows.length} parameters for procedure ${sysObj}`) } catch {}
            }
          }
        } catch (e) {
          try { console.error(`[CoreTabs] Failed to fetch schema for ${sysObj}:`, e) } catch {}
        }
      }
      
      return schemas
    },
    getBksAiShellWindow() {
      try {
        const frames = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[]
        try { console.log('[InlineAI] searching for bks-ai-shell iframe, total iframes:', frames.length) } catch {}
        const match = frames.find(f => {
          try {
            const src = (f.getAttribute('src') || f.src || '').toString()
            const isMatch = src.includes('plugin://bks-ai-shell') || src.includes('/bks-ai-shell/')
            if (isMatch) try { console.log('[InlineAI] found bks-ai-shell iframe', { src }) } catch {}
            return isMatch
          } catch { return false }
        })
        if (!match) try { console.warn('[InlineAI] bks-ai-shell iframe not found') } catch {}
        return match?.contentWindow || null
      } catch (err) {
        try { console.error('[InlineAI] error finding iframe', err) } catch {}
        return null
      }
    },
    insertSqlIntoActiveQuery(sqlText, replaceMode = false) {
      try {
        const tab = this.activeTab
        if (!tab || tab.tabType !== 'query') {
          this.$noty && this.$noty.info ? this.$noty.info('Open a Query tab to insert SQL') : console.log('Open a Query tab to insert SQL')
          return
        }
        const existing = tab.unsavedQueryText || ''
        
        if (replaceMode) {
          // Replace mode: replace the entire query
          tab.unsavedQueryText = `${sqlText}\n`
          try { console.log('[InlineAI] REPLACED tab.unsavedQueryText', { oldLength: existing.length, newLength: tab.unsavedQueryText.length, sql: sqlText }) } catch {}
        } else {
          // Append mode: add to the end
          const needsNl = existing && !existing.endsWith('\n') ? '\n' : ''
          tab.unsavedQueryText = `${existing}${needsNl}${sqlText}\n`
          try { console.log('[InlineAI] APPENDED to tab.unsavedQueryText', { existingLength: existing.length, newLength: tab.unsavedQueryText.length, sql: sqlText }) } catch {}
        }
        
        // Persist change to store so TabQueryEditor watcher syncs text
        this.$store.dispatch('tabs/save', tab)
      } catch (e) {
        console.error('Failed to insert SQL', e)
      }
    },
    showUpgradeModal() {
      this.$root.$emit(AppEvent.upgradeModal)
    },
    completeDeleteAction() {
      const { schema, name: dbName, entityType } = this.dbDeleteElementParams
      if (entityType !== 'table' && this.dbAction == 'truncate') {
        this.$noty.warning("Sorry, you can only truncate tables.")
        return;
      }
      this.$modal.hide(this.modalName)
      this.$nextTick(async () => {
        try {
          if (this.dbAction.toLowerCase() === 'drop') {
            await this.connection.dropElement(dbName, entityType?.toUpperCase(), schema);
            // timeout is more about aesthetics so it doesn't refresh the table right away.

              setTimeout(() => {
                this.$store.dispatch('updateTables')
                this.$store.dispatch('updateRoutines')
              }, 500)
            }

          // TODO (@day): is this right?
          if (this.dbAction.toLowerCase() === 'truncate') {
            await this.connection.truncateElement(dbName, entityType?.toUpperCase(), schema);
          }

          this.$noty.success(`${this.dbAction} completed successfully`)

        } catch (ex) {
          this.$noty.error(`Error performing ${this.dbAction}: ${ex.message}`)
        }
      })
    },
    async duplicateTableSql() {
      const { tableName, schema, entityType } = this.dbDuplicateTableParams

      if (entityType !== 'table' && this.dbAction == 'duplicate') {
        this.$noty.warning("Sorry, you can only duplicate tables.")
        return;
      }

      if (tableName === this.duplicateTableName) {
        this.$noty.warning("Sorry, you can't duplicate with the same name.")
        return;
      }

      if (this.duplicateTableName === null || this.duplicateTableName === '' || this.duplicateTableName === undefined) {
        this.$noty.warning("Please enter a name for the new table.")
        return;
      }

      try {
        const sql = await this.connection.duplicateTableSql(tableName, this.duplicateTableName, schema);
        const formatted = safeFormat(sql, { language: FormatterDialect(this.dialect) })

        const tab = {} as TransportOpenTab;
        tab.tabType = 'query';
        tab.unsavedQueryText = formatted
        tab.title = `Duplicating table: ${tableName}`
        tab.active = true
        tab.unsavedChanges = false
        tab.alert = false
        tab.position = 99

        await this.addTab(tab)

      } catch (ex) {
        this.$noty.error(`Error printing ${this.dbAction} query: ${ex.message}`)
      } finally {
        this.$modal.hide(this.duplicateTableModal)
      }
    },
    async duplicateTable() {
      const { tableName, schema, entityType } = this.dbDuplicateTableParams

      if (entityType !== 'table' && this.dbAction == 'duplicate') {
        this.$noty.warning("Sorry, you can only duplicate tables.")
        return;
      }

      if (tableName === this.duplicateTableName) {
        this.$noty.warning("Sorry, you can't duplicate with the same name.")
        return;
      }

      if (this.duplicateTableName === null || this.duplicateTableName === '' || this.duplicateTableName === undefined) {
        this.$noty.warning("Please enter a name for the new table.")
        return;
      }

      this.$modal.hide(this.duplicateTableModal)

      this.$nextTick(async () => {
        try {
          if (this.dbAction.toLowerCase() !== 'duplicate') {
            return
          }

          await this.connection.duplicateTable(tableName, this.duplicateTableName, schema);

          // timeout is more about aesthetics so it doesn't refresh the table right away.
          setTimeout(() => {
            this.$store.dispatch('updateTables')
            this.$store.dispatch('updateRoutines')
          }, 500)


          this.$noty.success(`${this.dbAction} completed successfully`)

        } catch (ex) {
          this.$noty.error(`Error performing ${this.dbAction}: ${ex.message}`)
        } finally {
          this.duplicateTableName = null
          this.dbDuplicateTableParams = null
        }
      })
    },
    beforeOpened() {
      this.lastFocused = document.activeElement
    },
    sureOpened() {
      this.sureOpen = true
      if (this.$refs.duplicateTableNameInput) {
        (this.$refs.duplicateTableNameInput as HTMLInputElement).focus()
      } else if (this.$refs.no) {
        (this.$refs.no as HTMLElement).focus()
      }
    },
    sureClosed() {
      this.sureOpen = false
      if (this.lastFocused) {
        this.lastFocused.focus()
      }
    },
    handleDeleteButtonFocusout() {
      if (this.sureOpen && this.$refs.no) {
        (this.$refs.no as HTMLElement).focus()
      }
    },
    openContextMenu(event, item) {
      this.contextEvent = { event, item }
    },
    async setActiveTab(tab: TransportOpenTab) {
      const switchingTab = tab.id !== this.activeTab?.id
      if (switchingTab) {
        this.trigger(AppEvent.switchingTab, tab)
      }
      await this.$store.dispatch('tabs/setActive', tab)
      if (switchingTab) {
        this.trigger(AppEvent.switchedTab, tab)
      }
    },
    async addTab(item: TransportOpenTab) {
      const savedItem = await this.$store.dispatch('tabs/add', { item, endOfPosition: true })
      await this.setActiveTab(savedItem)
    },
    async reopenLastClosedTab() {
      await this.$store.dispatch("tabs/reopenLastClosedTab")
    },
    nextTab() {
      if (this.activeTab == this.lastTab) {
        this.setActiveTab(this.firstTab)
      } else {
        this.setActiveTab(this.tabItems[this.activeIdx + 1])
      }
    },

    previousTab() {
      if (this.activeTab == this.firstTab) {
        this.setActiveTab(this.lastTab)
      } else {
        this.setActiveTab(this.tabItems[this.activeIdx - 1])
      }
    },
    closeCurrentTab(_id?:number, options?: CloseTabOptions) {
      if (this.activeTab) this.close(this.activeTab, options)
    },
    async createTab(config: TabTypeConfig.Config) {
      if (config.type === "query") {
        this.createQuery()
      } else if (config.type === "shell") {
        this.createShell()
      } else if (config.type === "plugin-shell" || config.type === "plugin-base") {
        let tNum = 0;
        let title = config.name;
        do {
          tNum = tNum + 1;
          title = `${config.name} #${tNum}`;
        } while (this.tabItems.filter((t) => t.title === title).length > 0);

        const tab = {
          tabType: config.type,
          title,
          unsavedChanges: false,
          context: {
            pluginId: config.pluginId,
            pluginTabTypeId: config.pluginTabTypeId,
            command: config.menuItem?.command,
            params: config.menuItem?.params,
          },
        } as TransportPluginTab;
        await this.addTab(tab)
      }
    },
    async createShell() {
      let sNum = 0;
      let tabName = "Shell";
      do {
        sNum = sNum + 1;
        tabName = `Shell #${sNum}`;
      } while (this.tabItems.filter((t) => t.title === tabName).length > 0);

      const result = {} as TransportOpenTab;
      result.tabType = 'shell';
      result.title = tabName;
      result.unsavedChanges = false;
      await this.addTab(result);
    },
    async createQuery(optionalText, queryTitle?) {
      // const text = optionalText ? optionalText : ""
      console.log("Creating tab")
      let qNum = 0
      let tabName = "New Query"
      if (queryTitle) {
        tabName = queryTitle
      } else {
        do {
          qNum = qNum + 1
          tabName = `Query #${qNum}`
        } while (this.tabItems.filter((t) => t.title === tabName).length > 0);
      }

      const result = {} as TransportOpenTab;
      result.tabType = 'query'
      result.title = tabName,
      result.unsavedChanges = false
      result.unsavedQueryText = optionalText
      await this.addTab(result)
    },
    async loadTableCreate(table) {
      let method = null
      if (table.entityType === 'table') method = 'getTableCreateScript'
      else if (table.entityType === 'view') method = 'getViewCreateScript'
      else if (table.entityType === 'materialized-view') method = 'getMaterializedViewCreateScript'
      if (!method) {
        this.$noty.error(`Can't find script for ${table.name} (${table.entityType})`)
        return
      }
      try {
        const result = await this.connection[method](table.name, table.schema);
        const stringResult = safeFormat(_.isArray(result) ? result[0] : result, { language: FormatterDialect(this.dialect) })
        this.createQuery(stringResult)
      } catch (ex) {
        this.$noty.error(`An error occured while loading the SQL for '${table.name}' - ${ex.message}`)
        throw ex
      }

    },
    dropDatabaseElement({ item: dbActionParams, action: dbAction }) {
      this.dbElement = dbActionParams.name || dbActionParams.schema
      this.dbAction = dbAction
      this.dbEntityType = dbActionParams.entityType || 'schema'
      this.dbDeleteElementParams = dbActionParams

      this.$modal.show(this.modalName)
    },
    importExportTables() {
      // we want this to open a tab with the schema and tables open
      const t: Partial<TransportOpenTab> = { 
        tabType: 'import-export-database',
        title: `Data Export`,
        unsavedChanges: false
      }
      const existing = this.tabItems.find((tab) => matches(tab, t as TransportOpenTab))
      if (existing) return this.$store.dispatch('tabs/setActive', existing)
      this.addTab(t as TransportOpenTab)
    },
    backupDatabase() {
      const t: Partial<TransportOpenTab> = { 
        tabType: 'backup',
        title: 'Backup',
        unsavedChanges: false
      }
      const existing = this.tabItems.find((tab) => matches(tab, t as TransportOpenTab));
      if (existing) return this.$store.dispatch('tabs/setActive', existing);
      this.addTab(t as TransportOpenTab);
    },
    beginImport(data: any = {}) {
      const { table } = data
      if (table && table.entityType !== 'table') {
        this.$noty.error("You can only import data into a table")
        return;
      }
      const t: Partial<TransportOpenTab> = { 
        tabType: 'import-table',
        title: table ? `Import Table: ${table.name}` : 'Create Table and Import Data',
        unsavedChanges: false,
        ...(table && {
          schemaName: table.schema,
          tableName: table.name
        })
      }
      const existing = this.tabItems.find(tab => matches(tab, t as TransportOpenTab))
      if (existing) return this.$store.dispatch('tabs/setActive', existing)
      this.addTab(t as TransportOpenTab)
    },
    restoreDatabase() {
      const t: Partial<TransportOpenTab> = { 
        tabType: 'restore',
        title: 'Restore',
        unsavedChanges: false
      }
      const existing = this.tabItems.find((tab) => matches(tab, t as TransportOpenTab));
      if (existing) return this.$store.dispatch('tabs/setActive', existing);
      this.addTab(t as TransportOpenTab);
    },
    openStatistics({ data }) {
      const t: Partial<TransportOpenTab> = { 
        tabType: 'statistics',
        title: 'Statistics Parser',
        unsavedChanges: false,
        statsData: data || ''
      }
      // Always create a new statistics tab
      this.addTab(t as TransportOpenTab);
    },
    openExecutionPlan() {
      const t: Partial<TransportOpenTab> = { 
        tabType: 'executionplan',
        title: 'Execution Plan Viewer',
        unsavedChanges: false,
        planXml: ''
      }
      // Always create a new execution plan tab
      this.addTab(t as TransportOpenTab);
    },
    duplicateDatabaseTable({ item: dbActionParams, action: dbAction }) {
      this.dbElement = dbActionParams.name
      this.dbAction = dbAction
      this.dbEntityType = dbActionParams.entityType

      this.duplicateTableName = `${dbActionParams.name}_copy`

      this.dbDuplicateTableParams = {
        tableName: dbActionParams.name,
        schema: dbActionParams.schema,
        entityType: dbActionParams.entityType
      }

      this.$modal.show(this.duplicateTableModal)
    },
    async handleDropzoneDrop(event: DropzoneDropEvent) {
      const files = event.files.map((file) => ({
        file,
        error: false,
      }))

      if (!files.every(({ file }) => file.name.endsWith('.sql'))) {
        this.$noty.error('Only .sql files are supported')
        return
      }

      let readerAbort: () => void;
      let aborted  = false;

      function abort() {
        if (typeof readerAbort === 'function') {
          readerAbort()
        }
        aborted = true
      }

      const notyQueue = 'load-queries'
      const notyText = `Loading <span class="counter">1</span> of ${files.length} files`

      const noty = this.$noty.info(notyText,  {
        queue: notyQueue,
        allowRawHtml: true,
        buttons: [
          Noty.button('Abort', 'btn btn-danger', abort)
        ],
      })

      const counter = noty.barDom.querySelector('.counter')

      for (let i = 0; i < files.length; i++) {
        if (aborted) {
          break
        }

        counter.textContent = `${i + 1}`

        const file = files[i].file

        const reader = readWebFile(file)
        readerAbort = reader.abort

        try {
          const text = await reader.result
          if (text) {
            this.$root.$emit(AppEvent.newTab, text);
          } else {
            files[i].error = true
          }
        } catch (e) {
          if (e.message.includes(/abort/)) {
            break
          } else {
            files[i].error = true
          }
        }
      }

      if (aborted) {
        this.$noty.info('Loading aborted', { killer: notyQueue })
      } else if (files.some(({ error }) => error)) {
        this.$noty.error('Some files could not be loaded', { killer: notyQueue })
      } else {
        this.$noty.success('All files loaded', { killer: notyQueue })
      }

      noty.close()
    },
    async importSqlFiles(paths: string[]) {
      const files = paths.map((path) => ({
        path,
        name: path.replace(/^.*[\\/]/, '').replace(/\.sql$/, ''),
        error: false,
      }))

      let readerAbort: () => void;
      let aborted  = false;

      function abort() {
        if (typeof readerAbort === 'function') {
          readerAbort()
        }
        aborted = true
      }

      const notyQueue = 'load-queries'
      const notyText = `Loading <span class="counter">1</span> of ${files.length} files`

      const noty = this.$noty.info(notyText,  {
        queue: notyQueue,
        allowRawHtml: true,
        buttons: [
          Noty.button('Abort', 'btn btn-danger', abort)
        ],
      })

      const counter = noty.barDom.querySelector('.counter')

      for (let i = 0; i < files.length; i++) {
        if (aborted) {
          break
        }

        const file = files[i]

        counter.textContent = `${i + 1}`

        try {
          // TODO (azmi): this process can take longer by accident. Consider
          // an ability to cancel reading file.
          const text = await this.$util.send('file/read', { path: file.path, options: { encoding: 'utf8', flag: 'r' }})
          if (text) {
            const query = await this.$util.send('appdb/query/new');
            query.title = file.name
            query.text = text
            await this.$store.dispatch('data/queries/save', query)
          } else {
            files[i].error = true
          }
        } catch (e) {
            files[i].error = true
        }
      }

      if (aborted) {
        this.$noty.info('Loading aborted', { killer: notyQueue })
      } else if (files.some(({ error }) => error)) {
        this.$noty.error('Some files could not be loaded', { killer: notyQueue })
      } else {
        this.$noty.success('All files loaded', { killer: notyQueue })
      }
    },
    async handlePromptQueryExport(query) {
      const safeFilename = query.title.replace(/[/\\?%*:|"<>]/g, '_');
      const fileName = `${safeFilename}.sql`;

      const lastExportPath = await Vue.prototype.$settings.get("lastExportPath", await window.main.defaultExportPath(fileName));

      const filePath = this.$native.dialog.showSaveDialogSync({
        title: "Export Query",
        defaultPath: lastExportPath,
        filters: [
          { name: 'SQL (*.sql)', extensions: ['sql'] },
          { name: 'All Files (*.*)', extensions: ['*'] },
        ],
      })

      // do nothing if canceled
      if (!filePath) return

      const notyQueue = 'export-query'
      this.$noty.info('Exporting query',  { queue: notyQueue })

      try {
        await this.$util.send('file/write', { path: filePath, text: query.text, options: { encoding: 'utf8' }})
        this.$noty.success('Query exported!', { killer: notyQueue })
      } catch (e) {
        console.error(e)
        this.$noty.error('Query could not be exported. See console for details.', { killer: notyQueue })
      }
    },
    async loadRoutineCreate(routine) {
      const result = await this.connection.getRoutineCreateScript(routine.name, routine.type, routine.schema);
      const stringResult = safeFormat(_.isArray(result) ? result[0] : result, { language: FormatterDialect(this.dialect) })
      this.createQuery(stringResult);
    },
    switchUserKeymap(value) {
      this.$store.dispatch('settings/save', { key: 'keymap', value: value });
    },
    openTableBuilder() {
      if (this.connectionType === 'mongodb') {
        this.$root.$emit(AppEvent.openCreateCollectionModal);
        return;
      }
      const tab = {} as TransportOpenTab;
      tab.tabType = 'table-builder';
      tab.title = "New Table"
      tab.unsavedChanges = true
      this.addTab(tab)
    },
    openTableProperties({ table }) {
      const t = {} as TransportOpenTab;
      t.tabType = 'table-properties';
      t.tableName = table.name ?? table.tableName
      t.schemaName = table.schema ?? table.schemaName
      t.title = table.name ?? table.tableName
      t.context = {
        ...(t.context || {}),
        database: this.database,
        table: { ...table, columns: (table?.columns || []) },
      }
      const existing = this.tabItems.find((tab) => matches(tab, t))
      if (existing) return this.$store.dispatch('tabs/setActive', existing)
      this.addTab(t)
    },
    async openTable({ table, filters }) {
      let tab = {} as TransportOpenTab;
      tab.tabType = 'table';
      tab.title = table.name ?? table.tableName
      tab.tableName = table.name ?? table.tableName
      tab.schemaName = table.schema ?? table.schemaName
      tab.entityType = table.entityType
      tab.context = {
        ...(tab.context || {}),
        database: this.database,
        table: { ...table, columns: (table?.columns || []) },
      }
      tab = setFilters(tab, filters)
      tab.titleScope = "all"
      let existing = this.tabItems.find((t) => matches(t, tab))
      if (existing) {
        if (filters) {
          existing = setFilters(existing, filters)
        }
        await this.$store.dispatch('tabs/setActive', existing)
      } else {
        await this.addTab(tab)
      }
    },
    openExportModal(options) {
      this.tableExportOptions = options
      this.showExportModal = true
    },
    toggleHideEntity(entity: DatabaseEntity, hide: boolean) {
      if (hide) this.$store.dispatch('hideEntities/addEntity', entity)
      else this.$store.dispatch('hideEntities/removeEntity', entity)
    },
    toggleHideSchema(schema: string, hide: boolean) {
      if (hide) this.$store.dispatch('hideEntities/addSchema', schema)
      else this.$store.dispatch('hideEntities/removeSchema', schema)
    },
    openSettings() {
      const tab = {} as TransportOpenTab
      tab.tabType = 'settings'
      tab.title = "Settings"
      this.addTab(tab)
    },
    async click(tab) {
      await this.setActiveTab(tab)

    },
    handleSwitchTab(n: number) {
      const tab = this.tabItems[n]
      if(tab) this.setActiveTab(tab)
    },
    async close(tab: TransportOpenTab, options?: CloseTabOptions) {
      if (tab.unsavedChanges && !options?.ignoreUnsavedChanges) {
        this.closingTab = tab
        const confirmed = await this.$confirmById(this.confirmModalId);
        this.closingTab = null
        if (!confirmed) return
      }

      this.trigger(AppEvent.closingTab, tab)

      if (this.activeTab === tab) {
        if (tab === this.lastTab) {
          this.previousTab()
        } else {
          this.nextTab()
        }
      }
      await this.$store.dispatch("tabs/remove", tab)
      if (tab.queryId) {
        await this.$store.dispatch('data/queries/reload', tab.queryId)
      }

      const { schemaName, tabType, tableName } = tab;
      const closingSidebarItem = `${tabType}.${schemaName}.${tableName}`;
      if(closingSidebarItem === this.selectedSidebarItem){
        this.$store.commit('selectSidebarItem', null);
      }
    },
    async forceClose(tab: TransportOpenTab) {
      // ensure the tab is active
      this.$store.dispatch('tabs/setActive', tab);
      switch (tab.tabType) {
        case 'backup':
        case 'restore':
          break;
        default:
          console.log('No force close behaviour defined for tab type')
      }
      await this.close(tab);
    },
    async closeAll() {
      const unsavedTabs = this.tabs.filter((tab) => tab.unsavedChanges)
      if (unsavedTabs.length > 0) {
        const confirmed = await this.$confirm(
          'Close all tabs?',
          `You have ${unsavedTabs.length} unsaved ${window.main.pluralize('tab', unsavedTabs.length)}. Are you sure?`
        )
        if (!confirmed) return
      }
      this.$store.dispatch('tabs/unload')
    },
    async closeOther(tab: TransportOpenTab) {
      const others = _.without(this.tabItems, tab)
      const unsavedTabs = others.filter((t) => t.unsavedChanges)
      if (unsavedTabs.length > 0) {
        const confirmed = await this.$confirm(
          'Close other tabs?',
          `You have ${unsavedTabs.length} unsaved ${window.main.pluralize('tab', unsavedTabs.length)}. Are you sure?`
        )
        if (!confirmed) return
      }

      this.$store.dispatch('tabs/remove', others)
      this.setActiveTab(tab)
      if (tab.queryId) {
        this.$store.dispatch('data/queries/reload', tab.queryId)
      }
    },
    async closeToRight(tab: TransportOpenTab) {
      const tabIndex = _.indexOf(this.tabItems, tab)
      const activeTabIndex = _.indexOf(this.tabItems, this.activeTab)

      const tabsToRight = this.tabItems.slice(tabIndex + 1)
      const unsavedTabs = tabsToRight.filter((t) => t.unsavedChanges)
      if (unsavedTabs.length > 0) {
        const confirmed = await this.$confirm(
          'Close tabs to the right?',
          `You have ${unsavedTabs.length} unsaved ${window.main.pluralize('tab', unsavedTabs.length)} to be closed. Are you sure?`
        )
        if (!confirmed) return
      }

      if (this.activeTab && activeTabIndex > tabIndex) {
        this.setActiveTab(tab)
      }

      this.$store.dispatch('tabs/remove', tabsToRight)
    },
    duplicate(other: TransportOpenTab) {
      const tab = duplicate(other);

      if (tab.tabType === 'query') {
        tab.title = "Query #" + (this.tabItems.length + 1)
        tab.unsavedChanges = true
      }
      this.addTab(tab)
    },
    favoriteClick(item) {
      const tab = {} as TransportOpenTab
      tab.tabType = 'query'
      tab.title = item.title
      tab.queryId = item.id
      tab.unsavedChanges = false

      const existing = this.tabItems.find((t) => matches(t, tab))
      if (existing) return this.$store.dispatch('tabs/setActive', existing)

      this.addTab(tab)

    },
    createQueryFromItem(item) {
      this.createQuery(item.text ?? item.unsavedQueryText, item.title ?? null)
    },
    copyName(item) {
      if (item.tabType !== 'table' && item.tabType !== "table-properties") return;
      this.$copyText(item.tableName)
    },
    handleReloadPluginView(tab) {
      this.reloader = {
        ...this.reloader,
        [tab.id]: Date.now(),
      }
    },
    async handleRequestDatabaseObjects() {
      // Load ALL database objects for @ mentions autocomplete
      try {
        const conn: any = this.connection as any
        const objects: any[] = []
        const isSqlServer = this.connectionType === 'sqlserver' || this.dialect === 'mssql'
        
        // Get tables (exclude views)
        let tables: any[] = []
        if (Array.isArray(this.$store.state.tables) && this.$store.state.tables.length) {
          tables = this.$store.state.tables
        } else if (conn?.listTables) {
          tables = await conn.listTables(null)
        } else if (conn?.getTables) {
          tables = await conn.getTables()
        }
        
        // Filter out views from tables (views should not be in tables list)
        tables.forEach((t: any) => {
          const name = t?.name || t?.tableName || t
          const schema = t?.schema || t?.tableSchema || t?.schemaName || 'dbo'
          // Only add if it's not a view (views are handled separately)
          if (t?.entityType !== 'view' && t?.type !== 'view') {
            objects.push({
              name: name,
              schema: schema,
              type: 'table'
            })
          }
        })
        
        // Get views
        if (conn?.listViews) {
          try {
            const views = await conn.listViews(null)
            views.forEach((v: any) => {
              objects.push({
                name: v?.name || v?.viewName || v,
                schema: v?.schema || v?.viewSchema || v?.schemaName || 'dbo',
                type: 'view'
              })
            })
          } catch { /* ignore */ }
        }
        
        // Get stored procedures and functions
        if (conn?.listRoutines) {
          try {
            const routines = await conn.listRoutines(null)
            routines.forEach((r: any) => {
              objects.push({
                name: r?.name || r?.routineName || r,
                schema: r?.schema || r?.routineSchema || r?.schemaName || 'dbo',
                type: r?.type === 'FUNCTION' ? 'function' : 'procedure'
              })
            })
          } catch { /* ignore */ }
        }
        
        // For SQL Server: Get indexes, constraints, triggers, and more via DMVs
        if (isSqlServer && conn?.executeQuery) {
          try {
            // Get all indexes
            const indexSql = `
              SELECT 
                SCHEMA_NAME(t.schema_id) AS schema_name,
                t.name AS table_name,
                i.name AS index_name,
                i.type_desc
              FROM sys.indexes i
              INNER JOIN sys.tables t ON i.object_id = t.object_id
              WHERE i.name IS NOT NULL
              ORDER BY schema_name, table_name, index_name
            `
            const indexResults = await conn.executeQuery(indexSql)
            if (indexResults && indexResults[0]?.rows) {
              indexResults[0].rows.forEach((row: any) => {
                objects.push({
                  name: row.index_name,
                  schema: row.schema_name,
                  type: 'index',
                  parentTable: `${row.schema_name}.${row.table_name}`,
                  indexType: row.type_desc
                })
              })
            }
          } catch (e) {
            console.warn('Failed to load indexes:', e)
          }
          
          try {
            // Get all constraints (PK, FK, UQ, CHECK, DEFAULT)
            const constraintSql = `
              SELECT 
                SCHEMA_NAME(t.schema_id) AS schema_name,
                t.name AS table_name,
                c.name AS constraint_name,
                c.type_desc
              FROM sys.objects c
              INNER JOIN sys.tables t ON c.parent_object_id = t.object_id
              WHERE c.type IN ('PK', 'F', 'UQ', 'C', 'D')
              ORDER BY schema_name, table_name, constraint_name
            `
            const constraintResults = await conn.executeQuery(constraintSql)
            if (constraintResults && constraintResults[0]?.rows) {
              constraintResults[0].rows.forEach((row: any) => {
                const typeMap: Record<string, string> = {
                  'PRIMARY_KEY_CONSTRAINT': 'primarykey',
                  'FOREIGN_KEY_CONSTRAINT': 'foreignkey',
                  'UNIQUE_CONSTRAINT': 'unique',
                  'CHECK_CONSTRAINT': 'check',
                  'DEFAULT_CONSTRAINT': 'default'
                }
                objects.push({
                  name: row.constraint_name,
                  schema: row.schema_name,
                  type: typeMap[row.type_desc] || 'constraint',
                  parentTable: `${row.schema_name}.${row.table_name}`
                })
              })
            }
          } catch (e) {
            console.warn('Failed to load constraints:', e)
          }
          
          try {
            // Get all triggers
            const triggerSql = `
              SELECT 
                SCHEMA_NAME(t.schema_id) AS schema_name,
                OBJECT_NAME(tr.parent_id) AS table_name,
                tr.name AS trigger_name,
                tr.is_disabled
              FROM sys.triggers tr
              INNER JOIN sys.tables t ON tr.parent_id = t.object_id
              WHERE tr.parent_class = 1
              ORDER BY schema_name, table_name, trigger_name
            `
            const triggerResults = await conn.executeQuery(triggerSql)
            if (triggerResults && triggerResults[0]?.rows) {
              triggerResults[0].rows.forEach((row: any) => {
                objects.push({
                  name: row.trigger_name,
                  schema: row.schema_name,
                  type: 'trigger',
                  parentTable: `${row.schema_name}.${row.table_name}`,
                  disabled: row.is_disabled
                })
              })
            }
          } catch (e) {
            console.warn('Failed to load triggers:', e)
          }
          
          try {
            // Get all schemas
            const schemaSql = `
              SELECT name AS schema_name
              FROM sys.schemas
              WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
              ORDER BY name
            `
            const schemaResults = await conn.executeQuery(schemaSql)
            if (schemaResults && schemaResults[0]?.rows) {
              schemaResults[0].rows.forEach((row: any) => {
                objects.push({
                  name: row.schema_name,
                  schema: null,
                  type: 'schema'
                })
              })
            }
          } catch (e) {
            console.warn('Failed to load schemas:', e)
          }
          
          try {
            // Get all user-defined types
            const typeSql = `
              SELECT 
                SCHEMA_NAME(schema_id) AS schema_name,
                name AS type_name
              FROM sys.types
              WHERE is_user_defined = 1
              ORDER BY schema_name, type_name
            `
            const typeResults = await conn.executeQuery(typeSql)
            if (typeResults && typeResults[0]?.rows) {
              typeResults[0].rows.forEach((row: any) => {
                objects.push({
                  name: row.type_name,
                  schema: row.schema_name,
                  type: 'type'
                })
              })
            }
          } catch (e) {
            console.warn('Failed to load types:', e)
          }
          
          try {
            // Get all synonyms
            const synonymSql = `
              SELECT 
                SCHEMA_NAME(schema_id) AS schema_name,
                name AS synonym_name,
                base_object_name
              FROM sys.synonyms
              ORDER BY schema_name, synonym_name
            `
            const synonymResults = await conn.executeQuery(synonymSql)
            if (synonymResults && synonymResults[0]?.rows) {
              synonymResults[0].rows.forEach((row: any) => {
                objects.push({
                  name: row.synonym_name,
                  schema: row.schema_name,
                  type: 'synonym',
                  baseObject: row.base_object_name
                })
              })
            }
          } catch (e) {
            console.warn('Failed to load synonyms:', e)
          }
          
          try {
            // Get all sequences
            const sequenceSql = `
              SELECT 
                SCHEMA_NAME(schema_id) AS schema_name,
                name AS sequence_name
              FROM sys.sequences
              ORDER BY schema_name, sequence_name
            `
            const sequenceResults = await conn.executeQuery(sequenceSql)
            if (sequenceResults && sequenceResults[0]?.rows) {
              sequenceResults[0].rows.forEach((row: any) => {
                objects.push({
                  name: row.sequence_name,
                  schema: row.schema_name,
                  type: 'sequence'
                })
              })
            }
          } catch (e) {
            console.warn('Failed to load sequences:', e)
          }
        }
        
        // Sort objects by type, then schema, then name
        objects.sort((a, b) => {
          const typeOrder = ['table', 'view', 'procedure', 'function', 'index', 'foreignkey', 'primarykey', 'unique', 'check', 'default', 'trigger', 'schema', 'type', 'synonym', 'sequence']
          const typeA = typeOrder.indexOf(a.type)
          const typeB = typeOrder.indexOf(b.type)
          if (typeA !== typeB) return typeA - typeB
          if (a.schema !== b.schema) return (a.schema || '').localeCompare(b.schema || '')
          return a.name.localeCompare(b.name)
        })
        
        console.log(`[InlineAI] Loaded ${objects.length} database objects for @ mentions`)
        
        // Emit loaded objects
        this.$root.$emit(AppEvent.databaseObjectsLoaded, objects)
      } catch (e) {
        console.error('Failed to load database objects:', e)
        this.$root.$emit(AppEvent.databaseObjectsLoaded, [])
      }
    },
  },

  async mounted() {
    this.registerHandlers(this.rootBindings)
    
    // Initialize AI user context
    initializeAIUserContext(this.connection)
  }
})
</script>

<style lang="scss">
  .add-tab-dropdown {
    padding: 0 0 !important;
  }
</style>
