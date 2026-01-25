<template>
  <div
    class="query-editor"
    ref="container"
    v-hotkey="keymap"
  >
    <div
      class="top-panel"
      ref="topPanel"
    >
      <merge-manager
        v-if="query && query.id"
        :original-text="originalText"
        :query="query"
        :unsaved-text="unsavedText"
        @change="(text) => unsavedText = text"
        @mergeAccepted="originalText = query.text"
      />
      <div
        class="no-content"
        v-if="remoteDeleted"
      >
        <div class="alert alert-danger">
          <i class="material-icons">error_outline</i>
          <div class="alert-body">
            This query was deleted by someone else. It is no longer editable.
          </div>
          <a
            @click.prevent="close"
            class="btn btn-flat"
          >Close Tab</a>
        </div>
      </div>
      <component
        :is="editorComponent"
        :value="unsavedText"
        :read-only="editor.readOnly"
        :is-focused="focusingElement === 'text-editor'"
        :markers="editorMarkers"
        :formatter-dialect="formatterDialect"
        :identifier-dialect="identifierDialect"
        :param-types="paramTypes"
        :keybindings="keybindings"
        :vim-config="vimConfig"
        :line-wrapping="wrapText"
        :keymap="userKeymap"
        :vim-keymaps="vimKeymaps"
        :entities="entities"
        :columns-getter="columnsGetter"
        :default-schema="defaultSchema"
        :language-id="languageIdForDialect"
        :clipboard="$native.clipboard"
        :replace-extensions="replaceExtensions"
        :context-menu-items="editorContextMenu"
        @bks-initialized="handleEditorInitialized"
        @bks-value-change="unsavedText = $event.value"
        @bks-selection-change="handleEditorSelectionChange"
        @bks-blur="onTextEditorBlur?.()"
        @bks-query-selection-change="handleQuerySelectionChange"
      />
      <span class="expand" />
      <div
        class="toolbar text-right"
        ref="toolbar"
      >
        <div class="editor-help expand" />
        <div class="expand" />
        <div class="actions btn-group">
          <x-button
            v-if="showDryRun"
            class="btn btn-flat btn-small dry-run-btn"
            :disabled="isCommunity"
            @click="dryRun = !dryRun"
          >
            <x-label>Dry Run</x-label>
            <i
              v-if="isCommunity"
              class="material-icons menu-icon"
            >stars</i>
            <input
              v-else
              type="checkbox"
              v-model="dryRun"
            >
          </x-button>
          <x-button
            @click.prevent="triggerSave"
            class="btn btn-flat btn-small"
          >
            Save
          </x-button>
          <x-button
            v-if="connectionType === 'sqlserver' && (tab.planXml || (tab.planXmls && tab.planXmls.length > 0))"
            @click.prevent="analyzePlanWithAI"
            class="btn btn-flat btn-small"
            v-tooltip="'Analyze execution plan with AI'"
          >
            <i class="material-icons">insights</i>
            <x-label>Analyze Plan</x-label>
          </x-button>
          <x-button
            v-if="connectionType === 'sqlserver'"
            @click.prevent="toggleExecutionPlan"
            class="btn btn-flat btn-small execution-plan-toggle-btn"
            :class="{ 'active': collectPlan }"
            v-tooltip="collectPlan ? 'Execution Plan collection ON (click to disable)' : 'Execution Plan collection OFF (click to enable)'"
          >
            <i class="material-icons">account_tree</i>
            <x-label>Execution Plan</x-label>
          </x-button>
          <x-button
            v-if="connectionType === 'sqlserver'"
            @click.prevent="toggleStatistics"
            class="btn btn-flat btn-small statistics-toggle-btn"
            :class="{ 'active': collectStatistics }"
            v-tooltip="collectStatistics ? 'Statistics collection ON (click to disable)' : 'Statistics collection OFF (click to enable)'"
          >
            <i class="material-icons">analytics</i>
            <x-label>Statistics</x-label>
          </x-button>


          <x-buttons class="">
            <x-button
              class="btn btn-primary btn-small"
              v-tooltip="'Ctrl+Enter'"
              @click.prevent="submitTabQuery"
              :disabled="running"
            >
              <x-label>{{ hasSelectedText ? 'Run Selection' : 'Run' }}</x-label>
            </x-button>
            <x-button
              class="btn btn-primary btn-small"
              :disabled="this.tab.isRunning || running"
              menu
            >
              <i class="material-icons">arrow_drop_down</i>
              <x-menu>
                <x-menuitem @click.prevent="submitTabQuery">
                  <x-label>{{ hasSelectedText ? 'Run Selection' : 'Run' }}</x-label>
                  <x-shortcut value="Control+Enter" />
                </x-menuitem>
                <x-menuitem @click.prevent="submitCurrentQuery">
                  <x-label>Run Current</x-label>
                  <x-shortcut value="Control+Shift+Enter" />
                </x-menuitem>
                <hr>
                <x-menuitem
                  @click.prevent="submitQueryToFile"
                  :disabled="disableRunToFile"
                >
                  <x-label>{{ hasSelectedText ? 'Run Selection to File' : 'Run to File' }}</x-label>
                  <i
                    v-if="isCommunity"
                    class="material-icons menu-icon"
                  >
                    stars
                  </i>
                </x-menuitem>
                <x-menuitem
                  @click.prevent="submitCurrentQueryToFile"
                  :disabled="disableRunToFile"
                >
                  <x-label>Run Current to File</x-label>
                  <i
                    v-if="isCommunity"
                    class="material-icons menu-icon "
                  >
                    stars
                  </i>
                </x-menuitem>
              </x-menu>
            </x-button>
          </x-buttons>
        </div>
      </div>
    </div>
    <div class="not-supported" v-if="!enabled">
      <span class="title">
        Query Editor
      </span>
      <div class="body">
        <p> We don't currently support queries for {{ dialect }} </p>
      </div>
    </div>
    <div
      class="bottom-panel"
      ref="bottomPanel"
    >
      <div class="subtabs">
        <button class="subtab-btn" :class="{ active: activeSubTab === 'results' }" @click="activeSubTab = 'results'">
          <i class="material-icons-outlined">table_chart</i>
          <span>Results</span>
        </button>
        <button class="subtab-btn" :class="{ active: activeSubTab === 'messages' }" @click="activeSubTab = 'messages'">
          <i class="material-icons-outlined">message</i>
          <span>Messages</span>
        </button>
        <button class="subtab-btn" :class="{ active: activeSubTab === 'statistics' }" @click="activeSubTab = 'statistics'">
          <i class="material-icons-outlined">analytics</i>
          <span>Statistics</span>
        </button>
        <button class="subtab-btn" :class="{ active: activeSubTab === 'plan' }" @click="activeSubTab = 'plan'">
          <i class="material-icons-outlined">account_tree</i>
          <span>Execution Plan</span>
        </button>
      </div>

      <progress-bar
        @cancel="cancelQuery"
        :message="runningText"
        v-if="running && activeSubTab === 'results'"
      />
      <result-table
        ref="table"
        v-else-if="activeSubTab === 'results' && showResultTable"
        :focus="focusingElement === 'table'"
        :active="active"
        :table-height="tableHeight"
        :result="result"
        :query="queryForExecution || unsavedText || ''"
        :tab="tab"
        :binaryEncoding="$bksConfig.ui.general.binaryEncoding"
        :hasExecutionPlan="!!(tab.planXmls && tab.planXmls.length > 0)"
      />
      <div
        class="message"
        v-else-if="activeSubTab === 'results' && result"
      >
        <div class="alert alert-info">
          <i class="material-icons-outlined">info</i>
          <span>Query {{ selectedResult + 1 }}/{{ results.length }}: No Results. {{ result.affectedRows || 0 }} rows affected. See the select box in the bottom left ↙ for more query results.</span>
        </div>
      </div>
      <div
        class="message"
        v-else-if="activeSubTab === 'results' && errors"
      >
        <error-alert 
          :error="errors" 
          :show-ai-fix="true"
          @fix-with-ai="fixErrorWithAI"
        />
      </div>
      <div
        class="message"
        v-else-if="activeSubTab === 'results' && info"
      >
        <div class="alert alert-info">
          <i class="material-icons-outlined">info</i>
          <span>{{ info }}</span>
        </div>
      </div>
      <div
        class="layout-center expand"
        v-else-if="activeSubTab === 'results'"
      >
        <shortcut-hints />
      </div>

      <!-- Messages subtab -->
      <div v-if="activeSubTab === 'messages'" class="messages-subtab">
        <div class="messages-container">
          <div class="messages-header">
            <h3>Messages</h3>
          </div>
          <div class="messages-content">
            <!-- Messages -->
            <div v-if="queryMessages.length > 0" class="message-section">
              <!-- Group informational messages (DBCC, PRINT) into a text block -->
              <div v-if="infoMessages.length > 0" class="message-text-block">
                <div class="message-text-content">
                  <div v-for="(msg, index) in infoMessages" :key="'info-' + index" class="message-line">
                    {{ msg.message }}
                  </div>
                </div>
              </div>
              
              <!-- Display other messages (errors, success, execution time) as cards -->
              <div v-for="(msg, index) in nonInfoMessages" :key="'msg-' + index" class="message-item" :class="msg.type">
                <i class="material-icons-outlined message-icon">{{ getMessageIcon(msg.type) }}</i>
                <div class="message-text">
                  <div class="message-title">{{ msg.title }}</div>
                  <div class="message-details">{{ msg.message }}</div>
                  <div v-if="msg.timestamp" class="message-timestamp">{{ msg.timestamp }}</div>
                </div>
              </div>
            </div>
            <!-- No messages -->
            <div v-else class="no-messages">
              <i class="material-icons-outlined">info</i>
              <p>No messages to display. Execute a query to see status messages, errors, and warnings.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Statistics subtab -->
      <div v-if="activeSubTab === 'statistics'" class="statistics-subtab">
        <tab-statistics :tab="tab" :active="active" :connection="connection" :embedded="true" :selected-result="selectedResult" />
      </div>

      <!-- Execution Plan subtab -->
      <tab-execution-plan v-if="activeSubTab === 'plan'" :tab="tab" :active="active" class="execution-plan" />
      <!-- STATUS BAR -->
      <query-editor-status-bar
        v-model="selectedResult"
        :results="displayResults"
        :running="running"
        @download="download"
        @clipboard="clipboard"
        @clipboardJson="clipboardJson"
        @clipboardMarkdown="clipboardMarkdown"
        @submitCurrentQueryToFile="submitCurrentQueryToFile"
        @wrap-text="wrapText = !wrapText"
        :execute-time="executeTime"
        :elapsed-time="elapsedTime"
        :active="active"
      />
    </div>

    <!-- Save Modal -->
    <portal to="modals">
      <modal
        class="vue-dialog sqlmind-modal"
        :name="`save-modal-${tab.id}`"
        @closed="selectEditor"
        @opened="selectTitleInput"
        height="auto"
        :scrollable="true"
      >
        <form
          v-kbd-trap="true"
          v-if="query"
          @submit.prevent="saveQuery"
        >
          <div class="dialog-content">
            <div class="dialog-c-title">
              Saved Query Name
            </div>
            <div class="modal-form">
              <div
                class="alert alert-danger save-errors"
                v-if="saveError"
              >
                {{ saveError }}
              </div>
              <div class="form-group">
                <input
                  type="text"
                  ref="titleInput"
                  name="title"
                  class="form-control"
                  v-model="query.title"
                  autofocus
                >
              </div>
            </div>
          </div>
          <div class="vue-dialog-buttons">
            <button
              class="btn btn-flat"
              type="button"
              @click.prevent="$modal.hide(`save-modal-${tab.id}`)"
            >
              Cancel
            </button>
            <button
              class="btn btn-primary"
              type="submit"
            >
              Save
            </button>
          </div>
        </form>
      </modal>
    </portal>

    <!-- Parameter modal -->
    <portal to="modals">
      <modal
        class="vue-dialog sqlmind-modal"
        :name="`parameters-modal-${tab.id}`"
        @opened="selectFirstParameter"
        @closed="selectEditor"
        height="auto"
        :scrollable="true"
      >
        <form
          v-kbd-trap="true"
          @submit.prevent="submitQuery(queryForExecution, true)"
        >
          <div class="dialog-content">
            <div class="dialog-c-title">
              Provide parameter values
            </div>
            <div class="dialog-c-subtitle">
              You need to use single quotes around string values. Blank values are invalid
            </div>
            <div class="modal-form">
              <div class="form-group">
                <div
                  v-for="(param, index) in queryParameterPlaceholders"
                  :key="index"
                >
                  <div class="form-group row">
                    <label>{{ isNumber(param) ? `? ${param + 1}` : param }}</label>
                    <input
                      type="text"
                      class="form-control"
                      required
                      v-model="queryParameterValues[param]"
                      autofocus
                      ref="paramInput"
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="vue-dialog-buttons">
            <button
              class="btn btn-flat"
              type="button"
              @click.prevent="$modal.hide(`parameters-modal-${tab.id}`)"
            >
              Cancel
            </button>
            <button
              class="btn btn-primary"
              type="submit"
            >
              Run
            </button>
          </div>
        </form>
      </modal>
    </portal>
  </div>
</template>

<script lang="ts">
  // @ts-nocheck - Vue 2.7 has limited TypeScript support for template type inference
  import Vue, { PropType } from 'vue'
  import _ from 'lodash'
  import Split from 'split.js'
  import { mapGetters, mapState } from 'vuex'
  import { identify } from 'sql-query-identifier'

  import { canDeparameterize, convertParamsForReplacement, deparameterizeQuery } from '../lib/db/sql_tools'
  import { EditorMarker } from '@/lib/editor/utils'
  import ProgressBar from './editor/ProgressBar.vue'
  import ResultTable from './editor/ResultTable.vue'
  import ShortcutHints from './editor/ShortcutHints.vue'
  import SqlTextEditor from "@sqlmindstudio/ui-kit/vue/sql-text-editor"
  import SurrealTextEditor from "@sqlmindstudio/ui-kit/vue/surreal-text-editor"

  import QueryEditorStatusBar from './editor/QueryEditorStatusBar.vue'
  import rawlog from '@bksLogger'
  import ErrorAlert from './common/ErrorAlert.vue'
  import MergeManager from '@/components/editor/MergeManager.vue'
  import TabStatistics from './TabStatistics.vue'
import TabExecutionPlan from './TabExecutionPlan.vue'
  import { AppEvent } from '@/common/AppEvent'
  import { splitSqlServerGoBatches, detectGoPresence } from '@/lib/db/sql_tools'
  import { TransportOpenTab, findQuery } from '@/common/transport/TransportOpenTab'
  import { blankFavoriteQuery } from '@/common/transport'
  import { TableOrView } from "@/lib/db/models";
  import { FormatterDialect, dialectFor } from "@shared/lib/dialects/models"
  import { findSqlQueryIdentifierDialect } from "@/lib/editor/CodeMirrorPlugins";
  import { queryMagicExtension } from "@/lib/editor/extensions/queryMagicExtension";
  import { getVimKeymapsFromVimrc } from "@/lib/editor/vim";
  import { monokaiInit } from '@uiw/codemirror-theme-monokai';

  const log = rawlog.scope('query-editor')
  const isEmpty = (s) => _.isEmpty(_.trim(s))
  const editorDefault = "\n\n\n\n\n\n\n\n\n\n"

  export default Vue.extend({
    name: 'TabQueryEditor',
    // this.queryText holds the current editor value, always
    components: { 
      ResultTable, 
      ProgressBar, 
      ShortcutHints, 
      QueryEditorStatusBar, 
      ErrorAlert, 
      MergeManager, 
      SqlTextEditor, 
      SurrealTextEditor, 
      TabStatistics,
      TabExecutionPlan 
    },
    props: {
      tab: Object as PropType<TransportOpenTab>,
      active: Boolean
    },
    data() {
      return {
        results: [],
        activeSubTab: 'results',
        running: false,
        runningCount: 1,
        runningType: 'all queries',
        isBottomPanelVisible: true,
        lastBottomPanelSizes: [60, 40] as number[],
        selectedResult: 0,
        resultIndexMap: [], // Maps display result index to actual result index
        unsavedText: editorDefault,
        queryMessages: [], // Store messages for Messages tab
        editor: {
          height: 100,
          selection: null,
          readOnly: false,
          cursorIndex: 0,
          cursorIndexAnchor: 0,
          initialized: false,
        },
      async gatherRuntimeStatsForQuery(queryText) {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const qTrim = (queryText || '').replace(/\s+/g, ' ').trim()
          if (!qTrim) return null
          const probe = qTrim.substring(0, 200)
          const sql = `
SELECT TOP (1)
  CAST(qs.total_worker_time/1000.0 AS decimal(18,2)) AS total_cpu_ms,
  CAST(qs.total_elapsed_time/1000.0 AS decimal(18,2)) AS total_elapsed_ms,
  qs.execution_count,
  CAST((qs.total_elapsed_time*1.0/NULLIF(qs.execution_count,0))/1000.0 AS decimal(18,2)) AS avg_elapsed_ms,
  CAST((qs.total_worker_time*1.0/NULLIF(qs.execution_count,0))/1000.0 AS decimal(18,2)) AS avg_cpu_ms,
  qs.total_logical_reads, qs.total_logical_writes
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
WHERE t.[text] LIKE @p1 ESCAPE '\\'
ORDER BY qs.total_elapsed_time DESC;`
          const like = probe.replace(/[%_]/g, m => '\\' + m)
          const stmt = await this.connection.query({ sql, params: [`%${like}%`] })
          const r = await stmt.execute()
          return (r && (r.rows && r.rows[0])) || (r && r.recordset && r.recordset[0]) || r[0] || null
        } catch (e) { try { console.error('Runtime stats fetch failed', e) } catch (_) {} return null }
      },
      async gatherQueryStoreRuntime(queryText) {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const qTrim = (queryText || '').replace(/\s+/g, ' ').trim()
          if (!qTrim) return null
          const probe = qTrim.substring(0, 200)
          const sql = `
SELECT TOP (1)
  q.query_id,
  SUM(rs.count_executions) AS execs,
  SUM(rs.duration) AS duration_ms,
  SUM(rs.cpu_time) AS cpu_ms,
  SUM(rs.logical_io_reads) AS logical_reads,
  SUM(rs.logical_io_writes) AS logical_writes
FROM sys.query_store_query_text qt
JOIN sys.query_store_query q ON q.query_text_id = qt.query_text_id AND q.object_id IS NULL
JOIN sys.query_store_plan p ON p.query_id = q.query_id
JOIN sys.query_store_runtime_stats rs ON rs.plan_id = p.plan_id
WHERE qt.query_sql_text LIKE @p1 ESCAPE '\\'
GROUP BY q.query_id
ORDER BY duration_ms DESC;`
          const like = probe.replace(/[%_]/g, m => '\\' + m)
          const stmt = await this.connection.query({ sql, params: [`%${like}%`] })
          const r = await stmt.execute()
          const runtime = (r && (r.rows && r.rows[0])) || (r && r.recordset && r.recordset[0]) || r[0] || null
          // waits (best-effort): if view exists
          let waits = []
          try {
            const sqlWaits = `
IF OBJECT_ID('sys.query_store_wait_stats') IS NOT NULL
SELECT TOP (10) ws.wait_category, SUM(ws.total_query_wait_time_ms) AS total_wait_ms
FROM sys.query_store_query_text qt
JOIN sys.query_store_query q ON q.query_text_id = qt.query_text_id AND q.object_id IS NULL
JOIN sys.query_store_plan p ON p.query_id = q.query_id
JOIN sys.query_store_wait_stats ws ON ws.plan_id = p.plan_id
WHERE qt.query_sql_text LIKE @p1 ESCAPE '\\'
GROUP BY ws.wait_category
ORDER BY total_wait_ms DESC;`
            const wstmt = await this.connection.query({ sql: sqlWaits, params: [`%${like}%`] })
            const wr = await wstmt.execute()
            waits = (wr && wr.rows) || (wr && wr.recordset) || []
          } catch (_) {}
          return { runtime, waits }
        } catch (e) { try { console.error('Query Store runtime fetch failed', e) } catch (_) {} return null }
      },
      async gatherFileIoLatency() {
        try {
          if (this.connectionType !== 'sqlserver') return []
          const sql = `
SELECT TOP (20)
  DB_NAME(vfs.database_id) AS database_name,
  mf.name AS file_name,
  mf.type_desc,
  CAST((vfs.io_stall_read_ms*1.0/NULLIF(vfs.num_of_reads,0)) AS decimal(18,2)) AS read_ms_per_read,
  CAST((vfs.io_stall_write_ms*1.0/NULLIF(vfs.num_of_writes,0)) AS decimal(18,2)) AS write_ms_per_write
FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
JOIN sys.master_files mf ON mf.database_id = vfs.database_id AND mf.file_id = vfs.file_id
ORDER BY (vfs.io_stall_read_ms + vfs.io_stall_write_ms) DESC;`
          const q = await this.connection.query(sql)
          const r = await q.execute()
          return (r && r.rows) || (r && r.recordset) || []
        } catch (e) { try { console.error('File IO latency fetch failed', e) } catch (_) {} return [] }
      },
      async gatherTempdbSnapshot() {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const sql = `
SELECT 
  SUM(user_objects_alloc_page_count) AS user_alloc_pages,
  SUM(internal_objects_alloc_page_count) AS internal_alloc_pages
FROM sys.dm_db_session_space_usage;`
          const q = await this.connection.query(sql)
          const r = await q.execute()
          return (r && (r.rows && r.rows[0])) || (r && r.recordset && r.recordset[0]) || r[0] || null
        } catch (e) { try { console.error('Tempdb snapshot fetch failed', e) } catch (_) {} return null }
      },
      async gatherResourceGovernor() {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const sql = `
SELECT CAST(value_in_use AS int) AS classifier_function_present
FROM sys.configurations WHERE name = 'resource governor enabled';`
          const q = await this.connection.query(sql)
          const r = await q.execute()
          const cfg = (r && (r.rows && r.rows[0])) || (r && r.recordset && r.recordset[0]) || r[0] || null
          return cfg
        } catch (e) { try { console.error('Resource Governor fetch failed', e) } catch (_) {} return null }
      },
      async gatherHardwareInfo() {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const sql = `
SELECT cpu_count, scheduler_count, hyperthread_ratio, physical_memory_kb
FROM sys.dm_os_sys_info;`
          const q = await this.connection.query(sql)
          const r = await q.execute()
          return (r && (r.rows && r.rows[0])) || (r && r.recordset && r.recordset[0]) || r[0] || null
        } catch (e) { try { console.error('Hardware info fetch failed', e) } catch (_) {} return null }
      },
      async gatherIndexFragmentation(metaJson) {
        try {
          if (this.connectionType !== 'sqlserver') return []
          if (!metaJson) return []
          let arr = []
          try { arr = JSON.parse(metaJson) } catch (_) { return [] }
          const out = []
          const take = (list, n) => Array.isArray(list) ? list.slice(0, n) : []
          for (const t of take(arr, 4)) {
            const schema = t.schema || 'dbo'
            const table = t.table
            if (!table) continue
            const sql = `
SELECT TOP (5) i.name AS index_name, ips.avg_fragmentation_in_percent, ips.page_count
FROM sys.dm_db_index_physical_stats(DB_ID(), OBJECT_ID(N'${schema.replace(/]/g,']]')}.${table.replace(/]/g,']]')}'), NULL, NULL, 'LIMITED') ips
JOIN sys.indexes i ON i.object_id = ips.object_id AND i.index_id = ips.index_id
WHERE ips.page_count >= 100
ORDER BY ips.avg_fragmentation_in_percent DESC;`
            const q = await this.connection.query(sql)
            const r = await q.execute()
            const rows = (r && r.rows) || (r && r.recordset) || []
            for (const row of rows) out.push({ schema, table, ...row })
          }
          return out
        } catch (e) { try { console.error('Index frag fetch failed', e) } catch (_) {} return [] }
      },
      async gatherSqlServerServerConfig() {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const sql = `
DECLARE @t table(name sysname, minimum int, maximum int, config_value sql_variant, run_value sql_variant);
INSERT INTO @t EXEC sp_configure;
SELECT 
  MAX(CASE WHEN name = 'max degree of parallelism' THEN CONVERT(int, run_value) END) AS maxdop_server,
  MAX(CASE WHEN name = 'cost threshold for parallelism' THEN CONVERT(int, run_value) END) AS cost_threshold_for_parallelism,
  MAX(CASE WHEN name = 'optimize for ad hoc workloads' THEN CONVERT(int, run_value) END) AS optimize_for_ad_hoc
FROM @t;`
          const q = await this.connection.query(sql)
          const r = await q.execute()
          const row = (r && r.rows && r.rows[0]) || (r.recordset && r.recordset[0]) || r[0]
          return row || null
        } catch (e) { try { console.error('Server config fetch failed', e) } catch (_) {} return null }
      },
      async gatherSqlServerDatabaseOptions() {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const sql = `
DECLARE @dbid int = DB_ID();
DECLARE @has_qso bit = CASE WHEN OBJECT_ID('sys.database_query_store_options') IS NOT NULL THEN 1 ELSE 0 END;

DECLARE @sql nvarchar(max) = N'
SELECT 
  DB_NAME() AS database_name,
  d.is_parameterization_forced,
  TRY_CAST((SELECT value FROM sys.database_scoped_configurations WHERE name = ''PARAMETER_SENSITIVE_PLAN_OPTIMIZATION'') AS int) AS psp_opt,
  CAST(NULL AS nvarchar(60)) AS query_store_state,
  CAST(NULL AS int) AS query_store_state_code,
  CAST(NULL AS nvarchar(60)) AS query_store_rw
FROM sys.databases d
WHERE d.database_id = @dbid';

EXEC sp_executesql @sql, N'@dbid int', @dbid = @dbid;` 
          const q = await this.connection.query(sql)
          const r = await q.execute()
          const row = (r && r.rows && r.rows[0]) || (r.recordset && r.recordset[0]) || r[0]
          return row || null
        } catch (e) { try { console.error('DB options fetch failed', e) } catch (_) {} return null }
      },
      extractPlanInsightsFromXml(planXml) {
        if (!planXml || typeof planXml !== 'string') return null
        const s = planXml
        const insights = {
          memoryGrant: null,
          spills: 0,
          implicitConversions: 0,
          missingIndexes: 0,
          parallelOps: 0,
          keyLookups: 0,
          rowEstimateSkews: [],
          ceModelVersion: null,
          warnings: [],
          topOperators: []
        }
        try {
          // Memory grant info
          const mg = /<MemoryGrantInfo[^>]*RequestedMemoryKb="([0-9\.E+-]+)"[^>]*GrantedMemoryKb="([0-9\.E+-]+)"/i.exec(s)
          if (mg) insights.memoryGrant = { requestedKb: Number(mg[1]), grantedKb: Number(mg[2]) }
        } catch (_) {}
        try {
          // Spills
          const spillMatches = s.match(/SpillToTempDb|HashSpillDetails|SortSpillDetails/gi)
          insights.spills = spillMatches ? spillMatches.length : 0
        } catch (_) {}
        try {
          // CE model version
          const ce = /CardinalityEstimationModelVersion="(\d+)"/i.exec(s)
          if (ce) insights.ceModelVersion = Number(ce[1])
        } catch (_) {}
        try {
          // Implicit conversions (best-effort)
          const impl = s.match(/CONVERT_IMPLICIT|ImplicitConversion|Convert|CONVERT\(/gi)
          insights.implicitConversions = impl ? impl.length : 0
        } catch (_) {}
        try {
          // Missing indexes
          const miss = s.match(/<MissingIndexes>|<MissingIndexGroup/gi)
          insights.missingIndexes = miss ? miss.length : 0
        } catch (_) {}
        try {
          // Parallelism operators
          const par = s.match(/PhysicalOp="Parallelism"|<RelOp[^>]*PhysicalOp="Parallelism"/gi)
          insights.parallelOps = par ? par.length : 0
        } catch (_) {}
        try {
          // Key lookups
          const lookups = s.match(/Key Lookup|RID Lookup|Lookup="true"/gi)
          insights.keyLookups = lookups ? lookups.length : 0
        } catch (_) {}
        try {
          // Estimate vs Actual skew hotspots (>10x)
          const re = /EstimateRows="([0-9\.E+-]+)"[\s\S]*?ActualRows="([0-9\.E+-]+)"/gi
          let m
          while ((m = re.exec(s))) {
            const est = Number(m[1]); const act = Number(m[2])
            if (isFinite(est) && isFinite(act) && est > 0) {
              const ratio = act / est
              if (ratio >= 10 || ratio <= 0.1) insights.rowEstimateSkews.push({ estimated: est, actual: act, ratio })
            }
          }
        } catch (_) {}
        try {
          // Plan warnings: row goal, memory grant warnings
          if (/StatementOptmEarlyAbortReason="RowGoal"/i.test(s)) insights.warnings.push('RowGoal')
          const mgw = s.match(/<MemoryGrantWarning[^>]*Warning="([^"]+)"/gi)
          if (mgw) for (const w of mgw) {
            const m = /Warning="([^"]+)"/i.exec(w); if (m) insights.warnings.push(`MemoryGrant:${m[1]}`)
          }
        } catch (_) {}
        try {
          // Top operators by estimated subtree cost
          const reOp = /<RelOp[^>]*PhysicalOp="([^\"]+)\"[^>]*EstimatedTotalSubtreeCost="([0-9\.E+-]+)\"/gi
          let m
          const ops = []
          while ((m = reOp.exec(s))) {
            const op = m[1]
            const cost = Number(m[2])
            if (isFinite(cost)) ops.push({ op, cost })
          }
          ops.sort((a,b)=>b.cost-a.cost)
          insights.topOperators = ops.slice(0, 8)
        } catch (_) {}
        return insights
      },
      summarizeStatisticsIoMessages(msgs) {
        try {
          const acc = {}
          const lines = (Array.isArray(msgs) ? msgs : []).join('\n').split(/\r?\n/)
          for (const line of lines) {
            // Table 'T'. Scan count X, logical reads Y, physical reads Z, ...
            const m = /^Table\s+'([^']+)'\.[^S]*Scan count\s*\d+.*?logical reads\s*(\d+)/i.exec(line)
            if (m) {
              const table = m[1]
              const reads = parseInt(m[2] || '0', 10)
              acc[table] = (acc[table] || 0) + (isFinite(reads) ? reads : 0)
            }
          }
          const sorted = Object.entries(acc).sort((a,b)=>b[1]-a[1]).slice(0,10)
          return sorted.map(([t,r]) => ({ table: t, logicalReads: r }))
        } catch (_) { return [] }
      },
      extractMissingIndexesFromPlan(planXml) {
        if (!planXml || typeof planXml !== 'string') return []
        const out = []
        try {
          // Capture each MissingIndexGroup block with Impact
          const groupRe = /<MissingIndexGroup[^>]*Impact="([0-9\.E+-]+)"[^>]*>([\s\S]*?)<\/MissingIndexGroup>/gi
          let g
          while ((g = groupRe.exec(planXml))) {
            const impact = Number(g[1])
            const body = g[2]
            // Inside, capture <MissingIndex Database= Schema= Table=> with ColumnGroup Usage
            const miRe = /<MissingIndex[^>]*Database=\"([^\"]+)\"[^>]*Schema=\"([^\"]+)\"[^>]*Table=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/MissingIndex>/gi
            let m
            while ((m = miRe.exec(body))) {
              const db = m[1], schema = m[2], table = m[3]
              const inner = m[4]
              const cols = { equality: [], inequality: [], include: [] }
              const cgRe = /<ColumnGroup[^>]*Usage=\"(EQUALITY|INEQUALITY|INCLUDE)\"[^>]*>([\s\S]*?)<\/ColumnGroup>/gi
              let cg
              while ((cg = cgRe.exec(inner))) {
                const usage = cg[1]
                const names = Array.from((cg[2].match(/<ColumnReference[^>]*Column=\"([^\"]+)\"/gi) || []).map(s => /Column=\"([^\"]+)\"/i.exec(s)[1]))
                if (/EQUALITY/i.test(usage)) cols.equality.push(...names)
                else if (/INEQUALITY/i.test(usage)) cols.inequality.push(...names)
                else cols.include.push(...names)
              }
              out.push({ database: db, schema, table, impact, columns: cols })
            }
          }
        } catch (_) {}
        return out
      },
      async gatherQueryStoreForcedPlan(queryText) {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const qTrim = (queryText || '').replace(/\s+/g, ' ').trim()
          if (!qTrim) return null
          const probe = qTrim.substring(0, 200)
          const sql = `
SELECT TOP (1)
  qt.query_sql_text,
  q.query_id,
  p.plan_id,
  p.is_forced_plan
FROM sys.query_store_query_text qt
JOIN sys.query_store_query q ON q.query_text_id = qt.query_text_id AND q.object_id IS NULL
JOIN sys.query_store_plan p ON p.query_id = q.query_id
WHERE qt.query_sql_text LIKE @p1 ESCAPE '\\'
ORDER BY p.last_force_failure_reason_desc DESC, p.last_compile_start_time DESC;`
          const like = probe.replace(/[%_]/g, m => '\\' + m)
          const param = `%${like}%`
          const stmt = await this.connection.query({ sql, params: [param] })
          const res = await stmt.execute()
          const row = (res && res.rows && res.rows[0]) || (res.recordset && res.recordset[0]) || res[0]
          if (!row) return null
          return { query_id: row.query_id, plan_id: row.plan_id, is_forced_plan: row.is_forced_plan }
        } catch (e) { try { console.error('Query Store forced plan fetch failed', e) } catch (_) {} return null }
      },
      async gatherStatsProperties(metaJson) {
        try {
          if (this.connectionType !== 'sqlserver') return []
          if (!metaJson) return []
          let arr = []
          try { arr = JSON.parse(metaJson) } catch (_) { return [] }
          const out = []
          const take = (list, n) => Array.isArray(list) ? list.slice(0, n) : []
          for (const t of take(arr, 6)) {
            const schema = t.schema || 'dbo'
            const table = t.table
            if (!table) continue
            let names = []
            try { names = JSON.parse(t.stats || '[]').map(s => s.name).filter(Boolean).slice(0, 8) } catch (_) { names = [] }
            if (!names.length) continue
            const list = names.map(n => `N'${String(n).replace(/'/g, "''")}'`).join(',')
            const sql = `
DECLARE @obj int = OBJECT_ID(N'${schema.replace(/]/g,']]')}.${table.replace(/]/g,']]')}');
SELECT '${schema}' AS [schema], '${table}' AS [table], s.name AS stat_name,
       p.rows,
       p.rows_sampled,
       p.modification_counter
FROM sys.stats s
OUTER APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) p
WHERE s.[object_id] = @obj AND s.name IN (${list});`
            const q = await this.connection.query(sql)
            const r = await q.execute()
            const rows = (r && r.rows) || (r && r.recordset) || []
            for (const row of rows) out.push(row)
          }
          return out
        } catch (e) { try { console.error('Stats properties fetch failed', e) } catch (_) {} return [] }
      },
      async gatherSessionSetOptions() {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const sql = `
SELECT 
  CAST(SESSIONPROPERTY('ANSI_NULLS') AS int) AS ANSI_NULLS,
  CAST(SESSIONPROPERTY('QUOTED_IDENTIFIER') AS int) AS QUOTED_IDENTIFIER,
  CAST(SESSIONPROPERTY('ANSI_PADDING') AS int) AS ANSI_PADDING,
  CAST(SESSIONPROPERTY('ANSI_WARNINGS') AS int) AS ANSI_WARNINGS,
  CAST(SESSIONPROPERTY('ARITHABORT') AS int) AS ARITHABORT,
  CAST(SESSIONPROPERTY('CONCAT_NULL_YIELDS_NULL') AS int) AS CONCAT_NULL_YIELDS_NULL,
  CAST(SESSIONPROPERTY('NUMERIC_ROUNDABORT') AS int) AS NUMERIC_ROUNDABORT;`
          const q = await this.connection.query(sql)
          const r = await q.execute()
          const row = (r && r.rows && r.rows[0]) || (r.recordset && r.recordset[0]) || r[0]
          return row || null
        } catch (e) { try { console.error('Session SET options fetch failed', e) } catch (_) {} return null }
      },
      async gatherStatisticsFreshness(metaJson) {
        try {
          if (this.connectionType !== 'sqlserver') return []
          if (!metaJson) return []
          let arr = []
          try { arr = JSON.parse(metaJson) } catch (_) { return [] }
          const out = []
          const take = (list, n) => Array.isArray(list) ? list.slice(0, n) : []
          for (const t of take(arr, 6)) {
            const schema = t.schema || 'dbo'
            const table = t.table
            if (!table) continue
            let names = []
            try { names = JSON.parse(t.stats || '[]').map(s => s.name).filter(Boolean).slice(0, 12) } catch (_) { names = [] }
            if (!names.length) continue
            const list = names.map(n => `N'${String(n).replace(/'/g, "''")}'`).join(',')
            const sql = `
DECLARE @obj int = OBJECT_ID(N'${schema.replace(/]/g,']]')}.${table.replace(/]/g,']]')}');
SELECT '${schema}' AS [schema], '${table}' AS [table], s.name AS stat_name, STATS_DATE(s.[object_id], s.stats_id) AS last_updated
FROM sys.stats s
WHERE s.[object_id] = @obj AND s.name IN (${list});`
            const q = await this.connection.query(sql)
            const r = await q.execute()
            const rows = (r && r.rows) || (r && r.recordset) || []
            for (const row of rows) out.push(row)
          }
          return out
        } catch (e) { try { console.error('Stats freshness fetch failed', e) } catch (_) {} return [] }
      },
      async gatherSqlServerEnvironment() {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const sql = `
SELECT TOP (1)
  db_name() AS database_name,
  d.compatibility_level,
  CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS product_version,
  CAST(SERVERPROPERTY('ProductLevel') AS nvarchar(128)) AS product_level,
  CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
  (SELECT value FROM sys.database_scoped_configurations WHERE name = 'LEGACY_CARDINALITY_ESTIMATION') AS legacy_ce,
  (SELECT value FROM sys.database_scoped_configurations WHERE name = 'QUERY_OPTIMIZER_HOTFIXES') AS qo_hotfixes,
  (SELECT value FROM sys.database_scoped_configurations WHERE name = 'PARAMETER_SNIFFING') AS parameter_sniffing,
  (SELECT value FROM sys.database_scoped_configurations WHERE name = 'MAXDOP') AS maxdop
FROM sys.databases d WHERE d.name = db_name();`
          const q = await this.connection.query(sql)
          const r = await q.execute()
          const row = (r && r.rows && r.rows[0]) || (r.recordset && r.recordset[0]) || r[0]
          return row || null
        } catch (e) { try { console.error('Env fetch failed', e) } catch (_) {} return null }
      },
      async gatherLastCompiledParameters(queryText) {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const qTrim = (queryText || '').replace(/\s+/g, ' ').trim()
          if (!qTrim) return null
          const probe = qTrim.substring(0, 200)
          const sql = `
WITH qs AS (
  SELECT TOP (1)
    qs.plan_handle,
    qs.last_compile_time,
    t.[text]
  FROM sys.dm_exec_query_stats qs
  CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
  WHERE t.[text] LIKE @p1 ESCAPE '\\' AND (DB_ID() = t.dbid OR t.dbid IS NULL)
  ORDER BY qs.last_compile_time DESC
)
SELECT cast(qp.query_plan as nvarchar(max)) AS plan_xml
FROM qs
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp;`
          const like = probe
            .replace(/[%_]/g, m => '\\' + m)
          const param = `%${like}%`
          const stmt = await this.connection.query({ sql, params: [param] })
          const res = await stmt.execute()
          const row = (res && res.rows && res.rows[0]) || (res.recordset && res.recordset[0]) || res[0]
          const planXml = row && (row.plan_xml || row[Object.keys(row)[0]])
          if (!planXml || typeof planXml !== 'string') return null
          const params = []
          try {
            const re = /<ParameterList>[\s\S]*?<\/ParameterList>/i
            const plist = (re.exec(planXml) || [])[0] || ''
            let m
            const nameRe = /Parameter=\"(@[^\"]*)\"[\s\S]*?ParameterCompiledValue=\"([^\"]*)\"/gi
            while ((m = nameRe.exec(plist))) {
              params.push({ name: m[1], value: m[2] })
            }
          } catch (_) {}
          return { params, source: 'dm_exec_query_plan' }
        } catch (e) { try { console.error('Param sniff fetch failed', e) } catch (_) {} return null }
      },
      extractStatisticsMessages(resultsAny) {
        const out = []
        const toStr = (v) => {
          if (v == null) return ''
          if (typeof v === 'string') return v
          try { if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(v)) return v.toString('utf8') } catch (_) {}
          try { if (v instanceof Uint8Array) return new TextDecoder('utf-8').decode(v) } catch (_) {}
          try { if (typeof v.toString === 'function') return v.toString() } catch (_) {}
          try { return String(v) } catch (_) { return '' }
        }
        const pushIfStat = (s) => {
          const text = toStr(s)
          if (!text) return
          if (/^Table\s+'.*'\..*Scan count/i.test(text) || /SQL Server parse and compile time:/i.test(text) || /CPU\s+time\s*=|elapsed\s+time\s*=/i.test(text)) {
            out.push(text)
          }
        }
        try {
          const list = Array.isArray(resultsAny) ? resultsAny : [resultsAny]
          for (const r of list) {
            const msgs = r && (Array.isArray(r.messages) ? r.messages : (r.messages ? [r.messages] : []))
            for (const m of msgs || []) pushIfStat(m)
            // Some clients put stats in info arrays
            if (r && Array.isArray(r.info)) for (const m of r.info) pushIfStat(m)
          }
        } catch (_) {}
        // dedupe
        return Array.from(new Set(out))
      },
        runningQuery: null,
        error: null,
        errorMarker: null,
        saveError: null,
        info: null,
        split: null,
        elapsedTime: 0,
        timerInterval: null,
        tableHeight: 0,
        savePrompt: false,
        lastWord: null,
        queryParameterValues: {},
        queryForExecution: null,
        executeTime: 0,
        originalText: "",
        initialized: false,
        blankQuery: blankFavoriteQuery(),
        dryRun: false,
        containerResizeObserver: null,
        onTextEditorBlur: null,
        wrapText: false,
        vimKeymaps: [],

        /**
         * NOTE: Use focusElement instead of focusingElement or blurTextEditor()
         * if we want to switch focus. Why two states? We need a feedback from
         * text editor cause it can't release focus automatically.
         *
         * Possible values: 'text-editor', 'table', 'none'
         */
        focusElement: 'none',
        focusingElement: 'none',

        individualQueries: [],
        currentlySelectedQuery: null,
        queryMagic: queryMagicExtension(),
        // Auto-collect actual execution plan for SQL Server (STATISTICS XML)
        collectPlan: false,
        // Auto-collect estimated execution plan for SQL Server (SHOWPLAN XML)
        collectEstimatedPlan: false,
        // Auto-collect IO and TIME statistics for SQL Server
        collectStatistics: false,
      }
    },
    computed: {
      ...mapGetters(['dialect', 'dialectData', 'defaultSchema']),
      ...mapGetters({
        'isCommunity': 'licenses/isCommunity',
        'userKeymap': 'settings/userKeymap',
      }),
      ...mapState(['usedConfig', 'connectionType', 'database', 'tables', 'storeInitialized', 'connection']),
      ...mapState('data/queries', {'savedQueries': 'items'}),
      ...mapState('settings', ['settings']),
      ...mapState('tabs', { 'activeTab': 'active' }),
      ...mapGetters('popupMenu', ['getExtraPopupMenu']),
      editorComponent() {
        return this.connectionType === 'surrealdb' ? SurrealTextEditor : SqlTextEditor;
      },
      enabled() {
        return !this.dialectData?.disabledFeatures?.queryEditor;
      },
      disableRunToFile() {
        return this.dialectData?.disabledFeatures?.export?.stream
      },
      infoMessages() {
        return this.queryMessages.filter(msg => msg.type === 'info' && msg.title === 'Message')
      },
      nonInfoMessages() {
        return this.queryMessages.filter(msg => msg.type !== 'info' || msg.title !== 'Message')
      },
      shouldInitialize() {
        return this.storeInitialized && this.active && !this.initialized
      },
      remoteDeleted() {
        return this.storeInitialized && this.tab.queryId && !this.query
      },
      query() {
        return findQuery(this.tab, this.savedQueries ?? []) ?? this.blankQuery
      },
      queryTitle() {
        return this.query?.title
      },
      showDryRun() {
        return this.dialect == 'bigquery'
      },
      identifyDialect() {
        // dialect for sql-query-identifier
        const mappings = {
          'sqlserver': 'mssql',
          'sqlite': 'sqlite',
          'cockroachdb': 'psql',
          'postgresql': 'psql',
          'mysql': 'mysql',
          'mariadb': 'mysql',
          'tidb': 'mysql',
          'redshift': 'psql',
          'mongodb': 'psql'
        }
        return mappings[this.connectionType] || 'generic'
      },
      hasParams() {
        return !!this.queryParameterPlaceholders?.length
      },
      paramsModalRequired() {
        let result = false
        this.queryParameterPlaceholders.forEach((param) => {
          const v = this.queryParameterValues[param]
          if (!v || _.isEmpty(v.trim())) {
            result = true
          }
        })
        return result
      },
      errors() {
        const result = [
          this.error,
          this.saveError
        ].filter((e) => e)

        return result.length ? result : null
      },
      runningText() {
        return `Running ${this.runningType} (${window.main.pluralize('query', this.runningCount, true)})`
      },
      hasSelectedText() {
        return this.editor.initialized ? !!this.editor.selection : false
      },
      result() {
        // Map selectedResult (display index) to actual result index
        const actualIndex = this.resultIndexMap && this.resultIndexMap[this.selectedResult] !== undefined
          ? this.resultIndexMap[this.selectedResult]
          : this.selectedResult
        return this.results[actualIndex]
      },
      // Filter out execution plan XML results from display and create index mapping
      displayResults() {
        if (!this.results || this.results.length === 0) return []
        
        const filtered = []
        this.resultIndexMap = [] // Map display index to actual result index
        
        this.results.forEach((result, actualIndex) => {
          // Keep results that have actual data rows (not just execution plan XML)
          if (!result || !result.rows || result.rows.length === 0) {
            filtered.push(result)
            this.resultIndexMap.push(actualIndex)
            return
          }
          
          if (result.rows.length > 1) {
            // Multiple rows = data result
            filtered.push(result)
            this.resultIndexMap.push(actualIndex)
            return
          }
          
          // Check if single row contains execution plan XML
          const row = result.rows[0]
          if (!row) {
            filtered.push(result)
            this.resultIndexMap.push(actualIndex)
            return
          }
          
          // Check all values in the row for ShowPlanXML
          const values = Object.values(row)
          const hasXmlPlan = values.some(val => {
            if (!val) return false
            const str = String(val)
            return str.includes('<ShowPlanXML') || str.includes('<?xml') && str.includes('ShowPlan')
          })
          
          if (!hasXmlPlan) {
            // Not an execution plan XML result, include it
            filtered.push(result)
            this.resultIndexMap.push(actualIndex)
          }
        })
        
        return filtered
      },
      rowCount() {
        return this.result && this.result.rows ? this.result.rows.length : 0
      },
      hasText() {
        return !isEmpty(this.unsavedText)
      },
      hasTitle() {
        return this.query?.title && this.query.title.replace(/\s+/, '').length > 0
      },
      splitElements() {
        return [
          this.$refs.topPanel,
          this.$refs.bottomPanel,
        ]
      },
      keymap() {
        if (!this.active) return {}
        return this.$vHotkeyKeymap({
          'queryEditor.switchPaneFocus': this.switchPaneFocus,
          'queryEditor.selectEditor': this.selectEditor,
          'queryEditor.submitQueryToFile': this.submitQueryToFile,
          'queryEditor.submitCurrentQueryToFile': this.submitCurrentQueryToFile,
        })
      },
      queryParameterPlaceholders() {
        let params = this.individualQueries.flatMap((qs) => qs.parameters)

        if (this.currentlySelectedQuery && (this.hasSelectedText || this.runningType === 'current')) {
          params = this.currentlySelectedQuery.parameters
        }

        if (params.length && params.includes('?')) {
          let posIndex = 0; // number doesn't matter, this just distinguishes positional from other types
          params = params.map((param) => {
            if (param != '?') return param;

            return posIndex++;
          })
        }

        return _.uniq(params)
      },
      deparameterizedQuery() {
        let query = this.queryForExecution
        if (_.isEmpty(query)) {
          return query;
        }

        const placeholders = this.individualQueries.flatMap((qs) => qs.parameters);
        const values = Object.values(this.queryParameterValues) as string[];
        const convertedParams = convertParamsForReplacement(placeholders, values);
        query = deparameterizeQuery(query, this.dialect, convertedParams, this.$bksConfig.db[this.dialect]?.paramTypes);
        return query;
      },
      unsavedChanges() {
        if (_.trim(this.unsavedText) === "" && _.trim(this.originalText) === "") return false

        return !this.query?.id ||
          _.trim(this.unsavedText) !== _.trim(this.originalText)
      },
      keybindings() {
        const keybindings = this.$CMKeymap({
          'general.save': this.triggerSave,
          'queryEditor.submitCurrentQuery': this.submitCurrentQuery,
          'queryEditor.submitTabQuery': this.submitTabQuery,
        })

        if(this.userKeymap === "vim") {
          keybindings["Ctrl-Esc"] = this.cancelQuery
        } else {
          keybindings["Esc"] = this.cancelQuery
        }

        return keybindings
      },
      vimConfig() {
        const exCommands = [
          { name: "write", prefix: "w", handler: this.triggerSave },
          { name: "quit", prefix: "q", handler: this.close },
          { name: "qa", prefix: "qa", handler: () => this.$root.$emit(AppEvent.closeAllTabs) },
          { name: "x", prefix: "x", handler: this.writeQuit },
          { name: "wq", prefix: "wq", handler: this.writeQuit },
          { name: "tabnew", prefix: "tabnew", handler: (_cn, params) => {
            if(params.args && params.args.length > 0){
              let queryName = params.args[0]
              this.$root.$emit(AppEvent.newTab,"", queryName)
              return
            }
            this.$root.$emit(AppEvent.newTab)
          }},
        ]

        return { exCommands }
      },
      editorMarkers() {
        const markers = []
        if (this.errorMarker) markers.push(this.errorMarker)
        return markers
      },
      showResultTable() {
        return this.rowCount > 0
      },
      entities() {
        return this.tables.map((t: TableOrView) => ({ schema: t.schema, name: t.name }))
      },
      queryDialect() {
        return this.dialectData.queryDialectOverride ?? this.connectionType;
      },
      formatterDialect() {
        return FormatterDialect(dialectFor(this.queryDialect))
      },
      paramTypes() {
        return this.$bksConfig.db[this.dialect]?.paramTypes
      },
      identifierDialect() {
        return findSqlQueryIdentifierDialect(this.queryDialect)
      },
      languageIdForDialect() {
        // Map textEditorMode to CodeMirror 6 languageId
        if (this.dialectData.textEditorMode === 'text/x-redis') {
          return 'redis';
        }
        return this.dialectData.textEditorMode;
      },
      replaceExtensions() {
        return (extensions) => {
          return [
            extensions,
            monokaiInit({
              settings: {
                selection: "",
                selectionMatch: "",
              },
            }),
            this.queryMagic.extensions,
          ]
        }
      },
    },
    watch: {
      error() {
        this.errorMarker = null
        if (this.dialect === 'postgresql' && this.error && this.error.position) {
          const [a, b] = this.locationFromPosition(this.queryForExecution, parseInt(this.error.position) - 1, parseInt(this.error.position))
          this.errorMarker = { from: a, to: b, type: 'error' } as EditorMarker
          this.error.marker = {line: b.line + 1, ch: b.ch}
        }
      },
      running() {
        if (this.running) {
          this.freezePanels();
          this.startTimer();
        } else {
          this.unfreezePanels();
          this.stopTimer();
        }
      },
      queryTitle() {
        if (this.queryTitle) this.tab.title = this.queryTitle
      },
      shouldInitialize() {
        if (this.shouldInitialize) this.initialize()
      },
      unsavedText() {
        this.tab.unsavedQueryText = this.unsavedText
        this.saveTab()
      },
      unsavedChanges() {
        this.tab.unsavedChanges = this.unsavedChanges
      },
      'tab.unsavedQueryText'(newValue) {
        // Sync external changes to tab.unsavedQueryText (e.g., from insertText) to the editor
        if (newValue !== undefined && newValue !== this.unsavedText) {
          this.unsavedText = newValue;
        }
      },
      'tab.result'(newValue) {
        // Sync external changes to tab.result (e.g., from executeQueryInTab) to the component
        if (newValue !== undefined && newValue !== this.results) {
          console.log('[TabQueryEditor] Syncing tab.result to local results:', newValue);
          this.results = newValue;
          this.executeTime = this.tab.executeTime || 0;
          // Select the last non-empty result
          const nonEmptyResult = _.chain(newValue).findLastIndex((r) => !!r.rows?.length).value();
          this.selectedResult = nonEmptyResult === -1 ? newValue.length - 1 : nonEmptyResult;
          // No auto-resize: keep split sizes stable
          try {
            const plans = this.extractAllPlanXmls(newValue)
            if (plans && plans.length) {
              this.$set(this.tab, 'planXmls', plans)
              this.$set(this.tab, 'planXml', plans[plans.length - 1])
              // Notify globally that a plan is available (for AI auto-read, etc.)
              try { this.$root.$emit('plan:available', { xml: plans[plans.length - 1], tabId: this.tab.id }) } catch (_) {}
            }
          } catch (_) {}
        }
      },
      'tab.statsData'(val) {
        // No auto-resize on new statistics data
      },
      selectedResult(newIndex) {
        // Update execution plan when switching between result tabs
        try {
          const plans = this.tab.planXmls
          if (!plans || plans.length === 0) return
          
          // Count non-empty results up to newIndex to find the correct plan index
          let planIndex = 0
          for (let i = 0; i <= newIndex && i < this.results.length; i++) {
            const result = this.results[i]
            if (result && result.rows && result.rows.length > 0) {
              if (i === newIndex) break
              planIndex++
            }
          }
          
          if (planIndex < plans.length && plans[planIndex]) {
            this.$set(this.tab, 'planXml', plans[planIndex])
            console.log(`[TabQueryEditor] Updated planXml for result ${newIndex + 1}, plan index ${planIndex}`)
          }
        } catch (e) {
          console.error('[TabQueryEditor] Failed to update planXml on result change', e)
        }
      },
      async active() {
        if (!this.editor.initialized) {
          return
        }

        // HACK: we couldn't focus the editor immediately each time the tab is
        // clicked because something steals the focus. So we defer focusing
        // the editor at the end of the call stack with timeout, and
        // this.$nextTick doesn't work in this case.
        if (this.active) {
          setTimeout(this.selectEditor, 0)
        }

        if (!this.active) {
          this.focusElement = 'none'
          this.$modal.hide(`save-modal-${this.tab.id}`)
        }
      },
      activeSubTab(newVal, oldVal) {
        // When switching to Statistics or Execution Plan, lock panel heights immediately to prevent any reflow
        if (newVal === 'statistics' || newVal === 'plan') {
          this.$nextTick(() => this.freezePanels())
        } else if (!this.running) {
          // If leaving those tabs and not running, allow layout to be flexible again
          this.$nextTick(() => this.unfreezePanels())
        }
      },
      async focusElement(element, oldElement) {
        if (oldElement === 'text-editor' && element !== 'text-editor') {
          await this.blurTextEditor()
        }
        this.focusingElement = element
      },
    },
    methods: {
      isNumber(value: any) {
        return _.isNumber(value);
      },
      getMessageIcon(type) {
        const icons = {
          success: 'check_circle',
          error: 'error',
          warning: 'warning',
          info: 'info'
        }
        return icons[type] || 'info'
      },
      collectQueryMessages(results, errors, executeTime, additionalMessages = []) {
        const messages = []
        const timestamp = new Date().toLocaleString()
        
        // Add error messages
        if (errors) {
          messages.push({
            type: 'error',
            title: 'Error',
            message: typeof errors === 'string' ? errors : errors.message || 'Query execution failed',
            timestamp
          })
        }
        
        // Collect informational messages from additionalMessages (for DBCC, PRINT, etc. when no result sets)
        if (additionalMessages && additionalMessages.length > 0) {
          additionalMessages.forEach(msg => {
            const msgText = typeof msg === 'string' ? msg : (msg && msg.message ? msg.message : String(msg))
            if (msgText && msgText.trim()) {
              messages.push({
                type: 'info',
                title: 'Message',
                message: msgText.trim(),
                timestamp
              })
            }
          })
        }
        
        // Collect informational messages from SQL Server (PRINT statements, DBCC output, etc.)
        if (results && Array.isArray(results)) {
          results.forEach((result, index) => {
            const resultMessages = result && result.messages
            const msgArray = Array.isArray(resultMessages) ? resultMessages : (resultMessages ? [resultMessages] : [])
            
            msgArray.forEach(msg => {
              const msgText = typeof msg === 'string' ? msg : (msg && msg.message ? msg.message : String(msg))
              if (msgText && msgText.trim()) {
                messages.push({
                  type: 'info',
                  title: 'Message',
                  message: msgText.trim(),
                  timestamp
                })
              }
            })
          })
        }
        
        // Add success messages for each result
        // Filter out execution plan XML results to avoid duplicate "Query completed" messages
        if (results && Array.isArray(results)) {
          const filteredResults = results.filter((r, idx) => {
            // Skip empty results
            if (!r.fields || r.fields.length === 0) return true
            
            // Skip execution plan XML results (STATISTICS XML / SHOWPLAN XML)
            // SQL Server returns execution plans as a single-field result set
            // Check if this result contains ShowPlanXML data
            if (r.fields.length === 1 && r.rows && r.rows.length > 0) {
              const firstRow = r.rows[0]
              const firstValue = firstRow ? Object.values(firstRow)[0] : null
              
              // Check if the value contains ShowPlanXML
              if (firstValue) {
                const valueStr = typeof firstValue === 'string' ? firstValue : String(firstValue)
                if (/<ShowPlanXML[\s\S]*?<\/ShowPlanXML>/i.test(valueStr)) {
                  return false
                }
              }
            }
            
            return true
          })
          
          filteredResults.forEach((result, index) => {
            const affectedRows = result.affectedRows || 0
            const rowCount = result.rowCount || 0
            
            if (affectedRows > 0) {
              messages.push({
                type: 'success',
                title: `Query ${index + 1} completed`,
                message: `(${affectedRows} row(s) affected)`,
                timestamp
              })
            } else if (rowCount > 0) {
              messages.push({
                type: 'info',
                title: `Query ${index + 1} completed`,
                message: `${rowCount} row(s) returned`,
                timestamp
              })
            } else {
              messages.push({
                type: 'info',
                title: `Query ${index + 1} completed`,
                message: 'Command completed successfully',
                timestamp
              })
            }
          })
        }
        
        // Add execution time
        if (executeTime) {
          messages.push({
            type: 'info',
            title: 'Execution Time',
            message: `Completion time: ${executeTime}ms`,
            timestamp
          })
        }
        
        return messages
      },
      extractAllPlanXmls(results: any[]): string[] {
        const out: string[] = []
        const re = /<ShowPlanXML[\s\S]*?<\/ShowPlanXML>/i
        const toStr = (v: any) => {
          if (v == null) return ''
          if (typeof v === 'string') return v
          // Node Buffer
          try { if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(v)) return v.toString('utf8') } catch (_) {}
          // Typed arrays
          try { if (v instanceof Uint8Array) return new TextDecoder('utf-8').decode(v) } catch (_) {}
          try { if (typeof v.toString === 'function') return v.toString() } catch (_) {}
          try { return String(v) } catch (_) { return '' }
        }
        const visit = (val: any) => {
          try {
            if (val == null) return
            if (typeof val === 'string') {
              const m = re.exec(val)
              if (m && m[0]) out.push(m[0])
              return
            }
            if (Array.isArray(val)) {
              for (const item of val) visit(item)
              return
            }
            if (typeof val === 'object') {
              // Also check a stringified form (for XML types)
              const s = toStr(val)
              const m = re.exec(s)
              if (m && m[0]) out.push(m[0])
              for (const k of Object.keys(val)) visit(val[k])
              return
            }
            // Primitive number/boolean
            const s = toStr(val)
            const m = re.exec(s)
            if (m && m[0]) out.push(m[0])
          } catch (_) {}
        }
        try {
          for (const r of results || []) {
            // Fast paths
            const rows = r?.rows || r?.recordset || []
            visit(rows)
            // MSSQL: recordsets (array of recordsets)
            if (Array.isArray(r?.recordsets)) {
              for (const rs of r.recordsets) visit(rs)
            }
            // Messages
            const msgs = r && (Array.isArray(r.messages) ? r.messages : (r.messages ? [r.messages] : []))
            visit(msgs)
            // Whole result object (catch-all)
            visit(r)
          }
        } catch (_) {}
        const unique = Array.from(new Set(out))
        try { if (unique.length) console.log('[TabQueryEditor] Extracted ShowPlanXML count:', unique.length) } catch (_) {}
        return unique
      },
      locationFromPosition(queryText, ...rawPositions) {
        // 1. find the query text inside the editor
        // 2.

        const editorText = this.unsavedText

        const startCharacter = editorText.indexOf(queryText)
        const lines = editorText.split(/\n/)
        const positions = rawPositions.map((p) => p + startCharacter)

        const finished = positions.map((_p) => false)
        const results = positions.map((_p) => ({ line: null, ch: null}))

        let startOfLine = 0
        lines.forEach((line, idx) => {
          const eol = startOfLine + line.length + 1
          positions.forEach((p, pIndex) => {
            if (startOfLine <= p && p <= eol && !finished[pIndex]) {
              results[pIndex].line = idx
              results[pIndex].ch = p - startOfLine
              finished[pIndex] = true
            }
          })
          startOfLine += line.length + 1
        })
        return results
      },
      initialize() {
        this.initialized = true
        // TODO (matthew): Add hint options for all tables and columns\
        this.query.title = this.activeTab?.title
        try { this.$set(this.tab, 'connectionType', this.connectionType) } catch (_) {}

        if (this.split) {
          this.split.destroy();
          this.split = null;
        }

        this.initializeQueries()
        this.tab.unsavedChanges = this.unsavedChanges

        this.split = Split(this.splitElements, {
          elementStyle: (_dimension, size) => ({
            'flex-basis': `calc(${size}%)`,
          }),
          sizes: [50,50],
          gutterSize: 8,
          direction: 'vertical',
          onDragEnd: () => {
            this.$nextTick(() => {
              try {
                if (this.split && this.isBottomPanelVisible && typeof (this.split as any).getSizes === 'function') {
                  const sizes = (this.split as any).getSizes()
                  if (Array.isArray(sizes) && sizes.length === 2) {
                    this.lastBottomPanelSizes = sizes
                  }
                }
              } catch (_) {}
              // Subtract status bar height to prevent scrollbar from hiding behind it
              const statusBarHeight = 42 // 2.6rem in pixels
              this.tableHeight = this.$refs.bottomPanel.clientHeight - statusBarHeight
              this.updateEditorHeight()
            })
          }
        })

        // Making sure split.js is initialized
        this.$nextTick(() => {
          // Subtract status bar height (2.6rem ≈ 41.6px) to prevent scrollbar from hiding behind it
          const statusBarHeight = 42 // 2.6rem in pixels (approximate)
          this.tableHeight = this.$refs.bottomPanel.clientHeight - statusBarHeight
          this.updateEditorHeight()
        })
      },
      handleEditorInitialized(detail) {
        this.editor.initialized = true

        // Setup query magic data providers
        this.queryMagic.setDefaultSchemaGetter(() => this.defaultSchema);
        this.queryMagic.setTablesGetter(() => this.tables);

        // this gives the dom a chance to kick in and render these
        // before we try to read their heights
        this.$nextTick(() => {
          // Subtract status bar height to prevent scrollbar from hiding behind it
          const statusBarHeight = 42 // 2.6rem in pixels
          this.tableHeight = this.$refs.bottomPanel.clientHeight - statusBarHeight
          this.updateEditorHeight()
        })
      },
      handleEditorSelectionChange(detail) {
        this.editor.selection = detail.value
      },
      freezePanels() {
        try {
          const bottom = this.$refs.bottomPanel as HTMLElement
          const top = this.$refs.topPanel as HTMLElement
          if (!bottom || !top) return
          // Lock current pixel height to prevent any flex recalculation visual shifts
          const h = bottom.clientHeight
          const th = top.clientHeight
          if (h > 0) bottom.style.setProperty('height', h + 'px')
          if (th > 0) top.style.setProperty('height', th + 'px')
        } catch (_) {}
      },
      unfreezePanels() {
        try {
          const bottom = this.$refs.bottomPanel as HTMLElement
          const top = this.$refs.topPanel as HTMLElement
          if (!bottom || !top) return
          bottom.style.removeProperty('height')
          top.style.removeProperty('height')
        } catch (_) {}
      },
      adjustBottomPanelForStatistics() {
        // Disabled: keep user-controlled split sizes constant
        return
      },
      toggleBottomPanel() {
        if (!this.split) return
        
        const bottomPanel = this.$refs.bottomPanel as HTMLElement
        if (!bottomPanel) return
        
        // Check if panel is currently visible using the tracked state
        if (this.isBottomPanelVisible) {
          // Capture current sizes so we can restore them later
          try {
            if (typeof (this.split as any).getSizes === 'function') {
              const sizes = (this.split as any).getSizes()
              if (Array.isArray(sizes) && sizes.length === 2) {
                this.lastBottomPanelSizes = sizes
              }
            }
          } catch (_) {}
          // Close - collapse to minimum but keep some space for the gutter
          this.split.setSizes([99.5, 0.5])
          this.isBottomPanelVisible = false
          
          // Hide the bottom panel content
          bottomPanel.style.display = 'none'
        } else {
          // Open to last user size (fallback to 60/40)
          const targetSizes = (Array.isArray(this.lastBottomPanelSizes) && this.lastBottomPanelSizes.length === 2)
            ? this.lastBottomPanelSizes
            : [60, 40]
          this.isBottomPanelVisible = true
          
          // Make sure the bottom panel is visible
          bottomPanel.style.display = 'flex'

          // Restore sizes after making panel visible so Split can calculate correctly
          this.$nextTick(() => {
            try {
              this.split && this.split.setSizes(targetSizes)
            } catch (_) {}
          })
          
          this.$nextTick(() => {
            const statusBarHeight = 42
            this.tableHeight = bottomPanel.clientHeight - statusBarHeight
            this.updateEditorHeight()
          })
        }
      },
      saveTab: _.debounce(function() {
        this.$store.dispatch('tabs/save', this.tab)
      }, 1000),
      close() {
        this.$root.$emit(AppEvent.closeTab)
      },
      fixErrorWithAI() {
        // Check if there's a text selection
        const hasSelection = this.hasSelectedText;
        
        // Use appropriate prompt based on selection
        const prompt = hasSelection 
          ? 'Fix errors in the selected query and comment out the broken parts'
          : 'Fix this error and comment out the broken query';
        
        // Check if Inline AI is already open
        const isOpen = this.$parent && this.$parent.showInlineAI
        
        if (!isOpen) {
          // Open Inline AI first
          this.$root.$emit(AppEvent.toggleInlineAI)
        }
        
        // Give the component time to mount/update, then trigger the fix
        this.$nextTick(() => {
          this.$root.$emit(AppEvent.aiInlinePrompt, { 
            prompt, 
            runAfterInsert: true,
            aiMode: 'code'
          })
        })
      },
      async cancelQuery() {
        if (this.running && this.runningQuery) {
          this.running = false
          this.info = 'Query Execution Cancelled'
          await this.runningQuery.cancel();
          this.runningQuery = null;
        }
      },
      download(format) {
        this.$refs.table.download(format)
      },
      clipboard() {
        this.$refs.table.clipboard()
      },
      clipboardJson() {
        // eslint-disable-next-line
        // @ts-ignore
        const data = this.$refs.table.clipboard('json')
      },
      clipboardMarkdown() {
        // eslint-disable-next-line
        // @ts-ignore
        const data = this.$refs.table.clipboard('md')
      },
      selectEditor() {
        this.focusElement = 'text-editor'
      },
      selectTitleInput() {
        this.$refs.titleInput.select()
      },
      selectFirstParameter() {
        if (!this.$refs['paramInput'] || this.$refs['paramInput'].length === 0) return
        this.$refs['paramInput'][0].select()
      },
      getCurrentQueryText() {
        try {
          if (this.currentlySelectedQuery && (this.hasSelectedText || this.runningType === 'current')) {
            return this.currentlySelectedQuery.text || ''
          }
        } catch (_) {}
        try { if (this.queryForExecution) return this.queryForExecution } catch (_) {}
        try { return this.unsavedText || '' } catch (_) {}
        return ''
      },
      referencedTablesFromQuery(q) {
        const out = []
        try {
          const text = (q || '').replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
          const re = /(from|join)\s+([\[\]"`\w]+\.)?([\[\]"`\w]+)/gi
          let m
          const norm = (s) => (s || '').replace(/[\[\]"`]/g, '')
          while ((m = re.exec(text))) {
            const schema = norm((m[2] || '').replace(/\.$/, '')) || 'dbo'
            const table = norm(m[3])
            if (table) out.push({ schema, table })
          }
        } catch (_) {}
        // unique
        const key = (t) => `${t.schema}.${t.table}`.toLowerCase()
        const seen = new Set()
        return out.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)))
      },
      async gatherSqlServerAiMetadata(queryText) {
        try {
          if (this.connectionType !== 'sqlserver') return null
          const tables = this.referencedTablesFromQuery(queryText).slice(0, 12)
          if (!tables.length) return { tables: [], metaJson: '[]' }
          const chunks = []
          for (const t of tables) {
            const sql = `
DECLARE @schema sysname = N'${t.schema.replace(/'/g, "''")}';
DECLARE @table  sysname = N'${t.table.replace(/'/g, "''")}';
SELECT
  [schema] = s.name,
  [table]  = tb.name,
  [columns] = (
    SELECT c.name, ty.name AS [type], c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
           cc.definition AS computed_definition
    FROM sys.columns c
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
    WHERE c.object_id = tb.object_id
    ORDER BY c.column_id
    FOR JSON PATH
  ),
  [indexes] = (
    SELECT i.name, i.type_desc, i.is_unique, i.is_primary_key, i.filter_definition,
      (
        SELECT c.name
        FROM sys.index_columns ic
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal
        FOR JSON PATH
      ) AS keyColumns,
      (
        SELECT c.name
        FROM sys.index_columns ic
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
        ORDER BY c.column_id
        FOR JSON PATH
      ) AS includeColumns,
      (
        SELECT ISNULL(us.user_seeks,0) AS user_seeks, ISNULL(us.user_scans,0) AS user_scans,
               ISNULL(us.user_lookups,0) AS user_lookups, ISNULL(us.user_updates,0) AS user_updates
        FROM sys.dm_db_index_usage_stats us
        WHERE us.database_id = DB_ID() AND us.object_id = i.object_id AND us.index_id = i.index_id
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
      ) AS usage,
      (
        SELECT 
          ps.row_count,
          ps.reserved_page_count * 8 / 1024.0 AS size_mb,
          ps.used_page_count * 8 / 1024.0 AS used_mb,
          ps.in_row_data_page_count * 8 / 1024.0 AS data_mb
        FROM sys.dm_db_partition_stats ps
        WHERE ps.object_id = i.object_id AND ps.index_id = i.index_id
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
      ) AS size_info
    FROM sys.indexes i
    WHERE i.object_id = tb.object_id AND i.index_id > 0
    ORDER BY i.is_primary_key DESC, i.is_unique DESC, i.name
    FOR JSON PATH
  ),
  [stats] = (
    SELECT st.name, st.auto_created, st.user_created, st.has_filter, st.filter_definition,
      (
        SELECT c.name
        FROM sys.stats_columns sc
        JOIN sys.columns c ON c.object_id = sc.object_id AND c.column_id = sc.column_id
        WHERE sc.object_id = st.object_id AND sc.stats_id = st.stats_id
        ORDER BY sc.stats_column_id
        FOR JSON PATH
      ) AS columns
    FROM sys.stats st
    WHERE st.object_id = tb.object_id
    ORDER BY st.user_created DESC, st.name
    FOR JSON PATH
  ),
  [constraints] = (
    SELECT kc.name, kc.type_desc,
      (
        SELECT c.name
        FROM sys.index_columns ic
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = tb.object_id AND ic.index_id = kc.unique_index_id AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal
        FOR JSON PATH
      ) AS columns
    FROM sys.key_constraints kc
    WHERE kc.parent_object_id = tb.object_id
    ORDER BY kc.type_desc, kc.name
    FOR JSON PATH
  ),
  [foreignKeys] = (
    SELECT fk.name,
      referencing = (
        SELECT COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS column_name
        FROM sys.foreign_key_columns fkc
        WHERE fkc.constraint_object_id = fk.object_id
        ORDER BY fkc.constraint_column_id
        FOR JSON PATH
      ),
      referenced = (
        SELECT s2.name AS schema_name, OBJECT_NAME(fkc.referenced_object_id) AS table_name,
               COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS column_name
        FROM sys.foreign_key_columns fkc
        JOIN sys.objects o2 ON o2.object_id = fkc.referenced_object_id
        JOIN sys.schemas s2 ON s2.schema_id = o2.schema_id
        WHERE fkc.constraint_object_id = fk.object_id
        ORDER BY fkc.constraint_column_id
        FOR JSON PATH
      )
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id = tb.object_id
    ORDER BY fk.name
    FOR JSON PATH
  ),
  [partitioning] = (
    SELECT ps.name AS partition_scheme,
           (SELECT COUNT(DISTINCT p.partition_number) FROM sys.partitions p WHERE p.object_id = tb.object_id) AS partition_count
    FROM sys.indexes i
    LEFT JOIN sys.partition_schemes ps ON ps.data_space_id = i.data_space_id
    WHERE i.object_id = tb.object_id AND i.index_id IN (0,1)
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  ),
  [rowCounts] = (
    SELECT SUM(ps.row_count) AS row_count,
           CAST(SUM(ps.reserved_page_count) * 8 AS bigint) AS reserved_kb
    FROM sys.dm_db_partition_stats ps
    WHERE ps.object_id = tb.object_id
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  )
FROM sys.tables tb
JOIN sys.schemas s ON s.schema_id = tb.schema_id
WHERE s.name = @schema AND tb.name = @table
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;`
            const q = await this.connection.query(sql)
            const r = await q.execute()
            const row = (r && r.rows && r.rows[0]) || r.recordset && r.recordset[0] || r[0]
            const str = row && (row[Object.keys(row)[0]] || row)
            chunks.push(typeof str === 'string' ? str : JSON.stringify(str))
          }
          const metaJson = `[${chunks.filter(Boolean).join(',')}]`
          return { tables, metaJson }
        } catch (e) {
          try { console.error('AI metadata collection failed', e) } catch (_) {}
          return null
        }
      },
      updateEditorHeight() {
        let height = this.$refs.topPanel.clientHeight
        height -= this.$refs.toolbar.clientHeight
        this.editor.height = height
      },
      triggerSave() {
        if (this.query?.id) {
          this.saveQuery()
        } else {
          this.$modal.show(`save-modal-${this.tab.id}`)
        }
      },
      toggleExecutionPlan() {
        this.collectPlan = !this.collectPlan
        const status = this.collectPlan ? 'ON' : 'OFF'
        this.$noty.success(`Actual Plan: ${status}`)
      },
      toggleStatistics() {
        this.collectStatistics = !this.collectStatistics
        const status = this.collectStatistics ? 'ON' : 'OFF'
        this.$noty.success(`Statistics: ${status}`)
      },
      analyzePlanWithAI() {
        // Send "Analyze execution plan" command (same as context menu)
        if (!this.tab.planXml && (!this.tab.planXmls || this.tab.planXmls.length === 0)) {
          this.$noty.warning('No execution plan available to analyze')
          return
        }
        
        const commandPrompt = 'Analyze execution plan'
        
        // Open the AI panel
        try {
          this.$root.$emit(AppEvent.toggleSecondarySidebar, true)
          this.$root.$emit(AppEvent.selectSecondarySidebarTab, 'bks-ai-shell')
        } catch (_) {}
        
        // Use the same approach as context menu "Analyze execution plan"
        this.$nextTick(() => {
          setTimeout(() => {
            const aiFrame = document.querySelector('iframe[src*="bks-ai-shell"]')
            
            if (aiFrame && aiFrame.contentWindow) {
              console.log('[TabQueryEditor] Sending command to AI chat:', commandPrompt)
              
              // Send message to plugin to set input and submit (same as context menu)
              aiFrame.contentWindow.postMessage({
                type: 'set-and-submit-input',
                text: commandPrompt
              }, '*')
              
              if (this.$noty) {
                this.$noty.success('Analyzing execution plan', { timeout: 3000 })
              }
            } else {
              console.warn('[TabQueryEditor] AI plugin iframe not found')
              if (this.$noty) {
                this.$noty.info(`AI Mode opened. Type: ${commandPrompt}`, { timeout: 5000 })
              }
            }
          }, 300)
        })
      },
      async saveQuery() {
        if (this.remoteDeleted) return
        if (!this.hasTitle || !this.hasText) {
          this.saveError = new Error("You need both a title, and some query text.")
          return
        } else {
          try {
            const payload = _.clone(this.query)
            payload.text = this.unsavedText
            
            // Ensure query has a folder assigned (default to Personal folder)
            if (!payload.queryFolderId) {
              const folders = this.$store.state['data/queryFolders']?.items || []
              const personalFolder = folders.find(f => 
                f.workspaceId === this.$store.state.workspaceId && 
                f.name.toLowerCase().trim() === 'personal'
              )
              if (personalFolder) {
                payload.queryFolderId = personalFolder.id
                console.log('[TabQueryEditor] Assigned query to Personal folder:', personalFolder.id)
              }
            }
            
            this.$modal.hide(`save-modal-${this.tab.id}`)
            const id = await this.$store.dispatch('data/queries/save', payload)
            this.tab.queryId = id

            // Reload queries to update the sidebar count
            await this.$store.dispatch('data/queries/load')

            this.$nextTick(() => {
              this.unsavedText = this.query.text
              this.tab.title = this.query.title
              this.originalText = this.query.text
            })
            this.$noty.success('Query Saved')
          } catch (ex) {
            this.saveError = ex
            this.$noty.error(`Save Error: ${ex.message}`)
          }
        }
      },
      onChange(text) {
        this.unsavedText = text
      },
      escapeRegExp(string) {
        return string.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');
      },
      async submitQueryToFile() {
        if (this.isCommunity) {
          this.$root.$emit(AppEvent.upgradeModal)
          return;
        }
        // run the currently hilighted text (if any) to a file, else all sql
        const query_sql = this.hasSelectedText ? this.editor.selection : this.unsavedText
        const saved_name = this.hasTitle ? this.query.title : null
        const tab_title = this.tab.title // e.g. "Query #1"
        const queryName = saved_name || tab_title
        this.trigger( AppEvent.beginExport, { query: query_sql, queryName: queryName });
      },
      async submitCurrentQueryToFile() {
        if (this.isCommunity) {
          this.$root.$emit(AppEvent.upgradeModal)
          return;
        }
        // run the currently selected query (if there are multiple) to a file, else all sql
        const query_sql = this.currentlySelectedQuery ? this.currentlySelectedQuery.text : this.unsavedText
        const saved_name = this.hasTitle ? this.query.title : null
        const tab_title = this.tab.title // e.g. "Query #1"
        const queryName = saved_name || tab_title
        this.trigger( AppEvent.beginExport, { query: query_sql, queryName: queryName });
      },
      async submitCurrentQuery() {
        if(this.running) return;
        if (this.currentlySelectedQuery) {
          this.runningType = 'current'
          this.submitQuery(this.currentlySelectedQuery.text)
        } else {
          this.results = []
          this.error = 'No query to run'
        }
      },
      async submitTabQuery() {
        if(this.running) return;
        const text = this.hasSelectedText ? this.editor.selection : this.unsavedText
        this.runningType = this.hasSelectedText ? 'selection' : 'everything'
        if (text.trim()) {
          this.submitQuery(text)
        } else {
          this.error = 'No query to run'
        }
      },
      async submitQuery(rawQuery, fromModal = false) {
        if (this.remoteDeleted) return;

        //Cancel existing query before starting a new one
        if(this.running && this.runningQuery){
          await this.cancelQuery();
        }

        this.tab.isRunning = true
        this.running = true
        this.error = null
        // Clear error from tab object using $set for reactivity
        this.$set(this.tab, 'error', null)
        console.log('[TabQueryEditor] Cleared error before query execution')
        this.queryForExecution = rawQuery
        this.results = []
        this.selectedResult = 0
        let identification = []
        try {
          identification = identify(rawQuery, { strict: false, dialect: this.identifyDialect, identifyTables: true })
        } catch (ex) {
          log.error("Unable to identify query", ex)
        }

        try {
          if (this.hasParams && (!fromModal || this.paramsModalRequired)) {
            const params = this.individualQueries.flatMap((qs) => qs.parameters);
            if (canDeparameterize(params)) {
              this.$modal.show(`parameters-modal-${this.tab.id}`)
              return;
            } else {
              this.error = `You can't use positional and non-positional parameters at the same time`
              return;
            }
          }

          // Keep both the original text and the deparameterized one.
          // We MUST base GO detection/splitting on the original text to avoid any formatter changes.
          const originalQuery = rawQuery
          let query = this.deparameterizedQuery
          this.$modal.hide(`parameters-modal-${this.tab.id}`)
          this.runningCount = identification.length || 1
          // Dry run is for bigquery, allows query cost estimations
          // MSSQL SHOWPLAN/STATISTICS XML must be in their own batches. If present in the text,
          // run them as separate statements and execute the user query without the SET lines.
          const isMssql = this.connectionType === 'sqlserver'
          
          // Check for GO batch separator BEFORE any query modifications using the ORIGINAL text
          // Handle both \r\n (Windows) and \n (Unix) line endings
          const hasGo = isMssql && /^\s*GO\s*(?:\d+)?\s*$/im.test(originalQuery.replace(/\r\n/g, '\n'))
          
          console.log('[TabQueryEditor] isMssql:', isMssql)
          console.log('[TabQueryEditor] hasGo:', hasGo)
          console.log('[TabQueryEditor] Original query (first 200 chars):', originalQuery.substring(0, 200))
          console.log('[TabQueryEditor] Query with visible line breaks:', JSON.stringify(originalQuery.substring(0, 200)))
          console.log('[TabQueryEditor] Query lines (split by \\n):', originalQuery.split('\n').map((l, i) => `${i}: "${l}"`).join(', '))
          console.log('[TabQueryEditor] Query lines (split by \\r\\n):', originalQuery.split('\r\n').map((l, i) => `${i}: "${l}"`).join(', '))
          
          // Check if GO is on same line as other SQL (common copy-paste issue)
          if (isMssql && !hasGo && /\bGO\s+[A-Z]/i.test(query)) {
            this.error = 'GO must be on its own line. It appears GO and other SQL are on the same line. Please add a line break after GO.'
            this.running = false
            this.tab.isRunning = false
            return
          }
          
          const hasShowPlan = /\bSET\s+SHOWPLAN_XML\s+ON\b/i.test(query)
          const hasStatsXml = /\bSET\s+STATISTICS\s+XML\s+ON\b/i.test(query)

          // If user enabled auto-statistics collection (IO and TIME):
          if (isMssql && this.collectStatistics && !hasGo) {
            const hasStatsIO = /\bSET\s+STATISTICS\s+IO\s+ON\b/i.test(query)
            const hasStatsTime = /\bSET\s+STATISTICS\s+TIME\s+ON\b/i.test(query)
            if (!hasStatsIO && !hasStatsTime) {
              query = `SET STATISTICS IO ON;\nSET STATISTICS TIME ON;\n${query}\nSET STATISTICS IO OFF;\nSET STATISTICS TIME OFF;`
            }
          }

          // If user enabled auto-plan collection:
          // - Prefer Actual (STATISTICS XML) over Estimated (SHOWPLAN XML) when both toggles are on
          if (isMssql && this.collectPlan && !hasShowPlan && !hasStatsXml && !hasGo) {
            query = `SET STATISTICS XML ON;\n${query}\nSET STATISTICS XML OFF;`
          } else if (isMssql && this.collectEstimatedPlan && !hasShowPlan && !hasStatsXml && !hasGo) {
            // For SHOWPLAN mode we must run ON and OFF in separate batches around the user query
            // We will use the SHOWPLAN code path below by simulating hasShowPlan=true via a flag
            // by injecting a marker; instead, handle explicitly by setting a local flag
            // We'll route to the SHOWPLAN branch using local variable
          }

          let results
          const queryStartTime = new Date()
          // IMPORTANT:
          // - SHOWPLAN_XML must be the only statement in its batch, and requires the SAME SESSION
          //   for subsequent queries to emit plans. Our client may not guarantee session pinning
          //   across separate connection.query calls, so we only split for SHOWPLAN.
          // - STATISTICS XML ON should be sent in the SAME batch as the query (do NOT split),
          //   otherwise the ON may apply to a different session and no plan will be returned.
          // Route to SHOWPLAN flow either when query contains SHOWPLAN already, or when user toggled Estimated Plan
          if (isMssql && (hasShowPlan || (this.collectEstimatedPlan && !hasStatsXml && !this.collectPlan))) {
            console.log('[TabQueryEditor] Taking SHOWPLAN path')
            const onCmd = 'SET SHOWPLAN_XML ON'
            const offCmd = 'SET SHOWPLAN_XML OFF'
            const userQuery = query
              .replace(/^\s*SET\s+SHOWPLAN_XML\s+ON\s*;?/gim, '')
              .replace(/^\s*SET\s+SHOWPLAN_XML\s+OFF\s*;?/gim, '')
              .trim()

            // 1) Enable plan collection
            try { await (await this.connection.query(onCmd)).execute() } catch (_) {}
            // 2) Run the actual query
            this.runningQuery = await this.connection.query(userQuery, { dryRun: this.dryRun });
            results = await this.runningQuery.execute();
            // 3) Disable plan collection (best effort)
            try { await (await this.connection.query(offCmd)).execute() } catch (_) {}
          } else {
            console.log('[TabQueryEditor] Taking default path, hasGo:', hasGo)
            // Default path: send the user's batch as-is. This preserves STATISTICS XML ON semantics
            // where the plan is returned as an additional result set in the same session.
            
            // For SQL Server, handle GO batch separator
            if (hasGo) {
              // Split query by GO and execute each batch separately
              // Use the ORIGINAL query (originalQuery) not the modified one
              const batches = splitSqlServerGoBatches(originalQuery)
              results = []
              
              console.log('[TabQueryEditor] Detected GO separator, splitting into', batches.length, 'batches')
              
              for (const batch of batches) {
                if (batch.trim()) {
                  console.log('[TabQueryEditor] Executing batch:', batch.substring(0, 100))
                  this.runningQuery = await this.connection.query(batch, { dryRun: this.dryRun });
                  const batchResults = await this.runningQuery.execute();
                  // Merge results from each batch
                  results.push(...batchResults)
                }
              }
            } else {
              // No GO separator, execute as single query
              this.runningQuery = await this.connection.query(query, { dryRun: this.dryRun });
              results = await this.runningQuery.execute();
            }
          }
          const queryEndTime = new Date()
          
          // Handle USE database command for SQL Server
          if (isMssql) {
            // Match USE statement even if followed by GO or other content
            const useDbMatch = /^\s*USE\s+\[?(\w+)\]?\s*;?/im.exec(query)
            if (useDbMatch && useDbMatch[1]) {
              const newDatabase = useDbMatch[1]

              // Only auto-switch the app database if the executed batch is effectively just `USE <db>`.
              // This prevents restored tabs / multi-statement batches from unexpectedly overriding
              // the user's selected database (e.g. flipping back to master).
              const remainder = String(query)
                .replace(/^\s*USE\s+\[?\w+\]?\s*;?/im, '')
                .replace(/^\s*GO\s*$/gim, '')
                .trim()

              if (!remainder) {
                try {
                  await this.$store.dispatch('changeDatabase', newDatabase)
                  this.$noty.success(`Switched to database: ${newDatabase}`)
                } catch (err) {
                  console.error('Failed to switch database:', err)
                  this.$noty.error(`Failed to switch to database: ${newDatabase}`)
                }
              }
            }
          }

          // https://github.com/sqlmind-studio/sqlmind-studio/issues/1435
          if (!document.hasFocus() && window.Notification && Notification.permission === "granted") {
            new window.Notification("Query Complete", {
              body: `${this.tab.title} has been executed successfully.`,
            });
          }

          // eslint-disable-next-line
          // @ts-ignore
          this.executeTime = queryEndTime - queryStartTime
          let totalRows = 0
          results.forEach((result, idx) => {
            result.rowCount = result.rowCount || 0

            // TODO (matthew): remove truncation logic somewhere sensible
            totalRows += result.rowCount
            if (result.rowCount > this.$bksConfig.ui.queryEditor.maxResults) {
              result.rows = _.take(result.rows, this.$bksConfig.ui.queryEditor.maxResults)
              result.truncated = true
              result.totalRowCount = result.rowCount
            }

            const identifiedTables = identification[idx]?.tables || []
            if (identifiedTables.length > 0) {
              result.tableName = identifiedTables[0]
            } else {
              result.tableName = "mytable"
            }
            result.schema = this.defaultSchema
          })
          this.results = Object.freeze(results);

          // Extract and store execution plan XMLs (SQL Server)
          try {
            // Check if query explicitly disabled statistics without enabling it
            const hasStatsXmlOff = /\bSET\s+STATISTICS\s+XML\s+OFF\b/i.test(query)
            const hasStatsXmlOn = /\bSET\s+STATISTICS\s+XML\s+ON\b/i.test(query)
            const hasShowPlanOff = /\bSET\s+SHOWPLAN_XML\s+OFF\b/i.test(query)
            const hasShowPlanOn = /\bSET\s+SHOWPLAN_XML\s+ON\b/i.test(query)
            
            // Only extract plans if auto-collection is enabled via UI buttons
            // If user has disabled execution plan collection, don't extract plans
            const shouldExtractPlan = 
              this.collectPlan ||                       // Auto-collection enabled
              this.collectEstimatedPlan ||              // Auto-collection enabled
              (hasStatsXmlOn && !hasStatsXmlOff) ||    // Explicit STATISTICS XML ON in query
              (hasShowPlanOn && !hasShowPlanOff)       // Explicit SHOWPLAN XML ON in query
            
            console.log(`[TabQueryEditor] shouldExtractPlan: ${shouldExtractPlan}, collectPlan: ${this.collectPlan}, collectEstimatedPlan: ${this.collectEstimatedPlan}`)
            
            if (shouldExtractPlan) {
              const plans = this.extractAllPlanXmls(results)
              console.log(`[TabQueryEditor] Extracted ShowPlanXML count: ${plans ? plans.length : 0}`)
              if (plans && plans.length) {
                this.$set(this.tab, 'planXmls', plans)
                this.$set(this.tab, 'planXml', plans[0]) // Set to first plan, not last
                // Auto-switch to Execution Plan tab to show the result
                this.activeSubTab = 'plan'
              } else {
                this.$set(this.tab, 'planXmls', [])
                this.$set(this.tab, 'planXml', '')
              }
            } else {
              // Explicitly disabled - clear any previous plans
              console.log('[TabQueryEditor] Execution plan collection disabled, clearing plans')
              this.$set(this.tab, 'planXmls', [])
              this.$set(this.tab, 'planXml', '')
            }
          } catch (e) {
            console.error('[TabQueryEditor] Error in execution plan extraction:', e)
          }

          // Capture STATISTICS messages (if any) and expose to the Statistics subtab
          try {
            // Separate statistics messages by query result to maintain proper grouping
            const queryStats = (results || []).map((r, idx) => {
              const m = (r && r.messages) ? r.messages : []
              const msgs = Array.isArray(m) ? m : (m ? [String(m)] : [])
              return msgs.join('\n')
            }).filter(s => s.trim())
            
            // Join with double newlines to help parser distinguish between queries
            const statsText = queryStats.join('\n\n').trim()
            if (statsText) {
              this.$set(this.tab, 'statsData', statsText)
              // Do not auto-switch tabs; avoid layout shift while running
            } else {
              this.$set(this.tab, 'statsData', '')
            }
          } catch (e) {
            // non-fatal
          }

          // Collect messages for Messages tab
          // For commands like DBCC that don't return result sets, check if runningQuery has messages
          let allMessages = []
          if (this.runningQuery && this.runningQuery.messages) {
            allMessages = Array.isArray(this.runningQuery.messages) ? this.runningQuery.messages : [this.runningQuery.messages]
          }
          console.log('[TabQueryEditor] Collecting messages from results:', results)
          console.log('[TabQueryEditor] Messages from runningQuery:', allMessages)
          if (results && results.length > 0) {
            console.log('[TabQueryEditor] First result structure:', {
              hasMessages: !!results[0].messages,
              messages: results[0].messages,
              keys: Object.keys(results[0])
            })
          }
          this.queryMessages = this.collectQueryMessages(results, null, this.executeTime, allMessages)

          // Store results in the tab object for plugin access (and AI tools)
          if (this.tab && this.tab.id) {
            try { console.log('[TabQueryEditor] Storing results on tab for plugin access (result, results, lastResult)') } catch {}
            // Primary canonical field used by PluginStoreService
            this.$set(this.tab, 'result', this.results)
            // Back-compat: some code paths may still read 'results'
            this.$set(this.tab, 'results', this.results)
            // Persist last successful results for fallback when subsequent runs fail
            this.$set(this.tab, 'lastResult', this.results)
            // Store messages for AI plugin access
            this.$set(this.tab, 'queryMessages', this.queryMessages)
          }

          // Initialize selectedResult to 0 (first display result after filtering XML results)
          // The displayResults computed property will filter out execution plan XML results
          this.selectedResult = 0
          console.log("[TabQueryEditor] Set selectedResult to 0 (first display result)")

          const lastQuery = this.$store.state['data/usedQueries']?.items?.[0]
          const isDuplicate = lastQuery?.text?.trim() === query?.trim()

          const queryObj = {
            text: query,
            numberOfRecords: totalRows,
            queryId: this.query?.id,
            connectionId: this.usedConfig.id
          }

          if(lastQuery && isDuplicate){
            queryObj.updatedAt = new Date();
            queryObj.id = lastQuery.id;
          }

          this.$store.dispatch('data/usedQueries/save', queryObj)

          log.debug('identification', identification)
          const found = identification.find(i => {
            return i.type === 'CREATE_TABLE' || i.type === 'DROP_TABLE' || i.type === 'ALTER_TABLE'
          })
          if (found) {
            this.$store.dispatch('updateTables')
          }
        } catch (ex) {
          log.error(ex)
          if(this.running) {
            this.error = ex
            // Store error in tab object so it persists for "Fix with AI"
            // Use $set to ensure reactivity in Vue 2
            this.$set(this.tab, 'error', ex)
            console.log('[TabQueryEditor] SET ERROR:', ex.message || String(ex))
            console.log('[TabQueryEditor] tab.error is now:', this.tab.error)
            
            // Collect error messages for Messages tab
            this.queryMessages = this.collectQueryMessages(null, ex, null)
          }
        } finally {
          this.running = false
          this.tab.isRunning = false
        }
      },
      initializeQueries() {
        if (!this.tab.unsavedChanges && this.query?.text) {
          this.unsavedText = null
        }
        const originalText = this.query?.text || this.tab.unsavedQueryText
        if (originalText) {
          this.originalText = originalText
          this.unsavedText = originalText
        }
      },
      fakeRemoteChange() {
        this.query.text = "select * from foo"
      },
      // Right click menu handlers
      writeQuit() {
        this.triggerSave()
        if(this.query.id) {
          this.close()
        }
      },
      async switchPaneFocus(_event?: KeyboardEvent, target?: 'text-editor' | 'table') {
        if (target) {
          this.focusElement = target
        } else {
          this.focusElement = this.focusElement === 'text-editor'
            ? 'table'
            : 'text-editor'
        }
      },
      blurTextEditor() {
        let timedOut = false
        let resolved = false
        return new Promise<void>((resolvePromise) => {
          const resolve = () => {
            this.onTextEditorBlur = null
            resolvePromise()
          }
          this.onTextEditorBlur = () => {
            resolved = true
            if (!timedOut) {
              resolve()
            }
          }
          setTimeout(() => {
            if (!resolved) {
              timedOut = true
              log.warn('Timed out waiting for text editor to blur')
              resolve()
            }
          }, 1000)
          this.focusingElement = 'none'
        })
      },
      async columnsGetter(tableName: string) {
        let table = this.tables.find(
          (t: TableOrView) => t.name === tableName || `${t.schema}.${t.name}` === tableName
        );

        if (!table) {
          return null;
        }

        // Only refresh columns if we don't have them cached.
        if (!table.columns?.length) {
          await this.$store.dispatch("updateTableColumns", table);
          table = this.tables.find(
            (t: TableOrView) => t.name === tableName || `${t.schema}.${t.name}` === tableName
          );
        }

        return table?.columns.map((c) => c.columnName);
      },
      handleQuerySelectionChange({ queries, selectedQuery }) {
        this.individualQueries = queries;
        this.currentlySelectedQuery = selectedQuery;
      },
      startTimer() {
        this.elapsedTime = 0;
        this.timerInterval = setInterval(() => {
          this.elapsedTime += 1;
        }, 1000);
      },
      stopTimer() {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      },
      editorContextMenu(_event, _context, items) {
        console.log('[TabQueryEditor] editorContextMenu called, items:', items.map(i => i.label || i.type));
        // Find "Format Query" item to insert AI options after it
        const formatIndex = items.findIndex((item) => item.label === "Format Query");
        console.log('[TabQueryEditor] formatIndex:', formatIndex);
        
        const aiMenuItems = [
          {
            type: "divider",
          },
          {
            label: "Document",
            handler: () => {
              // Check if Inline AI is already open
              const isOpen = this.$parent && this.$parent.showInlineAI;
              
              if (!isOpen) {
                this.$root.$emit(AppEvent.toggleInlineAI);
              }
              
              this.$nextTick(() => {
                this.$root.$emit(AppEvent.aiInlinePrompt, { 
                  prompt: 'Document this SQL query with detailed comments explaining what each part does', 
                  runAfterInsert: false,
                  aiMode: 'code'
                });
              });
            },
          },
          {
            label: "Explain",
            handler: () => {
              // Check if Inline AI is already open
              const isOpen = this.$parent && this.$parent.showInlineAI;
              
              if (!isOpen) {
                this.$root.$emit(AppEvent.toggleInlineAI);
              }
              
              this.$nextTick(() => {
                this.$root.$emit(AppEvent.aiInlinePrompt, { 
                  prompt: 'Analyze this SQL query by examining the schema and indexes. Explain if this query will perform well or not. If not, provide the best optimized query with recommendations. If it\'s already optimal, just provide recommendations for maintaining good performance.', 
                  runAfterInsert: false,
                  aiMode: 'code'
                });
              });
            },
          },
          {
            label: "Fix with AI",
            handler: () => {
              console.log('[TabQueryEditor] Fix with AI context menu clicked');
              // Check if there's a text selection
              const hasSelection = this.hasSelectedText;
              
              // Use @query rewrite command - works with selection or entire query
              const prompt = hasSelection 
                ? 'Fix errors in the selected query and comment out the broken parts'
                : 'Fix this error and comment out the broken query';
              
              console.log('[TabQueryEditor] Fix with AI prompt:', prompt, 'hasSelection:', hasSelection);
              
              // Check if Inline AI is already open
              const isOpen = this.$parent && this.$parent.showInlineAI;
              
              if (!isOpen) {
                console.log('[TabQueryEditor] Opening inline AI');
                this.$root.$emit(AppEvent.toggleInlineAI);
              }
              
              this.$nextTick(() => {
                console.log('[TabQueryEditor] Emitting aiInlinePrompt event');
                this.$root.$emit(AppEvent.aiInlinePrompt, { 
                  prompt, 
                  runAfterInsert: true,  // Auto-run after fixing
                  aiMode: 'code'
                });
              });
            },
          },
          {
            label: "Rewrite with AI",
            handler: () => {
              console.log('[TabQueryEditor] Rewrite with AI context menu clicked');
              
              // Check if there's a text selection and calculate line numbers
              let commandPrompt = 'Rewrite query ';
              
              if (this.hasSelectedText && this.editor.selection) {
                // Calculate line numbers from selection
                const fullText = this.unsavedText || '';
                const selectedText = this.editor.selection;
                
                // Find the start position of the selection in the full text
                const selectionStart = fullText.indexOf(selectedText);
                
                if (selectionStart !== -1) {
                  // Count lines before selection to get starting line number
                  const textBeforeSelection = fullText.substring(0, selectionStart);
                  const fromLine = (textBeforeSelection.match(/\n/g) || []).length + 1;
                  
                  // Count lines in selection to get ending line number
                  const linesInSelection = (selectedText.match(/\n/g) || []).length;
                  const toLine = fromLine + linesInSelection;
                  
                  commandPrompt = `Rewrite query /fromLineNumber=${fromLine} /toLineNumber=${toLine}`;
                  console.log('[Fine-Tune] Selection detected, lines:', fromLine, 'to', toLine);
                }
              }
              
              console.log('[TabQueryEditor] Sending command to AI chat:', commandPrompt);
              
              // Gather execution plan and statistics data if available
              const contextData: any = {};
              
              // Get execution plan XML if available
              if (this.tab.planXml) {
                contextData.executionPlanXml = this.tab.planXml;
                console.log('[Fine-Tune] Including execution plan XML, length:', this.tab.planXml.length);
              } else if (this.tab.planXmls && this.tab.planXmls.length > 0) {
                // Use the most recent plan
                contextData.executionPlanXml = this.tab.planXmls[this.tab.planXmls.length - 1];
                console.log('[Fine-Tune] Including execution plan XML from planXmls, length:', contextData.executionPlanXml.length);
              }
              
              // Get statistics data (STATISTICS IO, STATISTICS TIME messages)
              if (this.tab.statsData) {
                contextData.statistics = this.tab.statsData;
                console.log('[Fine-Tune] Including statistics data (IO/TIME), length:', this.tab.statsData.length);
              }
              
              // Get query results metadata (row counts, execution time)
              if (this.tab.result || this.tab.results) {
                const results = this.tab.result || this.tab.results;
                if (results && Array.isArray(results)) {
                  contextData.queryResults = {
                    resultCount: results.length,
                    totalRows: results.reduce((sum, r) => sum + (r.rowCount || 0), 0),
                    executeTime: this.tab.executeTime || this.executeTime || 0,
                    results: results.map(r => ({
                      rowCount: r.rowCount || 0,
                      truncated: r.truncated || false,
                      tableName: r.tableName,
                      schema: r.schema,
                      messages: r.messages || []
                    }))
                  };
                  console.log('[Fine-Tune] Including query results metadata:', contextData.queryResults.resultCount, 'results,', contextData.queryResults.totalRows, 'total rows');
                }
              }
              
              // Open AI sidebar
              this.$root.$emit(AppEvent.selectSecondarySidebarTab, 'bks-ai-shell');
              this.$root.$emit(AppEvent.toggleSecondarySidebar, true);
              
              // Send command to AI chat window
              this.$nextTick(() => {
                try {
                  // Find the AI plugin iframe
                  const frames = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
                  const aiFrame = frames.find(f => {
                    const src = (f.getAttribute('src') || f.src || '').toString();
                    return src.includes('plugin://bks-ai-shell') || src.includes('/bks-ai-shell/');
                  });
                  
                  if (aiFrame && aiFrame.contentWindow) {
                    console.log('[Fine-Tune] Sending command to AI chat with context:', commandPrompt, 'hasExecutionPlan:', !!contextData.executionPlanXml, 'hasStatistics:', !!contextData.statistics);
                    
                    // Send message to plugin to set input and submit with context data
                    aiFrame.contentWindow.postMessage({
                      type: 'set-and-submit-input',
                      text: commandPrompt,
                      context: contextData
                    }, '*');
                    
                    if (this.$noty) {
                      const message = this.hasSelectedText 
                        ? `Rewriting selected lines for optimization`
                        : `Rewriting query for optimization`;
                      this.$noty.success(message, { timeout: 3000 });
                    }
                  } else {
                    console.warn('[Fine-Tune] AI plugin iframe not found');
                    if (this.$noty) {
                      this.$noty.info(`AI Mode opened. Type: ${commandPrompt}`, { timeout: 5000 });
                    }
                  }
                } catch (err) {
                  console.error('[Fine-Tune] Error:', err);
                }
              });
            },
          },
        ];
        
        // Insert AI menu items after "Format Query"
        if (formatIndex !== -1) {
          return [
            ...items.slice(0, formatIndex + 1),
            ...aiMenuItems,
            ...items.slice(formatIndex + 1),
            ...this.getExtraPopupMenu("editor.query", { transform: "ui-kit" }),
          ];
        }
        
        return [
          ...items,
          ...this.getExtraPopupMenu("editor.query", { transform: "ui-kit" }),
        ];
      },
    },
    async mounted() {
      if (this.shouldInitialize) {
        await this.$nextTick()
        this.initialize()
      }

      this.containerResizeObserver = new ResizeObserver(() => {
        this.updateEditorHeight()
      })
      this.containerResizeObserver.observe(this.$refs.container)

      if (this.active) {
        await this.$nextTick()
        this.focusElement = 'text-editor'
      }

      this.vimKeymaps = await getVimKeymapsFromVimrc()
    },
    beforeDestroy() {
      if (this.split) {
        this.split.destroy()
      }
      this.$root.$off(AppEvent.runActiveQuery, this.submitTabQuery)
      this.$root.$off(AppEvent.toggleBottomPanel, this.toggleBottomPanel)
      this.containerResizeObserver.disconnect()
    },
    created() {
      this.$root.$on(AppEvent.runActiveQuery, this.submitTabQuery)
      this.$root.$on(AppEvent.toggleBottomPanel, this.toggleBottomPanel)
    }
  })
</script>

<style scoped lang="scss">
/* Execution Plan and Statistics toggle buttons in toolbar */
.toolbar .execution-plan-toggle-btn,
.toolbar .statistics-toggle-btn {
  transition: all 0.2s ease;
  
  i.material-icons {
    font-size: 18px;
    margin-right: 4px;
    vertical-align: middle;
    transition: color 0.2s ease;
  }
  
  /* Inactive state - gray */
  &:not(.active) {
    background: var(--theme-bg-alt);
    border-color: var(--theme-border);
    color: var(--theme-muted);
    
    i.material-icons {
      color: var(--theme-muted);
    }
    
    &:hover {
      background: var(--theme-bg-hover);
      color: var(--theme-base);
      
      i.material-icons {
        color: var(--theme-base);
      }
    }
  }
  
  /* Active state - green/success color */
  &.active {
    background: rgba(34, 197, 94, 0.15); /* green background */
    border-color: rgb(34, 197, 94); /* green border */
    color: rgb(22, 163, 74); /* darker green text */
    
    i.material-icons {
      color: rgb(34, 197, 94); /* green icon */
    }
    
    &:hover {
      background: rgba(34, 197, 94, 0.25);
      border-color: rgb(22, 163, 74);
    }
  }
}

.subtabs {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.subtab-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--theme-bg-alt);
  color: var(--theme-base);
  border: 1px solid var(--theme-border);
  padding: 6px 12px;
  border-radius: 8px; /* like main tabs */
  cursor: pointer;
  font-size: 0.85rem; /* match main tabs */
  font-weight: normal; /* match main tabs */
  transition: background .2s ease, color .2s ease, border-color .2s ease, box-shadow .2s ease, transform .08s ease, opacity .2s ease;
}

.subtab-btn:hover {
  background: var(--theme-bg-hover);
  border-color: var(--theme-border);
}

.subtab-btn:active {
  transform: translateY(1px);
}

.subtab-btn.active {
  background: var(--theme-bg);
  color: var(--theme-base);
  border-color: var(--theme-border);
  font-weight: 600; /* match active main tab */
}

.subtab-btn .material-icons-outlined {
  font-size: 18px;
  color: var(--theme-warning, #facc15); /* yellow icons */
}

/* Compact on smaller widths */
@media (max-width: 900px) {
  .subtab-btn { padding: 5px 10px; }
}
@media (max-width: 640px) {
  .subtab-btn span { display: none; }
  .subtab-btn { padding: 6px; }
}

.bottom-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0; /* allow children to shrink for scrolling */
  overflow: hidden; /* isolate scrolling to inner views to avoid frame jumps */
  scrollbar-gutter: stable; /* reserve gutter to prevent horizontal reflow */
}

/* Make the active content area (between subtabs and status bar) flex and scroll */
.bottom-panel > result-table,
.bottom-panel > .message,
.bottom-panel > .statistics-subtab,
.bottom-panel > .execution-plan,
.bottom-panel > progress-bar {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden; /* Let child components handle scrolling */
}

/* Result table doesn't need padding since we adjust tableHeight in JS */
.bottom-panel > result-table {
  padding-bottom: 0;
}

/* Other content areas need padding for status bar */
.bottom-panel > .message {
  overflow: auto;
  padding-bottom: 2.6rem;
}

.statistics-subtab {
  flex: 1 1 auto;
  min-height: 0; /* critical for nested scroll containers */
  overflow: hidden; /* Let TabStatistics handle scrolling */
  padding: 0; /* No padding needed, TabStatistics has its own */
}

/* Ensure the embedded component stretches to enable internal scrolling */
.statistics-subtab > * {
  height: 100%;
}

/* Messages subtab styling */
.messages-subtab {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  background: var(--theme-bg);
}

.message-text-block {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--theme-bg-alt);
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
  font-size: 0.85rem;
  line-height: 1.5;
}

.message-text-content {
  max-height: 600px;
  overflow-y: auto;
  color: var(--theme-base);
}

.message-line {
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 0;
  padding: 2px 0;
}

.messages-container {
  max-width: 1200px;
  margin: 0 auto;
}

.messages-header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--theme-border);
}

.messages-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--theme-base);
}

.messages-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--theme-border);
  background: var(--theme-bg-alt);
  transition: background 0.2s ease;
}

.message-item:hover {
  background: var(--theme-bg-hover);
}

.message-item.success {
  border-left: 4px solid #22c55e;
  background: rgba(34, 197, 94, 0.05);
}

.message-item.error {
  border-left: 4px solid #ef4444;
  background: rgba(239, 68, 68, 0.05);
}

.message-item.warning {
  border-left: 4px solid #f59e0b;
  background: rgba(245, 158, 11, 0.05);
}

.message-item.info {
  border-left: 4px solid #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.message-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.message-item.success .message-icon {
  color: #22c55e;
}

.message-item.error .message-icon {
  color: #ef4444;
}

.message-item.warning .message-icon {
  color: #f59e0b;
}

.message-item.info .message-icon {
  color: #3b82f6;
}

.message-text {
  flex: 1;
  min-width: 0;
}

.message-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--theme-base);
  margin-bottom: 4px;
}

.message-details {
  font-size: 0.9rem;
  color: var(--theme-secondary);
  word-wrap: break-word;
}

.message-timestamp {
  font-size: 0.8rem;
  color: var(--theme-secondary);
  margin-top: 6px;
  opacity: 0.7;
}

.no-messages {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--theme-secondary);
}

.no-messages i {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.no-messages p {
  margin: 0;
  font-size: 0.95rem;
  max-width: 500px;
}

/* Execution plan has its own scrolling, remove extra padding */
.bottom-panel > .execution-plan {
  padding-bottom: 0;
}
</style>
