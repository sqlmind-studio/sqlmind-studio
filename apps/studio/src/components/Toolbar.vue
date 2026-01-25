<template>
  <div class="toolbar-root">
  <div class="app-toolbar">
    <div class="toolbar-section toolbar-left">
      <!-- File Actions -->
      <button
        class="toolbar-btn"
        @click="handleNewWindow"
        title="New Window (Ctrl+Shift+N)"
      >
        <i class="material-icons">add_box</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleNewTab"
        title="New Tab (Ctrl+T)"
        :disabled="!connected"
      >
        <i class="material-icons">add</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleCloseTab"
        title="Close Tab (Ctrl+W)"
        :disabled="!connected"
      >
        <i class="material-icons">close</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleImportSqlFiles"
        title="Import SQL Files (Ctrl+I)"
        :disabled="!connected"
      >
        <i class="material-icons">upload_file</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleQuickSearch"
        title="Quick Search (Ctrl+P)"
        :disabled="!connected"
      >
        <i class="material-icons">search</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleDisconnect"
        title="Disconnect (Shift+Ctrl+Q)"
        :disabled="!connected"
      >
        <i class="material-icons">power_settings_new</i>
      </button>
      
      <span class="toolbar-separator" aria-hidden="true">|</span>
      
      <!-- Database Selector -->
      <div class="toolbar-database-selector" v-if="connected">
        <select 
          class="database-dropdown"
          v-model="selectedDatabase"
          @change="handleDatabaseChange"
          title="Select Database"
        >
          <option value="" disabled>Select Database</option>
          <option v-for="db in databaseList" :key="db" :value="db">
            {{ db }}
          </option>
        </select>
      </div>
      
      <!-- Execute Button -->
      <button
        class="toolbar-btn toolbar-btn-execute"
        @click="handleExecute"
        title="Execute (F5)"
        :disabled="!connected"
      >
        <i class="material-icons">play_arrow</i>
        <span class="btn-label">Execute</span>
      </button>
      
      <span class="toolbar-separator" aria-hidden="true">|</span>
      
      <!-- Edit Actions -->
      <button
        class="toolbar-btn"
        @click="handleUndo"
        title="Undo (Ctrl+Z)"
      >
        <i class="material-icons">undo</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleRedo"
        :title="redoShortcut"
      >
        <i class="material-icons">redo</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleCut"
        title="Cut (Ctrl+X)"
      >
        <i class="material-icons">content_cut</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleCopy"
        title="Copy (Ctrl+C)"
      >
        <i class="material-icons">content_copy</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handlePaste"
        title="Paste (Ctrl+V)"
      >
        <i class="material-icons">content_paste</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleSelectAll"
        title="Select All (Ctrl+A)"
      >
        <i class="material-icons">select_all</i>
      </button>
      
      <span class="toolbar-separator" aria-hidden="true">|</span>
      
      <!-- View Actions -->
      <button
        class="toolbar-btn"
        @click="handleZoomReset"
        title="Reset Zoom (Ctrl+0)"
      >
        <i class="material-icons">fit_screen</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleZoomIn"
        title="Zoom In (Ctrl+=)"
      >
        <i class="material-icons">zoom_in</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleZoomOut"
        title="Zoom Out (Ctrl+-)"
      >
        <i class="material-icons">zoom_out</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleFullscreen"
        :title="fullscreenShortcut"
      >
        <i class="material-icons">fullscreen</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleTogglePrimarySidebar"
        title="Toggle Primary Sidebar"
        :disabled="!connected"
      >
        <svg viewBox="0 0 24 24" class="icon-sidebar-left" :class="{ 'is-open': primarySidebarOpen }" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>
          <rect x="4.5" y="5" width="5" height="14" rx="1" class="panel"/>
        </svg>
      </button>
      <button
        class="toolbar-btn"
        @click="handleToggleBottomPanel"
        title="Toggle Bottom Panel"
        :disabled="!connected"
      >
        <svg viewBox="0 0 24 24" class="icon-panel-bottom" :class="{ 'is-open': bottomPanelOpen }" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>
          <rect x="5" y="14.5" width="14" height="5" rx="1" class="panel"/>
        </svg>
      </button>
      <button
        class="toolbar-btn"
        @click="handleToggleSecondarySidebar"
        title="Toggle Secondary Sidebar"
        :disabled="!connected"
      >
        <svg viewBox="0 0 24 24" class="icon-sidebar-right" :class="{ 'is-open': secondarySidebarOpen }" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>
          <rect x="14.5" y="5" width="5" height="14" rx="1" class="panel"/>
        </svg>
      </button>
      
      <span class="toolbar-separator" aria-hidden="true">|</span>
      
      <!-- Tools Actions -->
      <button
        class="toolbar-btn"
        @click="handleReload"
        title="Reload Window (Ctrl+Shift+R)"
      >
        <i class="material-icons">refresh</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleBackupDatabase"
        title="Create a Database Backup"
        :disabled="!connected"
      >
        <i class="material-icons">backup</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleRestoreDatabase"
        title="Restore a Database Backup"
        :disabled="!connected"
      >
        <i class="material-icons">restore</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleExportTables"
        title="Export Data"
        :disabled="!connected"
      >
        <i class="material-icons">download</i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleManagePlugins"
        title="Manage Plugins"
      >
        <i class="material-icons">extension</i>
      </button>
      
      <span class="toolbar-separator" aria-hidden="true">|</span>

      <!-- Statistics Parser -->
      <button
        class="toolbar-btn"
        @click="handleStatistics"
        title="Statistics Parser - Parse SQL Server IO and Time statistics"
      >
        <i class="material-icons">analytics</i>
      </button>

      <!-- Paste Execution Plan -->
      <button
        class="toolbar-btn"
        @click="handlePasteExecutionPlan"
        title="Paste Execution Plan XML - View external execution plans"
      >
        <i class="material-icons">description</i>
      </button>

      <!-- Execution Plan Toggles (SQL Server) -->
      <button
        class="toolbar-btn"
        :disabled="!isSqlServerQueryTab"
        :class="{ active: isSqlServerQueryTab && actualPlanOn }"
        @click="handleToggleActualPlan"
        :title="isSqlServerQueryTab ? 'Collect Actual Execution Plan (STATISTICS XML)' : 'Execution Plan toggles are available for SQL Server tabs'"
      >
        <i class="material-icons" :style="{ color: (isSqlServerQueryTab && actualPlanOn) ? '#f9a825' : '' }">account_tree</i>
      </button>
      <button
        class="toolbar-btn"
        :disabled="!isSqlServerQueryTab"
        :class="{ active: isSqlServerQueryTab && estimatedPlanOn }"
        @click="handleToggleEstimatedPlan"
        :title="isSqlServerQueryTab ? 'Collect Estimated Plan (SHOWPLAN XML)' : 'Execution Plan toggles are available for SQL Server tabs'"
      >
        <i class="material-icons" :style="{ color: (isSqlServerQueryTab && estimatedPlanOn) ? '#f9a825' : '' }">schema</i>
      </button>

      <span class="toolbar-separator" aria-hidden="true">|</span>

      <!-- AI Tools Section -->
      <!-- Inline AI -->
      <button
        class="toolbar-btn toolbar-btn-with-text"
        @click="handleToggleInlineAI"
        title="Inline AI (Ctrl+K)"
      >
        <i class="material-icons">auto_fix_high</i>
        <span class="btn-text">Inline AI</span>
      </button>
      
      <!-- Fix with AI -->
      <button
        class="toolbar-btn toolbar-btn-with-text"
        @click="handleFixWithAI"
        title="Fix with AI - Fix query errors in active tab"
      >
        <i class="material-icons">build_circle</i>
        <span class="btn-text">Fix with AI</span>
      </button>

      <!-- Analyze Execution Plan with AI -->
      <button
        class="toolbar-btn toolbar-btn-with-text"
        :disabled="!isSqlServerQueryTab"
        @click="handleAnalyzePlanWithAI"
        :title="isSqlServerQueryTab ? 'Deep Execution Plan Analysis with AI' : 'Execution Plan analysis is available for SQL Server tabs'"
      >
        <i class="material-icons">insights</i>
        <span class="btn-text">Analyze Plan-Deep</span>
      </button>
    </div>
    
    <!-- Theme Selector on Right -->
    <div class="toolbar-section toolbar-right">
      <div class="theme-dropdown">
        <button
          class="toolbar-btn theme-btn"
          @click="toggleThemeMenu"
          title="Theme"
        >
          <i class="material-icons">palette</i>
          <i class="material-icons dropdown-arrow">arrow_drop_down</i>
        </button>
        <div class="theme-menu" v-if="showThemeMenu" @click.stop>
          <div
            class="theme-menu-item"
            :class="{ active: currentTheme === 'system' }"
            @click="selectTheme('system')"
          >
            <i class="material-icons check-icon">{{ currentTheme === 'system' ? 'check' : '' }}</i>
            <i class="material-icons theme-icon">computer</i>
            <span>System</span>
          </div>
          <div
            class="theme-menu-item"
            :class="{ active: currentTheme === 'light' }"
            @click="selectTheme('light')"
          >
            <i class="material-icons check-icon">{{ currentTheme === 'light' ? 'check' : '' }}</i>
            <i class="material-icons theme-icon">light_mode</i>
            <span>Light</span>
          </div>
          <div
            class="theme-menu-item"
            :class="{ active: currentTheme === 'dark' }"
            @click="selectTheme('dark')"
          >
            <i class="material-icons check-icon">{{ currentTheme === 'dark' ? 'check' : '' }}</i>
            <i class="material-icons theme-icon">dark_mode</i>
            <span>Dark</span>
          </div>
          <div
            class="theme-menu-item"
            :class="{ active: currentTheme === 'solarized' }"
            @click="selectTheme('solarized')"
          >
            <i class="material-icons check-icon">{{ currentTheme === 'solarized' ? 'check' : '' }}</i>
            <i class="material-icons theme-icon">wb_sunny</i>
            <span>Solarized</span>
          </div>
          <div
            class="theme-menu-item"
            :class="{ active: currentTheme === 'solarized-dark' }"
            @click="selectTheme('solarized-dark')"
          >
            <i class="material-icons check-icon">{{ currentTheme === 'solarized-dark' ? 'check' : '' }}</i>
            <i class="material-icons theme-icon">wb_twilight</i>
            <span>Solarized Dark</span>
          </div>
          <div
            class="theme-menu-item"
            :class="{ active: currentTheme === 'ocean' }"
            @click="selectTheme('ocean')"
          >
            <i class="material-icons check-icon">{{ currentTheme === 'ocean' ? 'check' : '' }}</i>
            <i class="material-icons theme-icon">waves</i>
            <span>Ocean</span>
          </div>
          <div
            class="theme-menu-item"
            :class="{ active: currentTheme === 'dracula' }"
            @click="selectTheme('dracula')"
          >
            <i class="material-icons check-icon">{{ currentTheme === 'dracula' ? 'check' : '' }}</i>
            <i class="material-icons theme-icon">nights_stay</i>
            <span>Dracula</span>
          </div>
          <div
            class="theme-menu-item"
            :class="{ active: currentTheme === 'ssms' }"
            @click="selectTheme('ssms')"
          >
            <i class="material-icons check-icon">{{ currentTheme === 'ssms' ? 'check' : '' }}</i>
            <i class="material-icons theme-icon">storage</i>
            <span>SSMS</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <status-bar :active="analysisStatus.active">
    <div class="statusbar-info col flex expand">
      <span class="statusbar-item" :title="analysisStatus.message">
        <i class="material-icons">insights</i>
        <span class="ml-1">AI Analysis: {{ analysisStatus.message }} ({{ analysisStatus.elapsed }})</span>
      </span>
      <span class="statusbar-item" @click="cancelAnalysis" role="button" tabindex="0" title="Cancel analysis">
        <i class="material-icons">close</i>
        <span class="ml-1">Cancel</span>
      </span>
    </div>
  </status-bar>
</div>
</template>

<script>
import { mapState, mapGetters } from 'vuex'
import { AppEvent } from '@/common/AppEvent'
import ClientMenuActionHandler from '../lib/menu/ClientMenuActionHandler'
import StatusBar from '@/components/common/StatusBar.vue'
import { useAnalysisStatusStore } from '@/stores/analysisStatus'

export default {
  name: 'Toolbar',
  components: { StatusBar },
  data() {
    return {
      actionHandler: new ClientMenuActionHandler(),
      selectedDatabase: '',
      showThemeMenu: false,
      themeMenuPosition: {
        top: 0,
        left: 0
      },
      analysisStatus: { active: false, message: '', elapsed: '00:00' },
      _analysisNoty: null,
      _aiAnalysisStartedEmitted: false,
      _analysisTimer: null,
      _analysisStartedAt: 0,
      analysisFlowActive: false,
      analysisRefineAttempted: false,
      _storeTick: null,
      analysisStore: null,
      bottomPanelVisible: true,
      _stage1Prompt: '',
    }
  },
  computed: {
    ...mapState(['connected', 'activeTab', 'database', 'databaseList']),
    ...mapState('sidebar', ['primarySidebarOpen', 'secondarySidebarOpen']),
    ...mapGetters({
      currentTheme: 'settings/themeValue'
    }),
    currentDatabase() {
      // Find the database in the list with case-insensitive matching
      try {
        const db = this.database
        const list = this.databaseList
        
        // Return empty if no database
        if (!db || typeof db !== 'string') return ''
        
        // Return database as-is if no list
        if (!list || !Array.isArray(list)) return db
        
        // Find case-insensitive match
        const dbLower = db.toLowerCase()
        const dbMatch = list.find(item => 
          item && typeof item === 'string' && item.toLowerCase() === dbLower
        )
        
        return dbMatch || db
      } catch (e) {
        console.error('[Toolbar] Error in currentDatabase:', e, 'database:', this.database, 'databaseList:', this.databaseList)
        return ''
      }
    },
    bottomPanelOpen() {
      return this.bottomPanelVisible
    },
    redoShortcut() {
      return this.$config.isWindows ? 'Redo (Ctrl+Y)' : 'Redo (Shift+Ctrl+Z)'
    },
    fullscreenShortcut() {
      return this.$config.isMac ? 'Toggle Full Screen (Cmd+Ctrl+F)' : 'Toggle Full Screen (F11)'
    },
    hasActiveTab() {
      // Use Vuex state for reactivity - check tabType property
      return this.activeTab && this.activeTab.tabType === 'query'
    },
    isSqlServerQueryTab() {
      const isMssql = (s) => typeof s === 'string' && /(sqlserver|mssql)/i.test(s)
      const t = this.activeTab
      // 1) Try component instance (most reliable)
      try {
        if (t && t.id) {
          const coreTabs = this.$root.$refs.CoreTabs
          const compRef = coreTabs && coreTabs.$refs[`tab-${t.id}`]
          const tabComp = compRef && compRef[0]
          if (tabComp && isMssql(tabComp.connectionType)) return true
        }
      } catch (_) {}
      // 2) Try activeTab fields even if tabType is missing
      try {
        if (t) {
          if (isMssql(t.connectionType)) return true
          if (isMssql(t.dialect)) return true
          if (isMssql(t?.usedConfig?.client)) return true
          if (isMssql(t?.usedConfig?.client?.type)) return true
          if (isMssql(t?.connection?.client)) return true
          if (isMssql(t?.connection?.client?.type)) return true
        }
      } catch (_) {}
      // 3) Global store fallbacks
      try { if (isMssql(this.$store.state.connectionType)) return true } catch (_) {}
      try { if (isMssql(this.$store.state.usedConfig?.client)) return true } catch (_) {}
      try { if (isMssql(this.$store.state.usedConfig?.client?.type)) return true } catch (_) {}
      return false
    },
    actualPlanOn() {
      const t = this.activeTab
      if (!t || t.tabType !== 'query') return false
      try {
        const coreTabs = this.$root.$refs.CoreTabs
        const compRef = coreTabs && coreTabs.$refs[`tab-${t.id}`]
        const tabComp = compRef && compRef[0]
        if (tabComp) return !!tabComp.collectPlan
      } catch (_) {}
      return !!t.collectPlan
    },
    estimatedPlanOn() {
      const t = this.activeTab
      if (!t || t.tabType !== 'query') return false
      try {
        const coreTabs = this.$root.$refs.CoreTabs
        const compRef = coreTabs && coreTabs.$refs[`tab-${t.id}`]
        const tabComp = compRef && compRef[0]
        if (tabComp) return !!tabComp.collectEstimatedPlan
      } catch (_) {}
      return !!t.collectEstimatedPlan
    }
  },
  watch: {
    database(newValue) {
      const next = (typeof newValue === 'string' ? newValue : '')
      if (this.selectedDatabase !== next) {
        this.selectedDatabase = next
      }
    }
  },
  mounted() {
    document.addEventListener('click', this.closeThemeMenu)
    try {
      // init store and keep local mirror for template binding
      this.analysisStore = useAnalysisStatusStore()
      this._storeTick = setInterval(() => {
        try { this.analysisStore?.tick() } catch {}
        const s = this.analysisStore
        if (s) {
          this.analysisStatus.active = s.active
          this.analysisStatus.message = s.message
          this.analysisStatus.elapsed = s.elapsed
          this.analysisFlowActive = s.analysisFlowActive
        }
      }, 1000)
      this.$root.$on('aiAnalysisNeedSections', this.handleAiAnalysisNeedSections)
      // Listen for final text from AI panel to insert into a new tab
      this.$root.$on('aiAnalysisFinalText', this.handleAiAnalysisFinalText)
      // Listen for analysis errors from plugin
      this.$root.$on('aiAnalysisError', this.handleAiAnalysisError)
      // Listen for analyze plan trigger from query editor button
      this.$root.$on('analyzePlan:trigger', this.handleAnalyzePlanWithAI)
      // Mirror inline AI step progress into analysis log (so Chat shows progress)
      this.$root.$on(AppEvent.aiInlineStep, ({ id, status }) => {
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'info', message: `Inline step ${id}: ${status}` }) } catch (_) {}
        // Only surface Inline AI steps in StatusBar when NOT in analysis flow
        if (!this.analysisFlowActive) {
          try {
            // Clear previous status when starting a new operation (db step pending)
            if (id === 'db' && status === 'pending') {
              this.clearAnalysisStatus()
            }
            
            const labels = { db: 'Get Active Database', tables: 'Get Tables', columns: 'Get Columns', insert: 'Insert SQL' }
            const label = labels[id] || id
            const phase = status === 'pending' ? 'pending' : (status === 'done' ? 'done' : status)
            this.setAnalysisStatus(`{Inline AI: ${label} - ${phase}}`)
            
            // When insert is done, mark as complete (not active) after a short delay
            if (id === 'insert' && status === 'done') {
              setTimeout(() => {
                // Stop the timer and mark as inactive
                try { if (this._analysisTimer) { clearInterval(this._analysisTimer); this._analysisTimer = null } } catch (_) {}
                try { 
                  this.analysisStore?.stop() 
                  // Force immediate sync from store
                  const s = this.analysisStore
                  if (s) {
                    this.analysisStatus.active = s.active
                    this.analysisStatus.message = s.message
                    this.analysisStatus.elapsed = s.elapsed
                  }
                } catch (_) {}
              }, 1000) // 1 second delay to show "done" status
            }
          } catch (_) {}
        }
      })
      // When inline AI pipeline finishes (success or timeout), mark analysis completed
      this.$root.$on(AppEvent.aiInlineDone, () => {
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'info', message: 'Inline AI done' }) } catch (_) {}
        // Don't clear status here - let the 'insert done' step handle it
        try { this.$root.$emit(AppEvent.aiAnalysisCompleted) } catch (_) {}
      })
    } catch (_) {}
  },
  beforeDestroy() {
    document.removeEventListener('click', this.closeThemeMenu)
    try {
      this.$root.$off('aiAnalysisNeedSections', this.handleAiAnalysisNeedSections)
      this.$root.$off('aiAnalysisFinalText', this.handleAiAnalysisFinalText)
      this.$root.$off('aiAnalysisError', this.handleAiAnalysisError)
      this.$root.$off('analyzePlan:trigger', this.handleAnalyzePlanWithAI)
      this.$root.$off(AppEvent.aiInlineStep)
      this.$root.$off(AppEvent.aiInlineDone)
    } catch (_) {}
    try { if (this._storeTick) { clearInterval(this._storeTick); this._storeTick = null } } catch {}
  },
  methods: {
    // Collected sections requested by the AI during analysis
    async handleAiAnalysisNeedSections(req) {
      try {
        const need = (req && req.need) || []
        if (!Array.isArray(need) || need.length === 0) return
        const coreTabs = this.$root.$refs.CoreTabs
        const activeTab = coreTabs && coreTabs.activeTab
        const compRef = coreTabs && activeTab && coreTabs.$refs[`tab-${activeTab.id}`]
        const tabComp = compRef && compRef[0]
        if (!tabComp) return
        this.setAnalysisStatus(`AI requested: ${need.join(', ')}`)
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'info', message: `Collecting: ${need.join(', ')}` }) } catch (_) {}

        let xml = (activeTab && activeTab.planXml) || (tabComp && tabComp.tab && tabComp.tab.planXml) || ''
        if (!xml) {
          try { const plans = tabComp.extractAllPlanXmls(tabComp.results || []); if (plans && plans.length) xml = plans[plans.length - 1] } catch (_) {}
        }
        let queryText = ''
        try { if (typeof tabComp.getCurrentQueryText === 'function') queryText = tabComp.getCurrentQueryText() } catch (_) {}
        let metaJson = ''
        try { if (typeof tabComp.gatherSqlServerAiMetadata === 'function') { const meta = await tabComp.gatherSqlServerAiMetadata(queryText); if (meta && meta.metaJson) metaJson = meta.metaJson } } catch (_) {}

        const sections = []
        const want = (k) => need.includes(k)
        if (want('EXEC_PLAN') && xml) {
          try {
            const maxChars = 15000
            const xmlOut = (xml && xml.length > maxChars)
              ? (xml.slice(0, maxChars) + `\n-- [TRUNCATED ${(xml.length - maxChars)} chars]`)
              : xml
            sections.push('---', 'EXECUTION PLAN (ShowPlanXML):', xmlOut)
          } catch (_) { sections.push('---', 'EXECUTION PLAN (ShowPlanXML):', xml) }
        }
        if (want('CURRENT_QUERY') && queryText) { sections.push('---', 'CURRENT QUERY:', '````sql', queryText, '````') }
        if (want('TABLE_METADATA') && metaJson) { sections.push('---', 'TABLE METADATA (JSON):', metaJson) }
        if (want('DDL_CONTEXT') && metaJson) {
          try {
            const arr = JSON.parse(metaJson)
            const fmtIdent = (s) => `[${String(s).replace(/]/g, ']]')}]`
            const take = (list, n) => Array.isArray(list) ? list.slice(0, n) : []
            const maxTables = 6, maxIdx = 6, maxStats = 6
            const lines = []
            for (const t of take(arr, maxTables)) {
              const schema = fmtIdent(t.schema || 'dbo'); const table = fmtIdent(t.table)
              let cols = []
              try { const colsArr = JSON.parse(t.columns || '[]'); cols = colsArr.map(c => `${fmtIdent(c.name)} ${c.type} ${c.is_nullable ? 'NULL' : 'NOT NULL'}`) } catch (_) {}
              if (cols.length) lines.push(`CREATE TABLE ${schema}.${table} (\n  ${cols.join(',\n  ')}\n);`)
              try {
                const idxArr = JSON.parse(t.indexes || '[]')
                for (const i of take(idxArr, maxIdx)) {
                  const keys = JSON.parse(i.keyColumns || '[]').map(k => fmtIdent(k.name)).join(', ')
                  const incs = JSON.parse(i.includeColumns || '[]').map(k => fmtIdent(k.name)).join(', ')
                  const unique = i.is_unique ? 'UNIQUE ' : ''
                  const type = /CLUSTERED/i.test(i.type_desc || '') ? 'CLUSTERED' : 'NONCLUSTERED'
                  const incClause = incs ? ` INCLUDE (${incs})` : ''
                  const whereClause = i.filter_definition ? ` WHERE ${i.filter_definition}` : ''
                  lines.push(`CREATE ${unique}${type} INDEX ${fmtIdent(i.name)} ON ${schema}.${table} (${keys})${incClause}${whereClause};`)
                }
              } catch (_) {}
              try {
                const stArr = JSON.parse(t.stats || '[]')
                for (const s of take(stArr, maxStats)) {
                  const colsList = JSON.parse(s.columns || '[]').map(k => fmtIdent(k.name)).join(', ')
                  lines.push(`CREATE STATISTICS ${fmtIdent(s.name)} ON ${schema}.${table} (${colsList});`)
                }
              } catch (_) {}
            }
            if (lines.length) sections.push('---', 'DDL CONTEXT (approximate):', '```sql', lines.join('\n'), '```')
          } catch (_) {}
        }
        if (want('ENVIRONMENT')) { try { const env = await tabComp.gatherSqlServerEnvironment(); if (env) sections.push('---', 'ENVIRONMENT:', JSON.stringify(env)) } catch (_) {} }
        if (want('SERVER_CONFIG')) { try { const v = await tabComp.gatherSqlServerServerConfig(); if (v) sections.push('---', 'SERVER CONFIG:', JSON.stringify(v)) } catch (_) {} }
        if (want('DATABASE_OPTIONS')) { try { const v = await tabComp.gatherSqlServerDatabaseOptions(); if (v) sections.push('---', 'DATABASE OPTIONS:', JSON.stringify(v)) } catch (_) {} }
        if (want('SESSION_SET_OPTIONS')) { try { const v = await tabComp.gatherSessionSetOptions(); if (v) sections.push('---', 'SESSION SET OPTIONS:', JSON.stringify(v)) } catch (_) {} }
        if (want('COMPILED_PARAMETERS')) { try { const v = await tabComp.gatherLastCompiledParameters(queryText); if (v && v.params && v.params.length) { sections.push('---', 'COMPILED PARAMETERS:', '```'); for (const p of v.params) sections.push(`${p.name} = ${p.value}`); sections.push('```') } } catch (_) {} }
        if (want('STATS_IO_MESSAGES') || want('IO_SUMMARY')) {
          let msgs = []
          try { msgs = tabComp.extractStatisticsMessages(tabComp.results || []) } catch (_) {}
          if (want('STATS_IO_MESSAGES') && msgs && msgs.length) { sections.push('---', 'STATISTICS IO/TIME MESSAGES:', '```', msgs.join('\n'), '```') }
          if (want('IO_SUMMARY')) { try { const sum = tabComp.summarizeStatisticsIoMessages(msgs); if (sum && sum.length) { sections.push('---', 'IO SUMMARY (Top by logical reads):', '```'); for (const it of sum) sections.push(`${it.table}: ${it.logicalReads} logical reads`); sections.push('```') } } catch (_) {} }
        }
        if (want('STATS_FRESHNESS')) { try { const v = await tabComp.gatherStatisticsFreshness(metaJson); if (v && v.length) { sections.push('---', 'STATISTICS FRESHNESS (STATS_DATE):', '```'); for (const s of v) sections.push(`${s.schema}.${s.table} -> ${s.stat_name}: ${s.last_updated}`); sections.push('```') } } catch (_) {} }
        if (want('STATS_PROPERTIES')) { try { const v = await tabComp.gatherStatsProperties(metaJson); if (v && v.length) sections.push('---', 'STATS PROPERTIES (rows, rows_sampled, modification_counter):', JSON.stringify(v.slice(0,20))) } catch (_) {} }
        if (want('PLAN_INSIGHTS') || want('PLAN_WARNINGS') || want('TOP_OPERATORS')) { try { const v = tabComp.extractPlanInsightsFromXml(xml); if (v) { sections.push('---', 'PLAN INSIGHTS:', JSON.stringify(v)) } } catch (_) {} }
        if (want('MISSING_INDEX_SUGGESTIONS')) { try { const v = tabComp.extractMissingIndexesFromPlan(xml); if (v && v.length) sections.push('---', 'MISSING INDEX SUGGESTIONS (from plan):', JSON.stringify(v.slice(0,8))) } catch (_) {} }
        if (want('RUNTIME_STATS')) { try { const v = await tabComp.gatherRuntimeStatsForQuery(queryText); if (v) sections.push('---', 'RUNTIME STATS (dm_exec_query_stats):', JSON.stringify(v)) } catch (_) {} }
        if (want('QS_RUNTIME_WAITS')) { try { const v = await tabComp.gatherQueryStoreRuntime(queryText); if (v && (v.runtime || (v.waits && v.waits.length))) { sections.push('---', 'QUERY STORE RUNTIME/WAITS:'); if (v.runtime) sections.push(`runtime=${JSON.stringify(v.runtime)}`); if (v.waits && v.waits.length) sections.push(JSON.stringify(v.waits)) } } catch (_) {} }
        if (want('QS_FORCED_PLAN')) { try { const v = await tabComp.gatherQueryStoreForcedPlan(queryText); if (v) sections.push('---', 'QUERY STORE FORCED PLAN:', JSON.stringify(v)) } catch (_) {} }
        if (want('FILE_IO_LATENCY')) { try { const v = await tabComp.gatherFileIoLatency(); if (v && v.length) sections.push('---', 'FILE IO LATENCY (top files):', JSON.stringify(v.slice(0,10))) } catch (_) {} }
        if (want('TEMPDB_SNAPSHOT')) { try { const v = await tabComp.gatherTempdbSnapshot(); if (v) sections.push('---', 'TEMPDB SNAPSHOT:', JSON.stringify(v)) } catch (_) {} }
        if (want('RESOURCE_GOVERNOR')) { try { const v = await tabComp.gatherResourceGovernor(); if (v) sections.push('---', 'RESOURCE GOVERNOR:', JSON.stringify(v)) } catch (_) {} }
        if (want('HARDWARE_INFO')) { try { const v = await tabComp.gatherHardwareInfo(); if (v) sections.push('---', 'HARDWARE INFO:', JSON.stringify(v)) } catch (_) {} }
        if (want('INDEX_FRAGMENTATION')) { try { const v = await tabComp.gatherIndexFragmentation(metaJson); if (v && v.length) sections.push('---', 'INDEX FRAGMENTATION (sampled):', JSON.stringify(v.slice(0,15))) } catch (_) {} }
        
        // View, Synonym, and Function handling
        if (want('VIEW_DEFINITION')) {
          try {
            // Extract all potential object names from the query text
            const objectNames = new Set()
            if (queryText) {
              console.log('[VIEW_DEFINITION] Analyzing query:', queryText)
              // Match patterns like: FROM [schema].[object] or JOIN [schema].[object]
              // This captures both schema-qualified and non-qualified names
              const patterns = [
                /(?:FROM|JOIN)\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/gi,  // FROM/JOIN patterns
                /(?:FROM|JOIN)\s+\[([^\]]+)\]\.\[([^\]]+)\]/gi      // Bracketed patterns
              ]
              
              for (const pattern of patterns) {
                let match
                while ((match = pattern.exec(queryText)) !== null) {
                  const objectName = match[2] || match[1]
                  if (objectName) {
                    objectNames.add(objectName)
                  }
                }
              }
              console.log('[VIEW_DEFINITION] Extracted object names:', Array.from(objectNames))
            }
            
            if (objectNames.size > 0) {
              const nameList = Array.from(objectNames).map(n => `'${n}'`).join(',')
              console.log('[VIEW_DEFINITION] Querying sys.views for:', nameList)
              const sql = `
                SELECT 
                  SCHEMA_NAME(v.schema_id) AS schema_name,
                  v.name AS view_name,
                  m.definition AS view_definition
                FROM sys.views v
                INNER JOIN sys.sql_modules m ON v.object_id = m.object_id
                WHERE v.name IN (${nameList})
              `
              const q = await tabComp.connection.query(sql)
              const r = await q.execute()
              console.log('[VIEW_DEFINITION] Raw result:', r)
              // Result is nested: r[0].rows contains the actual data
              const resultWrapper = Array.isArray(r) ? r[0] : r
              const viewDefs = resultWrapper?.rows || resultWrapper?.recordset || []
              console.log('[VIEW_DEFINITION] Found views:', viewDefs ? viewDefs.length : 0)
              if (viewDefs && viewDefs.length) {
                console.log('[VIEW_DEFINITION] First view row:', viewDefs[0])
                console.log('[VIEW_DEFINITION] First view keys:', Object.keys(viewDefs[0]))
                sections.push('---', 'VIEW DEFINITIONS:', '```sql')
                for (const v of viewDefs) {
                  // SQL Server returns generic column names c0, c1, c2 instead of aliases
                  const schemaName = v.c0 || v.schema_name || v.SCHEMA_NAME || 'unknown'
                  const viewName = v.c1 || v.view_name || v.VIEW_NAME || 'unknown'
                  const viewDef = v.c2 || v.view_definition || v.VIEW_DEFINITION || ''
                  sections.push(`-- View: ${schemaName}.${viewName}`)
                  sections.push(viewDef)
                  sections.push('')
                }
                sections.push('```')
                console.log('[VIEW_DEFINITION] Added view definitions to sections')
              } else {
                console.log('[VIEW_DEFINITION] No views found matching:', nameList)
              }
            } else {
              console.log('[VIEW_DEFINITION] No object names extracted from query')
            }
          } catch (err) {
            console.error('[VIEW_DEFINITION] Error fetching view definitions:', err)
          }
        }
        
        if (want('VIEW_BASE_TABLES')) {
          try {
            const sql = `
              SELECT DISTINCT
                SCHEMA_NAME(o.schema_id) AS base_schema,
                o.name AS base_table,
                o.type_desc AS object_type
              FROM sys.sql_expression_dependencies d
              INNER JOIN sys.objects o ON d.referenced_id = o.object_id
              WHERE d.referencing_id IN (
                SELECT object_id FROM sys.views
              )
              AND o.type IN ('U', 'V')  -- Tables and Views
              ORDER BY base_schema, base_table
            `
            const q = await tabComp.connection.query(sql)
            const r = await q.execute()
            const resultWrapper = Array.isArray(r) ? r[0] : r
            const baseTables = resultWrapper?.rows || resultWrapper?.recordset || []
            if (baseTables && baseTables.length) {
              sections.push('---', 'VIEW BASE TABLES:', JSON.stringify(baseTables))
            }
          } catch (_) {}
        }
        
        if (want('SYNONYM_DEFINITION')) {
          try {
            const sql = `
              SELECT 
                SCHEMA_NAME(schema_id) AS synonym_schema,
                name AS synonym_name,
                base_object_name,
                OBJECT_ID(base_object_name) AS base_object_id,
                CASE 
                  WHEN OBJECT_ID(base_object_name) IS NOT NULL 
                  THEN OBJECTPROPERTY(OBJECT_ID(base_object_name), 'BaseType')
                  ELSE NULL
                END AS base_object_type
              FROM sys.synonyms
            `
            const q = await tabComp.connection.query(sql)
            const r = await q.execute()
            const resultWrapper = Array.isArray(r) ? r[0] : r
            const synonyms = resultWrapper?.rows || resultWrapper?.recordset || []
            if (synonyms && synonyms.length) {
              sections.push('---', 'SYNONYM DEFINITIONS:', JSON.stringify(synonyms))
            }
          } catch (_) {}
        }
        
        if (want('FUNCTION_DEFINITION')) {
          try {
            const sql = `
              SELECT 
                SCHEMA_NAME(o.schema_id) AS schema_name,
                o.name AS function_name,
                o.type_desc AS function_type,
                m.definition AS function_definition,
                CASE 
                  WHEN o.type = 'IF' THEN 'Inline Table-Valued Function'
                  WHEN o.type = 'TF' THEN 'Multi-Statement Table-Valued Function'
                  WHEN o.type = 'FN' THEN 'Scalar Function'
                  ELSE o.type_desc
                END AS function_category
              FROM sys.objects o
              INNER JOIN sys.sql_modules m ON o.object_id = m.object_id
              WHERE o.type IN ('FN', 'IF', 'TF')  -- Scalar, Inline TVF, Multi-statement TVF
            `
            const q = await tabComp.connection.query(sql)
            const r = await q.execute()
            const resultWrapper = Array.isArray(r) ? r[0] : r
            const functions = resultWrapper?.rows || resultWrapper?.recordset || []
            if (functions && functions.length) {
              sections.push('---', 'FUNCTION DEFINITIONS:', '```sql')
              for (const f of functions) {
                sections.push(`-- ${f.function_category}: ${f.schema_name}.${f.function_name}`)
                sections.push(f.function_definition)
                sections.push('')
              }
              sections.push('```')
            }
          } catch (_) {}
        }

        if (!sections.length) return
        this.setAnalysisStatus('Sending requested sections to AI')
        
        // CRITICAL: Append Stage 2 sections to the original Stage 1 prompt
        // The AI needs the full context (execution plan, instructions, etc.) PLUS the view definitions
        const stage2Sections = sections.join('\n')
        const fullPrompt = this._stage1Prompt ? `${this._stage1Prompt}\n\n${stage2Sections}` : stage2Sections
        
        console.log('[VIEW_DEFINITION] Stage 1 prompt length:', this._stage1Prompt?.length || 0)
        console.log('[VIEW_DEFINITION] Stage 2 sections length:', stage2Sections.length)
        console.log('[VIEW_DEFINITION] Full prompt length:', fullPrompt.length)
        
        this.$root.$emit(AppEvent.aiInlinePrompt, { prompt: fullPrompt, runAfterInsert: false, aiMode: 'analysis' })
        this.setAnalysisStatus('Waiting for AI_FINAL markers (next stage)')
      } catch (e) {
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'error', message: `Failed to collect requested sections: ${e && e.message ? e.message : e}` }) } catch (_) {}
      }
    },
    _formatElapsed(ms) {
      const totalSec = Math.floor(ms / 1000)
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
      const ss = String(totalSec % 60).padStart(2, '0')
      return `${mm}:${ss}`
    },
    _startAnalysisTimer() {
      if (!this._analysisStartedAt) this._analysisStartedAt = Date.now()
      if (this._analysisTimer) return
      this._analysisTimer = setInterval(() => {
        try {
          const diff = Date.now() - this._analysisStartedAt
          this.analysisStatus.elapsed = this._formatElapsed(diff)
        } catch (_) {}
      }, 1000)
    },
    setAnalysisStatus(message) {
      if (!this.analysisStatus.active) {
        this.analysisStatus.active = true
        this.analysisStatus.message = message
        this._analysisStartedAt = Date.now()
        this.analysisStatus.elapsed = '00:00'
        try { this._analysisTimer && clearInterval(this._analysisTimer) } catch (_) {}
        this._analysisTimer = setInterval(() => {
          const diff = Date.now() - this._analysisStartedAt
          const m = Math.floor(diff / 60000).toString().padStart(2, '0')
          const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0')
          this.analysisStatus.elapsed = `${m}:${s}`
        }, 1000)
        try { this.analysisStore?.start(message) } catch {}
        try { this.analysisStore?.setAnalysisFlowActive(this.analysisFlowActive) } catch {}
      } else {
        this.analysisStatus.message = message
        try { this.analysisStore?.setMessage(message) } catch {}
      }
      try { this.$root.$emit('aiAnalysisStatus', { message }) } catch (_) {}
      if (!this._aiAnalysisStartedEmitted) { this._aiAnalysisStartedEmitted = true; try { this.$root.$emit(AppEvent.aiAnalysisStarted) } catch (_) {} }
      // Always mirror status lines to AI chat
      try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'info', message }) } catch (_) {}
    },
    clearAnalysisStatus() {
      // Close popup and reset state
      try { if (this._analysisNoty) { this._analysisNoty.close(); this._analysisNoty = null } } catch (_) {}
      try { if (this._analysisTimer) { clearInterval(this._analysisTimer); this._analysisTimer = null } } catch (_) {}
      this.analysisStatus.active = false
      this.analysisStatus.message = ''
      this.analysisStatus.elapsed = '00:00'
      this._aiAnalysisStartedEmitted = false
      this._analysisStartedAt = 0
      this.analysisFlowActive = false
      try { this.analysisStore?.clear() } catch {}
    },
    cancelAnalysis() {
      // Best-effort UI cancel (no running background job here)
      this.clearAnalysisStatus()
      try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: 'Analysis cancelled by user' }) } catch (_) {}
    },
    // File Actions
    handleNewWindow() {
      this.actionHandler.newWindow()
    },
    handleNewTab() {
      this.actionHandler.newQuery()
    },
    handleCloseTab() {
      this.actionHandler.closeTab()
    },
    handleImportSqlFiles() {
      this.actionHandler.importSqlFiles()
    },
    handleQuickSearch() {
      this.actionHandler.quickSearch()
    },
    handleDisconnect() {
      this.actionHandler.disconnect()
    },
    
    // Database Actions
    handleDatabaseChange(event) {
      const newDatabase =
        typeof event === 'string'
          ? event
          : (event && event.target && event.target.value) || this.selectedDatabase

      this.$store.dispatch('changeDatabase', newDatabase).catch((e) => {
        this.$noty.error(e.message)
      })
    },
    handleExecute() {
      // Trigger query execution by emitting the event
      // NOTE: TabQueryEditor listens to AppEvent.runActiveQuery
      this.$root.$emit(AppEvent.runActiveQuery)
    },
    
    // Edit Actions
    handleUndo() {
      this.actionHandler.undo()
    },
    handleRedo() {
      this.actionHandler.redo()
    },
    handleCut() {
      this.actionHandler.cut()
    },
    handleCopy() {
      this.actionHandler.copy()
    },
    handlePaste() {
      this.actionHandler.paste()
    },
    handleSelectAll() {
      this.actionHandler.selectAll()
    },
    
    // View Actions
    handleZoomReset() {
      this.actionHandler.zoomreset()
    },
    handleZoomIn() {
      this.actionHandler.zoomin()
    },
    handleZoomOut() {
      this.actionHandler.zoomout()
    },
    handleFullscreen() {
      this.actionHandler.fullscreen()
    },
    handleTogglePrimarySidebar() {
      this.actionHandler.togglePrimarySidebar()
    },
    handleToggleSecondarySidebar() {
      this.actionHandler.toggleSecondarySidebar()
    },
    handleToggleBottomPanel() {
      // Toggle the local state for icon reactivity
      this.bottomPanelVisible = !this.bottomPanelVisible
      // Emit the event to actually toggle the panel
      this.$root.$emit(AppEvent.toggleBottomPanel)
    },
    handleReload() {
      this.actionHandler.reload()
    },
    
    // Tools Actions
    handleBackupDatabase() {
      this.actionHandler.backupDatabase()
    },
    handleRestoreDatabase() {
      this.actionHandler.restoreDatabase()
    },
    handleExportTables() {
      this.actionHandler.exportTables()
    },
    handleManagePlugins() {
      this.actionHandler.managePlugins()
    },
    handleToggleInlineAI() {
      // Only emit the event; CoreTabs shows the toast to avoid duplicates
      this.$root.$emit(AppEvent.toggleInlineAI)
    },
    handleFixWithAI() {
      // Get the active tab component
      const coreTabs = this.$root.$refs.CoreTabs
      if (!coreTabs || !coreTabs.activeTab) {
        this.$noty.warning('No active tab found')
        return
      }
      
      const activeTab = coreTabs.activeTab
      
      // Check if it's a query tab - use tabType property
      if (activeTab.tabType !== 'query') {
        this.$noty.warning(`Please open a query tab to use Fix with AI`)
        return
      }
      
      // Check if there's an error to fix
      const tabComponent = coreTabs.$refs[`tab-${activeTab.id}`]
      if (!tabComponent || !tabComponent[0]) {
        this.$noty.warning('Could not find query tab component')
        return
      }
      
      // Check for error in tab or component
      const hasError = activeTab.error || (tabComponent[0] && tabComponent[0].error)
      if (!hasError) {
        this.$noty.warning('No query error found. Run a query first to see errors.')
        return
      }
      
      // Call fixErrorWithAI on the tab component
      if (tabComponent[0].fixErrorWithAI) {
        tabComponent[0].fixErrorWithAI()
      } else {
        this.$noty.warning('Fix with AI is not available for this tab')
      }
    },
    
    handleStatistics() {
      // Open an empty statistics tab where users can paste their statistics output
      this.$root.$emit('statistics:open', { data: '' })
    },

    handlePasteExecutionPlan() {
      // Open an execution plan tab where users can paste external execution plan XML
      this.$root.$emit('executionplan:open')
    },
    handleToggleActualPlan() {
      const coreTabs = this.$root.$refs.CoreTabs
      const activeTab = coreTabs && coreTabs.activeTab
      if (!coreTabs || !activeTab || activeTab.tabType !== 'query') {
        this.$noty.warning('Open a query tab to toggle Execution Plan')
        return
      }
      const compRef = coreTabs.$refs[`tab-${activeTab.id}`]
      const tabComp = compRef && compRef[0]
      if (!tabComp) {
        this.$noty.warning('Could not find active query tab')
        return
      }
      if (tabComp.connectionType !== 'sqlserver') {
        this.$noty.warning('Execution Plan toggles are available for SQL Server only')
        return
      }
      tabComp.collectPlan = !tabComp.collectPlan
      this.$noty.info(`Actual Plan: ${tabComp.collectPlan ? 'ON' : 'OFF'}`)
    },
    handleToggleEstimatedPlan() {
      const coreTabs = this.$root.$refs.CoreTabs
      const activeTab = coreTabs && coreTabs.activeTab
      if (!coreTabs || !activeTab || activeTab.tabType !== 'query') {
        this.$noty.warning('Open a query tab to toggle Estimated Plan')
        return
      }
      const compRef = coreTabs.$refs[`tab-${activeTab.id}`]
      const tabComp = compRef && compRef[0]
      if (!tabComp) {
        this.$noty.warning('Could not find active query tab')
        return
      }
      if (tabComp.connectionType !== 'sqlserver') {
        this.$noty.warning('Estimated Plan is available for SQL Server only')
        return
      }
      tabComp.collectEstimatedPlan = !tabComp.collectEstimatedPlan
      this.$noty.info(`Estimated Plan: ${tabComp.collectEstimatedPlan ? 'ON' : 'OFF'}`)
    },
    async handleAnalyzePlanWithAI(refine = false) {
      // Prevent duplicate analysis requests (rate limit protection)
      if (this.analysisFlowActive && !refine) {
        this.$noty.info('Analysis already in progress. Please wait...')
        return
      }
      
      // Reset any previous run's status so the bottom bar always reappears
      try { if (!refine) this.clearAnalysisStatus() } catch (_) {}
      if (!this.analysisStore) {
        try { this.analysisStore = useAnalysisStatusStore() } catch (_) {}
      }
      try { this.$root.$emit(AppEvent.aiAnalysisStarted) } catch (_) {}
      this.analysisFlowActive = true
      try { this.analysisStore?.setAnalysisFlowActive(true) } catch {}
      this.analysisRefineAttempted = refine
      // Auto-open the right-side AI panel (secondary sidebar) and select AI Mode tab
      try {
        this.$root.$emit(AppEvent.toggleSecondarySidebar, true)
        this.$root.$emit(AppEvent.selectSecondarySidebarTab, 'bks-ai-shell')
      } catch (_) {}
      this.setAnalysisStatus(refine ? '{Refining: re-evaluating with stricter requirements}' : '{Preparing: collecting execution plan}')
      const coreTabs = this.$root.$refs.CoreTabs
      const activeTab = coreTabs && coreTabs.activeTab
      if (!coreTabs || !activeTab || activeTab.tabType !== 'query') {
        this.$noty.warning('Open a query tab to analyze an execution plan')
        this.clearAnalysisStatus()
        this.analysisFlowActive = false
        try { this.analysisStore?.setAnalysisFlowActive(false) } catch {}
        return
      }
      const compRef = coreTabs.$refs[`tab-${activeTab.id}`]
      const tabComp = compRef && compRef[0]
      if (!tabComp) {
        this.$noty.warning('Could not find active query tab')
        this.clearAnalysisStatus()
        this.analysisFlowActive = false
        try { this.analysisStore?.setAnalysisFlowActive(false) } catch {}
        return
      }
      
      // Validate SQL Server connection
      if (tabComp.connectionType !== 'sqlserver') {
        this.$noty.warning('Execution Plan Analysis is only available for SQL Server connections')
        this.clearAnalysisStatus()
        this.analysisFlowActive = false
        try { this.analysisStore?.setAnalysisFlowActive(false) } catch {}
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'error', message: 'Not a SQL Server connection' }) } catch (_) {}
        return
      }
      
      // Prefer already-rendered plan
      let xml = (activeTab && activeTab.planXml) || (tabComp && tabComp.tab && tabComp.tab.planXml) || ''
      if (!xml) {
        try {
          this.setAnalysisStatus('{Extracting plan XML from results}')
          const plans = tabComp.extractAllPlanXmls(tabComp.results || [])
          if (plans && plans.length) xml = plans[plans.length - 1]
        } catch (_) {}
      }
      if (xml) { this.setAnalysisStatus('{Execution plan collected}') }
      if (!xml) {
        this.$noty.warning('No execution plan XML found. Run a query with Plan enabled first.')
        this.clearAnalysisStatus()
        this.analysisFlowActive = false
        try { this.analysisStore?.setAnalysisFlowActive(false) } catch {}
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'error', message: 'No execution plan XML found' }) } catch (_) {}
        return
      }
      
      // Validate XML is well-formed ShowPlanXML
      if (!xml.includes('ShowPlanXML') && !xml.includes('<StmtSimple')) {
        this.$noty.warning('Invalid execution plan XML format')
        this.clearAnalysisStatus()
        this.analysisFlowActive = false
        try { this.analysisStore?.setAnalysisFlowActive(false) } catch {}
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'error', message: 'Invalid ShowPlanXML format' }) } catch (_) {}
        return
      }
      
      // Warn if XML is very small (likely incomplete)
      if (xml.length < 500) {
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: `Execution plan XML is very small (${xml.length} chars) - may be incomplete` }) } catch (_) {}
      }
      
      // Aggressively compress large XML to stay within token limits
      // For very large plans, extract only the critical elements
      const originalXmlLength = xml.length
      if (xml.length > 50000) {
        try {
          this.setAnalysisStatus('{Compressing large execution plan XML}')
          // Extract only critical sections: operators, warnings, missing indexes, statistics
          const criticalSections = []
          
          // Keep RelOp elements (operators) but strip verbose attributes
          const relOpMatches = xml.match(/<RelOp[^>]*>[\s\S]*?<\/RelOp>/g) || []
          const compressedOps = relOpMatches.slice(0, 20).map(op => {
            // Keep only essential attributes
            return op.replace(/\s+(LogicalOp|PhysicalOp|EstimateRows|EstimateIO|EstimateCPU|ActualRows|NodeId)="[^"]*"/g, '$&')
                    .replace(/\s+[A-Za-z]+="[^"]*"/g, '') // Remove other attributes
                    .substring(0, 500) // Limit each operator to 500 chars
          })
          
          // Extract warnings
          const warnings = (xml.match(/<Warnings>[\s\S]*?<\/Warnings>/g) || []).join('\n')
          
          // Extract missing indexes
          const missingIndexes = (xml.match(/<MissingIndexes>[\s\S]*?<\/MissingIndexes>/g) || []).join('\n')
          
          // Build compressed XML
          xml = [
            '<?xml version="1.0" encoding="utf-16"?>',
            '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">',
            '<BatchSequence>',
            '<Batch>',
            '<Statements>',
            '<StmtSimple>',
            '<!-- COMPRESSED: Original XML was ' + originalXmlLength + ' chars, showing top 20 operators only -->',
            compressedOps.join('\n'),
            warnings,
            missingIndexes,
            '</StmtSimple>',
            '</Statements>',
            '</Batch>',
            '</BatchSequence>',
            '</ShowPlanXML>'
          ].join('\n')
          
          try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'info', message: `Compressed execution plan XML from ${originalXmlLength} to ${xml.length} chars (${Math.round(xml.length/originalXmlLength*100)}%)` }) } catch (_) {}
        } catch (e) {
          try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: 'Failed to compress XML, using truncation instead' }) } catch (_) {}
        }
      }
      
      // Final truncation if still too large (fallback)
      if (xml.length > 30000) {
        const truncated = xml.length
        xml = xml.slice(0, 30000) + `\n<!-- TRUNCATED: Original ${truncated} chars, showing first 30000 only -->`
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: `Execution plan XML truncated from ${truncated} to 30000 chars` }) } catch (_) {}
      }
      // STAGE 1: Collect minimal essential data for initial triage
      // This dramatically reduces token count (typically 5-10K tokens vs 30-40K for full collection)
      // AI can request Stage 2 data via AI_REQUEST if issues are detected
      this.setAnalysisStatus('{Stage 1: Collecting essential data for triage}')
      
      let queryText = ''
      try { if (typeof tabComp.getCurrentQueryText === 'function') queryText = tabComp.getCurrentQueryText() } catch (_) {}
      if (queryText) { this.setAnalysisStatus('{Collected current query}') }
      
      // Basic environment (lightweight)
      let env = null
      try { if (typeof tabComp.gatherSqlServerEnvironment === 'function') env = await tabComp.gatherSqlServerEnvironment() } catch (_) {}
      if (env) { this.setAnalysisStatus('{Collected environment}') }
      
      // STATISTICS IO/TIME (if available - critical for detecting high reads)
      let statsMsgs = []
      try { if (typeof tabComp.extractStatisticsMessages === 'function') statsMsgs = tabComp.extractStatisticsMessages(tabComp.results || []) } catch (_) {}
      if (statsMsgs && statsMsgs.length) { 
        this.setAnalysisStatus('{Collected statistics (IO/TIME) messages}') 
      } else { 
        this.setAnalysisStatus('{No STATISTICS IO/TIME - proceeding with plan only}') 
      }
      
      // IO Summary (quick indicator of problem tables)
      let ioSummary = []
      try { if (typeof tabComp.summarizeStatisticsIoMessages === 'function') ioSummary = tabComp.summarizeStatisticsIoMessages(statsMsgs) } catch (_) {}
      if (ioSummary && ioSummary.length) { this.setAnalysisStatus('{Summarized IO statistics}') }
      
      // Plan insights (warnings, missing indexes from XML)
      let planInsights = null
      try { if (typeof tabComp.extractPlanInsightsFromXml === 'function') planInsights = tabComp.extractPlanInsightsFromXml(xml) } catch (_) {}
      if (planInsights && Object.keys(planInsights).length) { this.setAnalysisStatus('{Extracted plan insights}') }
      
      // Missing indexes from plan (lightweight, already in XML)
      let missIdx = []
      try { if (typeof tabComp.extractMissingIndexesFromPlan === 'function') missIdx = tabComp.extractMissingIndexesFromPlan(xml) } catch (_) {}
      if (missIdx && missIdx.length) { this.setAnalysisStatus('{Found missing index suggestions in plan}') }
      
      // Note: View/function detection moved to Stage 2 (handleAiAnalysisNeedSections)
      // The AI will request VIEW_DEFINITION via AI_REQUEST_BEGIN/END if needed
      // This avoids the tabComp.executeQuery method issue in Stage 1
      let viewDefinitions = []
      let functionDefinitions = []
      
      // STAGE 2 data - only collected if AI requests it via AI_REQUEST
      // These are expensive and only needed for deep analysis
      let metaJson = ''
      let compiledParams = null
      let serverCfg = null
      let dbOpts = null
      let sessionSet = null
      let statsFreshness = []
      let runtimeStats = null
      let qsRuntime = null
      let fileIoLatency = []
      let tempdbSnap = null
      let resourceGov = null
      let hwInfo = null
      let indexFrag = []
      let qsForced = null
      let statsProps = []
      
      // Note: Stage 2 collection will be triggered by handleAiAnalysisNeedSections
      // when AI sends AI_REQUEST_BEGIN/END with specific data needs

      // Build compact DDL scripts from metadata (approximate)
      let ddlScripts = ''
      try {
        if (metaJson) {
          const arr = JSON.parse(metaJson)
          const fmtIdent = (s) => `[${String(s).replace(/]/g, ']]')}]`
          const colType = (c) => {
            const t = String(c.type || '').toLowerCase()
            if (/(char|binary)/.test(t)) {
              return `${c.type}(${c.max_length})`
            }
            if (/(decimal|numeric)/.test(t)) {
              return `${c.type}(${c.precision},${c.scale})`
            }
            if (/(datetime|date|time|bit|int|bigint|smallint|tinyint|money|smallmoney|float|real|uniqueidentifier|xml|text|ntext|image)/.test(t)) {
              return `${c.type}`
            }
            return `${c.type}`
          }
          const take = (list, n) => Array.isArray(list) ? list.slice(0, n) : []
          const maxTables = 6, maxIdx = 6, maxStats = 6
          const lines = []
          for (const t of take(arr, maxTables)) {
            const schema = fmtIdent(t.schema || 'dbo')
            const table = fmtIdent(t.table)
            let cols = []
            try {
              const colsArr = JSON.parse(t.columns || '[]')
              cols = colsArr.map(c => `${fmtIdent(c.name)} ${colType(c)} ${c.is_identity ? 'IDENTITY(1,1) ' : ''}${c.is_nullable ? 'NULL' : 'NOT NULL'}`)
            } catch (_) {}
            if (cols.length) {
              lines.push(`CREATE TABLE ${schema}.${table} (\n  ${cols.join(',\n  ')}\n);`)
            }
            // Indexes
            try {
              const idxArr = JSON.parse(t.indexes || '[]')
              for (const i of take(idxArr, maxIdx)) {
                const keys = JSON.parse(i.keyColumns || '[]').map(k => fmtIdent(k.name)).join(', ')
                const incs = JSON.parse(i.includeColumns || '[]').map(k => fmtIdent(k.name)).join(', ')
                const unique = i.is_unique ? 'UNIQUE ' : ''
                const type = /CLUSTERED/i.test(i.type_desc || '') ? 'CLUSTERED' : 'NONCLUSTERED'
                const incClause = incs ? ` INCLUDE (${incs})` : ''
                const whereClause = i.filter_definition ? ` WHERE ${i.filter_definition}` : ''
                lines.push(`CREATE ${unique}${type} INDEX ${fmtIdent(i.name)} ON ${schema}.${table} (${keys})${incClause}${whereClause};`)
              }
            } catch (_) {}
            // Statistics
            try {
              const stArr = JSON.parse(t.stats || '[]')
              for (const s of take(stArr, maxStats)) {
                const colsList = JSON.parse(s.columns || '[]').map(k => fmtIdent(k.name)).join(', ')
                lines.push(`CREATE STATISTICS ${fmtIdent(s.name)} ON ${schema}.${table} (${colsList});`)
              }
            } catch (_) {}
          }
          ddlScripts = lines.join('\n')
        }
      } catch (_) {}

      const sections = [
        'You are an expert SQL Server performance engineer and DBA. Analyze holistically and propose concrete improvements.',
        '',
        '⚡ STAGED ANALYSIS PROTOCOL:',
        '- STAGE 1 (Current): You have been provided with ESSENTIAL data only (execution plan XML, STATISTICS IO/TIME if available, plan insights, missing index suggestions from plan).',
        '- 🚨 CRITICAL: If the CURRENT QUERY contains a VIEW or FUNCTION (e.g., SELECT * FROM HumanResources.vEmployee), you MUST IMMEDIATELY request VIEW_DEFINITION or FUNCTION_DEFINITION in Stage 2. DO NOT proceed with generic recommendations without the view/function definition.',
        '- Your task: Perform TRIAGE analysis to detect ANY of these performance issues:',
        '  * High logical/physical reads (check STATISTICS IO if available)',
        '  * Table scans or index scans on large tables (check EstimateRows > 10000)',
        '  * Key lookups or RID lookups (check plan operators)',
        '  * Missing indexes (check plan XML MissingIndexes)',
        '  * Implicit conversions (check CONVERT_IMPLICIT in plan)',
        '  * Stale statistics (check LastStatisticsUpdate if available)',
        '  * Parameter sniffing (check EstimateRows vs ActualRows mismatch)',
        '  * Excessive sorts, spills to tempdb, or memory grants',
        '  * Non-sargable predicates (functions on columns in WHERE clause)',
        '  * 🚨 VIEWS or FUNCTIONS in query (check CURRENT QUERY for FROM/JOIN clauses with views/functions)',
        '- STAGE 2 (Conditional): If you detect ANY issues above, request specific data sections using AI_REQUEST_BEGIN/END:',
        '  Format: AI_REQUEST_BEGIN\n  {"need":["SECTION1","SECTION2"], "why":"Brief reason", "tables":["schema.table1","schema.table2"]}\n  AI_REQUEST_END',
        '  * Missing indexes → TABLE_METADATA, DDL_CONTEXT (to check existing indexes)',
        '  * High reads/scans → TABLE_METADATA, STATISTICS_FRESHNESS (to check row counts, index usage)',
        '  * Stale statistics → STATISTICS_FRESHNESS, STATS_PROPERTIES',
        '  * 🚨 Views in query → VIEW_DEFINITION, VIEW_BASE_TABLES (MANDATORY - you cannot analyze views without their definition)',
        '  * Synonyms in query → SYNONYM_DEFINITION (to resolve to actual object)',
        '  * 🚨 Functions in query → FUNCTION_DEFINITION (MANDATORY - you cannot analyze functions without their definition)',
        '- If NO significant issues found (query is optimal, good indexes, low reads, no warnings): Return AI_FINAL_BEGIN...AI_FINAL_END with a brief "Query is optimal" response.',
        '- If ANY ISSUES DETECTED: Request additional detailed data via AI_REQUEST_BEGIN/END to provide specific recommendations.',
        '',
        '⚡ REQUESTING ADDITIONAL DATA (Stage 2):',
        '- If you need more context to provide specific recommendations, return ONLY a machine-readable request:',
        '  AI_REQUEST_BEGIN',
        '  {"need":["TABLE_METADATA","STATISTICS_FRESHNESS"], "why":"Key lookups detected on Orders table - need index details to recommend INCLUDE columns"}',
        '  AI_REQUEST_END',
        '- Examples of what to request based on detected issues:',
        '  * High logical reads → TABLE_METADATA, INDEX_FRAGMENTATION, STATISTICS_FRESHNESS',
        '  * Key/RID lookups → TABLE_METADATA, DDL_CONTEXT (to see existing indexes)',
        '  * Cardinality mismatches → STATISTICS_FRESHNESS, STATS_PROPERTIES, COMPILED_PARAMETERS',
        '  * Spills to tempdb → TEMPDB_SNAPSHOT, SERVER_CONFIG (MAXDOP, memory settings)',
        '  * Parameter sniffing → COMPILED_PARAMETERS, QUERY_STORE_RUNTIME',
        '  * Implicit conversions → TABLE_METADATA (to check column data types)',
        '  * Parallelism issues → SERVER_CONFIG, HARDWARE_INFO, RESOURCE_GOVERNOR',
        '  * Stale statistics → STATISTICS_FRESHNESS, STATS_PROPERTIES',
        '  * Views in query → VIEW_DEFINITION, VIEW_BASE_TABLES (to analyze underlying tables)',
        '  * Synonyms in query → SYNONYM_DEFINITION (to resolve to actual object)',
        '  * Functions in query → FUNCTION_DEFINITION (to check inline vs multi-statement TVF)',
        '- Available sections: TABLE_METADATA, DDL_CONTEXT, SERVER_CONFIG, DATABASE_OPTIONS, SESSION_OPTIONS, COMPILED_PARAMETERS, STATISTICS_FRESHNESS, STATS_PROPERTIES, INDEX_FRAGMENTATION, QUERY_STORE_RUNTIME, RUNTIME_STATS, FILE_IO_LATENCY, TEMPDB_SNAPSHOT, RESOURCE_GOVERNOR, HARDWARE_INFO, QUERY_STORE_FORCED_PLAN, VIEW_DEFINITION, VIEW_BASE_TABLES, SYNONYM_DEFINITION, FUNCTION_DEFINITION',
        '- Keep other text minimal until you have all needed data.',
        '',
        '⚡ FINAL RESPONSE (when ready):',
        '- Do NOT include any data-gathering SQL (e.g., queries against sys.* DMVs/catalog) in the final output.',
        '- Start with an "Original Query" section that reproduces CURRENT QUERY verbatim in a fenced ```sql block.',
        '- IMPORTANT: Wrap your final response ONLY between AI_FINAL_BEGIN and AI_FINAL_END markers.',
        '- Determinism: Be concise and follow the exact template below. Do not speculate.',
        '- Hints and Trace Flags: Use only as a last resort after indexes, predicates, and rewrites. Prefer documented per-query hints (OPTION...) or USE HINT() over server-level changes.',
        '- REWRITE REQUIREMENT: If you suggest rewriting a view, function, or query, you MUST provide the complete rewritten SQL code in a fenced block.',
        '',
        '🚨 CRITICAL VIEW/FUNCTION HANDLING:',
        '- If the query uses a VIEW (e.g., SELECT * FROM HumanResources.vEmployee), you MUST request VIEW_DEFINITION in Stage 2.',
        '- NEVER say "Unable to optimize without knowing the view definition" - you have the VIEW_DEFINITION tool available.',
        '- After receiving the view definition, provide the ACTUAL optimized query by expanding the view or rewriting it.',
        '- For SELECT * from a view: Replace * with specific columns from the view definition.',
        '- For inefficient views: Rewrite by inlining the view logic or optimizing the underlying joins.',
        '- ALWAYS provide executable SQL code, not comments like "-- Replace with specific column names".',
        '',
        '🚨 CRITICAL SCHEMA ACCURACY:',
        '- Extract the EXACT schema names from the query text (e.g., [Person].[EmailAddress], [HumanResources].[Employee]).',
        '- When recommending indexes, you MUST use the EXACT schema.table names as they appear in the query.',
        '- NEVER guess or assume schema names - always use what is explicitly in the query.',
        '- Example: If query has [Person].[EmailAddress], index MUST be on [Person].[EmailAddress], NOT [HumanResources].[EmailAddress].',
        '- REQUIRED FINAL STRUCTURE:',
        '  1. Executive Summary: Brief overview of performance issues.',
        '  2. Plan Analysis: Detailed breakdown of bottlenecks.',
        '  3. Recommendations: Index changes (CREATE INDEX...).',
        '  4. Rewritten SQL: (IF APPLICABLE) The complete, ready-to-run SQL code for any view/function/query rewrites.',
        '',
        '🚨 CRITICAL SAFETY RULE - DDL EXECUTION:',
        '- NEVER offer to execute DDL statements (CREATE INDEX, ALTER TABLE, DROP, etc.) after using insert_sql.',
        '- DDL operations require careful DBA review and should NEVER be auto-executed.',
        '- After inserting DDL code with insert_sql, you MUST NOT ask "Do you want me to run this?" or offer to execute it.',
        '- The user will manually review and execute DDL statements when ready.',
        '- This rule applies to ALL DDL: CREATE INDEX, CREATE TABLE, ALTER, DROP, TRUNCATE, etc.',
        '',
        'CRITICAL METRICS TO ANALYZE:',
        '- Key Lookups (Clustered Index Seek after NonClustered Index Seek) - indicates missing INCLUDE columns',
        '- RID Lookups (Heap lookups) - indicates need for clustered index or covering nonclustered index',
        '- Implicit Conversions (CONVERT_IMPLICIT in plan XML) - data type mismatches causing index scans instead of seeks',
        '- Table Scans vs Index Scans vs Index Seeks - scan operations are expensive on large tables',
        '- Estimated vs Actual Rows - large discrepancies indicate stale statistics or parameter sniffing',
        '- Number of Executions - operators executing many times (nested loops) can be costly',
        '- Actual Rewinds - high rewind counts indicate inefficient nested loop joins',
        '- Warnings in plan XML - missing statistics, missing indexes, excessive memory grants, spills to tempdb, unmatched indexes',
        '- Sort/Hash operators with warnings - memory grant issues or spills',
        '- Parallelism degree and CXPACKET waits - excessive parallelism can hurt performance',
        '- Thick arrows in plan - high row counts between operators indicate data movement bottlenecks',
        '- Nested Loops with large outer input - consider Hash Join or Merge Join instead',
        '- Hash Match with spills - insufficient memory grant, consider index to avoid hash',
        '- Sort operators - expensive, can often be eliminated with proper indexes',
        '- Compute Scalar with expensive functions - UDFs, scalar functions in SELECT/WHERE causing row-by-row execution',
        '- Index Spool / Table Spool - indicates optimizer creating temp structures, may need better indexes',
        '- Remote Query operators - linked server calls, consider local temp tables or replication',
        '- Clustered Index Scan on large tables - missing nonclustered index for predicates',
        '- Filter operators with low selectivity - predicates applied after expensive operations',
        '- Bitmap operators - large bitmap creation can indicate cardinality issues',
        '- Adaptive joins (SQL 2017+) - check if adaptive threshold is appropriate',
        '- Batch mode vs Row mode - columnstore or batch mode on rowstore (SQL 2019+)',
        '- Memory grant feedback (SQL 2017+) - excessive or insufficient grants',
        '- Parameter Sensitive Plan (PSP) optimization (SQL 2022+) - multiple plans for different parameter ranges',
        '- Cardinality Estimator version (70 vs 120/130/140/150/160) - legacy CE can cause poor estimates',
        '- Statistics used - check last update time, sample rate, and modification counter',
        '- Seek predicates vs residual predicates - residual predicates after seek indicate non-sargable conditions',
        '- Scalar UDFs inline (SQL 2019+) - check if scalar UDFs are being inlined or causing RBAR',
        '- Table-valued function calls - multi-statement TVFs cause poor cardinality estimates',
        '- Computed columns - check if they are persisted and indexed',
        '- Filtered statistics - may need filtered indexes to match filtered stats',
        '',
        'Index policy:',
        '- CRITICAL: EXISTENCE CHECK - Before recommending ANY index, you MUST check if an index with the same columns or same name already exists in TABLE METADATA/DDL CONTEXT.',
        '- If an index with the proposed name already exists, you MUST use a different name (e.g., append _Covering or _v2) or use DROP_EXISTING=ON if applicable.',
        '- If an index with the exact same Key and Include columns already exists, do NOT recommend creating it (it is a duplicate).',
        '- Prefer updating/merging existing indexes when feasible; avoid duplicates/near-duplicates.',
        '- CRITICAL: NEVER use DROP_EXISTING=ON on constraint-based indexes (PK_*, UQ_*, AK_*). These are constraints, not regular indexes, and cannot be altered with DROP_EXISTING.',
        '- Before proposing a new index, compare with existing indexes from TABLE METADATA/DDL CONTEXT.',
        '- If an existing NON-CONSTRAINT index (IX_* prefix) shares the same leading key, you can update it using WITH (DROP_EXISTING=ON) to add missing keys and/or INCLUDE columns.',
        '- If an existing CONSTRAINT index (PK_*, UQ_*, AK_*) needs additional coverage, create a NEW non-clustered covering index with INCLUDE columns instead.',
        '- Preserve existing filters on filtered indexes unless there is a strong reason to adjust; include WHERE when recommending filtered indexes.',
        '- Do not alter PRIMARY KEY/UNIQUE constraint definitions - they cannot be modified with DROP_EXISTING.',
        '- ONLINE=ON requires SQL Server 2012+ Enterprise/Developer Edition. For Standard Edition, omit ONLINE option.',
        '- Example (updating regular index): If [Sales].[Customer] has [IX_Customer_TerritoryID] ON ([TerritoryID]) and you recommend adding columns, propose CREATE INDEX [IX_Customer_TerritoryID] ON [Sales].[Customer] ([TerritoryID],[CustomerID]) INCLUDE ([PersonID]) WITH (DROP_EXISTING=ON, ONLINE=ON, SORT_IN_TEMPDB=ON, DATA_COMPRESSION=PAGE).',
        '- Example (covering constraint): If [Person].[Person] has [PK_Person_BusinessEntityID] and needs coverage, propose CREATE NONCLUSTERED INDEX [IX_Person_BusinessEntityID_Names] ON [Person].[Person] ([BusinessEntityID]) INCLUDE ([Title],[FirstName],[LastName]) WITH (ONLINE=ON, DATA_COMPRESSION=PAGE).',
        '- Propose at most 5 total index changes overall; allow up to 10 only if a single table is very large and justifies it.',
        '',
        '⚠️ CRITICAL: NO PLACEHOLDERS OR COMMENTS IN INDEX DEFINITIONS:',
        '- NEVER use placeholder comments like "/* Add columns here */" or "/* other columns */"',
        '- ALWAYS specify EXACT column names in INCLUDE clause',
        '- If you don\'t know which columns to include, either:',
        '  1. Request TABLE_METADATA to see available columns',
        '  2. Analyze the query to see which columns are selected/filtered',
        '  3. Leave out INCLUDE clause entirely (only use key columns)',
        '- Example of INVALID index (placeholder):',
        '  * CREATE INDEX IX_Orders ON Orders (CustomerID) INCLUDE ( /* Add columns */ ) ❌',
        '- Example of VALID index (specific columns):',
        '  * CREATE INDEX IX_Orders ON Orders (CustomerID) INCLUDE (OrderDate, TotalAmount) ✅',
        '- Example of VALID index (no INCLUDE if unsure):',
        '  * CREATE INDEX IX_Orders ON Orders (CustomerID, OrderDate) ✅',
        '- INCLUDE clause guidelines:',
        '  * Only include columns that are in the SELECT list but not in WHERE/JOIN',
        '  * Check the query to see which columns are accessed',
        '  * Common candidates: columns in SELECT, columns in ORDER BY (if not in key)',
        '  * Do NOT include columns already in the key columns',
        '  * Do NOT include columns not used by the query',
        '- If the query is "SELECT *", you must either:',
        '  1. Request TABLE_METADATA to see all columns and include the most commonly accessed ones',
        '  2. Recommend rewriting the query to select specific columns instead of SELECT *',
        '  3. Create index with key columns only (no INCLUDE)',
        '',
        '⚠️ CRITICAL: COLUMN VALIDATION BEFORE INDEX CREATION:',
        '- ALWAYS verify that ALL columns in your proposed index actually exist in the table',
        '- Check TABLE_METADATA for the exact list of columns in each table',
        '- Common mistakes that cause errors:',
        '  * Recommending columns that don\'t exist in the table',
        '  * Misspelling column names (e.g., "CustomerID" vs "CustomerId")',
        '  * Using columns from joined tables instead of the base table',
        '  * Confusing column names between similar tables',
        '- Column validation checklist:',
        '  1. Extract the table name from your proposed index (e.g., CREATE INDEX ... ON TableName)',
        '  2. Find that table in TABLE_METADATA',
        '  3. Get the list of columns for that table from TABLE_METADATA',
        '  4. Verify EACH column in your index (key columns AND INCLUDE columns) exists in that table',
        '  5. Check column name spelling matches exactly (case-sensitive in some collations)',
        '  6. If a column doesn\'t exist, DO NOT recommend that index',
        '- Example of INVALID index (column doesn\'t exist):',
        '  * Table: Orders (columns: OrderID, CustomerID, OrderDate, TotalAmount)',
        '  * Proposed: CREATE INDEX IX_Orders ON Orders (ProductID) ❌',
        '  * Error: ProductID column does not exist in Orders table',
        '  * Fix: Check TABLE_METADATA - ProductID is in OrderDetails table, not Orders',
        '- Example of VALID index (all columns exist):',
        '  * Table: Orders (columns: OrderID, CustomerID, OrderDate, TotalAmount)',
        '  * Proposed: CREATE INDEX IX_Orders ON Orders (CustomerID, OrderDate) INCLUDE (TotalAmount) ✅',
        '  * Valid: All columns (CustomerID, OrderDate, TotalAmount) exist in Orders table',
        '- If you need to index a column from a joined table:',
        '  * Create separate indexes on each table',
        '  * Example: Orders JOIN OrderDetails → Create IX_Orders on Orders table, IX_OrderDetails on OrderDetails table',
        '- NEVER recommend an index with columns that don\'t exist in the target table',
        '- If you\'re unsure about column names, request TABLE_METADATA to verify',
        '',
        '⚠️ CRITICAL: DUPLICATE INDEX DETECTION:',
        '- ALWAYS check TABLE_METADATA and DDL_CONTEXT for existing indexes before proposing a new index',
        '- An index is a DUPLICATE if it has the EXACT SAME:',
        '  1. Key columns (in the same order)',
        '  2. INCLUDE columns (order doesn\'t matter for INCLUDE)',
        '  3. WHERE clause (for filtered indexes)',
        '- Example of DUPLICATE (DO NOT RECOMMEND):',
        '  * Existing: CREATE INDEX IX_Orders_CustomerID ON Orders (CustomerID, OrderDate) INCLUDE (TotalAmount)',
        '  * Proposed: CREATE INDEX IX_Orders_New ON Orders (CustomerID, OrderDate) INCLUDE (TotalAmount)',
        '  * Result: ❌ EXACT DUPLICATE - Do not recommend, note "Index already exists with same structure"',
        '- Example of SIMILAR but NOT duplicate (CAN UPDATE):',
        '  * Existing: CREATE INDEX IX_Orders_CustomerID ON Orders (CustomerID)',
        '  * Proposed: CREATE INDEX IX_Orders_CustomerID ON Orders (CustomerID, OrderDate) INCLUDE (TotalAmount)',
        '  * Result: ✅ UPDATE existing index with DROP_EXISTING=ON to add OrderDate key and TotalAmount INCLUDE',
        '- Example of DIFFERENT key order (NOT duplicate):',
        '  * Existing: CREATE INDEX IX_Orders_A ON Orders (CustomerID, OrderDate)',
        '  * Proposed: CREATE INDEX IX_Orders_B ON Orders (OrderDate, CustomerID)',
        '  * Result: ✅ DIFFERENT - Key column order matters, these are different indexes',
        '- Duplicate detection checklist:',
        '  1. Extract key columns from existing index (from TABLE_METADATA or DDL_CONTEXT)',
        '  2. Extract INCLUDE columns from existing index',
        '  3. Extract WHERE clause from existing index (if filtered)',
        '  4. Compare with your proposed index:',
        '     - Same key columns in same order? → Check INCLUDE',
        '     - Same INCLUDE columns (any order)? → Check WHERE',
        '     - Same WHERE clause? → DUPLICATE! Do not recommend',
        '  5. If duplicate found, explain: "Recommended index already exists as [IndexName] with identical structure. No action needed."',
        '  6. If similar (subset of keys/includes), recommend UPDATE with DROP_EXISTING=ON',
        '  7. If different, recommend as new index',
        '- NEVER recommend an index that already exists with the exact same key columns, INCLUDE columns, and WHERE clause',
        '- If all your proposed indexes are duplicates, state: "All recommended indexes already exist. Query performance issues are not due to missing indexes."',
        '',
        '⚠️ CRITICAL: DATA TYPE RESTRICTIONS FOR INDEX KEY COLUMNS:',
        '- NEVER use these data types as KEY columns in an index (they can only be INCLUDE columns):',
        '  * nvarchar(max), varchar(max), varbinary(max) - MAX types cannot be key columns',
        '  * text, ntext, image - Legacy LOB types (deprecated, cannot be key columns)',
        '  * xml - Cannot be key column',
        '  * sql_variant - Cannot be key column',
        '  * geography, geometry - Spatial types (cannot be key columns)',
        '  * hierarchyid - Cannot be key column in most cases',
        '- These types CAN be used in INCLUDE clause:',
        '  * All MAX types: nvarchar(max), varchar(max), varbinary(max)',
        '  * xml, sql_variant, geography, geometry, hierarchyid',
        '- ALWAYS check column data types from TABLE_METADATA before proposing index key columns',
        '- If a column is nvarchar(max)/varchar(max)/varbinary(max):',
        '  * DO NOT put it in the key columns: CREATE INDEX ... ON Table (BadColumn) ❌',
        '  * DO put it in INCLUDE: CREATE INDEX ... ON Table (OtherColumn) INCLUDE (MaxColumn) ✅',
        '  * Consider if a computed column with LEFT(MaxColumn, 450) could be indexed instead',
        '- Example of INVALID index (will cause error):',
        '  * CREATE INDEX IX_Bad ON Customers (morada) WHERE morada is nvarchar(max) ❌',
        '- Example of VALID index:',
        '  * CREATE INDEX IX_Good ON Customers (CustomerID) INCLUDE (morada) ✅',
        '  * CREATE INDEX IX_Computed ON Customers (morada_prefix) WHERE morada_prefix is computed as LEFT(morada, 450) PERSISTED ✅',
        '- Key column size limits:',
        '  * Clustered index: Max 900 bytes total for all key columns',
        '  * Non-clustered index: Max 1700 bytes total (SQL 2016+), 900 bytes (older versions)',
        '  * Individual column: nvarchar(450), varchar(900), etc.',
        '- INCLUDE columns have no size limit (can include MAX types)',
        '',
        '⚠️ CRITICAL: SQL SERVER VERSION COMPATIBILITY FOR INDEX OPTIONS:',
        '- ALWAYS check SQL Server version from SERVER_CONFIG or ENVIRONMENT data before using advanced index options',
        '- Version-specific features:',
        '  * ONLINE=ON: Requires Enterprise/Developer Edition (Standard Edition supports ONLINE=ON for non-clustered indexes in SQL 2014+)',
        '  * DATA_COMPRESSION=PAGE/ROW: Requires Enterprise/Developer Edition (SQL 2008+), Standard Edition (SQL 2016 SP1+)',
        '  * SORT_IN_TEMPDB=ON: Available in all editions (SQL 2005+)',
        '  * DROP_EXISTING=ON: Available in all editions (SQL 2005+)',
        '  * RESUMABLE=ON: Requires Enterprise/Developer Edition (SQL 2017+), Standard Edition (SQL 2019+)',
        '  * MAXDOP=n: Available in all editions (SQL 2008+)',
        '  * OPTIMIZE_FOR_SEQUENTIAL_KEY=ON: Requires SQL 2019+',
        '  * Filtered indexes (WHERE clause): Requires SQL 2008+',
        '  * INCLUDE columns: Requires SQL 2005+',
        '- Version detection examples:',
        '  * SQL Server 2008-2012: Use basic options only (DROP_EXISTING, SORT_IN_TEMPDB)',
        '  * SQL Server 2014-2016: Add ONLINE=ON for non-clustered indexes',
        '  * SQL Server 2016 SP1+: Add DATA_COMPRESSION if Standard Edition',
        '  * SQL Server 2017+: Add RESUMABLE=ON if Enterprise Edition',
        '  * SQL Server 2019+: Add OPTIMIZE_FOR_SEQUENTIAL_KEY if needed',
        '- Edition detection:',
        '  * Enterprise/Developer: All features available',
        '  * Standard: Limited ONLINE, DATA_COMPRESSION from 2016 SP1+',
        '  * Express/Web: Very limited features',
        '- Safe default for unknown version: WITH (DROP_EXISTING=ON, SORT_IN_TEMPDB=ON) -- Works on all versions/editions',
        '- If version is SQL 2014+ Standard: WITH (DROP_EXISTING=ON, ONLINE=ON, SORT_IN_TEMPDB=ON)',
        '- If version is SQL 2016 SP1+ Standard: WITH (DROP_EXISTING=ON, ONLINE=ON, SORT_IN_TEMPDB=ON, DATA_COMPRESSION=PAGE)',
        '- If version is SQL 2017+ Enterprise: WITH (DROP_EXISTING=ON, ONLINE=ON, SORT_IN_TEMPDB=ON, DATA_COMPRESSION=PAGE, RESUMABLE=ON)',
        '',
        '⚠️ CRITICAL: FILTERED INDEX RESTRICTIONS:',
        '- NEVER use non-deterministic functions in filtered index WHERE clauses (GETDATE(), NEWID(), RAND(), CURRENT_TIMESTAMP, etc.)',
        '- NEVER use variables or parameters (@Param) in the filter - must use literals.',
        '- NEVER compare two columns (e.g., WHERE EndDate > StartDate) - illegal in filtered indexes.',
        '- NEVER use complex expressions like CASE, COALESCE, ISNULL, or user-defined functions.',
        '- SQL Server will reject filtered indexes with: GETDATE(), DATEADD(day, -90, GETDATE()), CURRENT_TIMESTAMP, SYSDATETIME(), etc.',
        '- ONLY use deterministic expressions: literal values, columns, deterministic functions',
        '- Requirement: Tables with filtered indexes require SET ANSI_NULLS ON and SET QUOTED_IDENTIFIER ON during creation and modification.',
        '',
        '⚠️ CRITICAL: DATA TYPE MATCHING IN FILTERED INDEX WHERE CLAUSE:',
        '- ALWAYS check the column data type from TABLE_METADATA before writing WHERE clause',
        '- The constant in the WHERE clause MUST match the column\'s data type exactly',
        '- Common data type mismatches that cause errors:',
        '  * Column is int/bigint → Use numeric constant: WHERE column = 1 (NOT \'1\')',
        '  * Column is bit → Use 0 or 1: WHERE column = 1 (NOT \'true\' or \'Active\')',
        '  * Column is varchar/nvarchar → Use quoted string: WHERE column = \'Active\' (NOT 1)',
        '  * Column is datetime/date → Use quoted date: WHERE column > \'2024-01-01\' (NOT 20240101)',
        '  * Column is uniqueidentifier → Use quoted GUID: WHERE column = \'12345678-1234-1234-1234-123456789012\'',
        '  * Column is decimal/numeric → Use numeric: WHERE column > 100.50 (NOT \'100.50\')',
        '- Example of DATA TYPE MISMATCH (will cause error):',
        '  * Column SituacaoActual is bit (0/1)',
        '  * WHERE SituacaoActual = \'Active\'  -- ❌ WRONG! Cannot convert \'Active\' to bit',
        '  * WHERE SituacaoActual = 1  -- ✅ CORRECT! bit column with numeric constant',
        '- Example of CORRECT data type matching:',
        '  * Column Status is varchar(20) → WHERE Status = \'Active\'  -- ✅ String to string',
        '  * Column IsActive is bit → WHERE IsActive = 1  -- ✅ bit to numeric',
        '  * Column Amount is decimal(10,2) → WHERE Amount > 1000.00  -- ✅ Numeric to numeric',
        '  * Column CreatedDate is datetime → WHERE CreatedDate > \'2024-01-01\'  -- ✅ String literal for date',
        '- Data type detection from TABLE_METADATA:',
        '  * Check the "type" or "data_type" field for each column',
        '  * Common types: int, bigint, bit, varchar, nvarchar, datetime, date, decimal, uniqueidentifier',
        '  * Match your WHERE clause constant to the column type',
        '- If you see error "constant cannot be converted to data type", check:',
        '  1. Column data type from TABLE_METADATA',
        '  2. Constant type in WHERE clause',
        '  3. Ensure they match (numeric for numeric, string for string, etc.)',
        '',
        '⚠️ VALID FILTERED INDEX EXAMPLES:',
        '  * WHERE data > \'2024-01-01\'  -- datetime column with date literal',
        '  * WHERE status = \'Active\'  -- varchar column with string literal',
        '  * WHERE amount > 1000  -- int/decimal column with numeric literal',
        '  * WHERE IsActive = 1  -- bit column with 0 or 1',
        '  * WHERE YEAR(data) = 2024  -- Deterministic function on column',
        '  * WHERE data IS NOT NULL  -- NULL check (works for any type)',
        '',
        '⚠️ INVALID FILTERED INDEX EXAMPLES:',
        '  * WHERE data > GETDATE()  -- ❌ Non-deterministic function',
        '  * WHERE data > DATEADD(day, -90, GETDATE())  -- ❌ Non-deterministic',
        '  * WHERE id = NEWID()  -- ❌ Non-deterministic',
        '  * WHERE IsActive = \'true\'  -- ❌ Data type mismatch (bit vs string)',
        '  * WHERE Amount = \'1000\'  -- ❌ Data type mismatch (numeric vs string)',
        '  * WHERE Status = 1  -- ❌ Data type mismatch (string vs numeric)',
        '',
        '- If you need time-based filtering, either:',
        '  1. Use a regular (non-filtered) index',
        '  2. Suggest a computed persisted column with the date calculation, then filter on that',
        '  3. Use a specific literal date instead of GETDATE()',
        '- Always validate that your WHERE clause is deterministic AND data types match before proposing a filtered index.',
        '',
        '⚡ VIEWS, FUNCTIONS, AND SYNONYMS HANDLING:',
        '- CRITICAL: Before creating any index, ALWAYS check the object type (Table, View, Function, Synonym) using sys.objects or OBJECT_ID().',
        '- VIEWS: You CANNOT create indexes directly on views (except indexed/materialized views with specific requirements).',
        '  * When a view is detected in the execution plan:',
        '    1. Retrieve the view definition using sp_helptext or sys.sql_modules',
        '    2. Analyze the view\'s SELECT statement and execution plan',
        '    3. Identify the underlying base tables referenced in the view',
        '    4. Check indexes, schema, and statistics on those base tables',
        '    5. If the view has performance issues, recursively analyze each underlying table as if running handleAnalyzePlanWithAI on them',
        '    6. Recommend indexes on the BASE TABLES, not the view itself',
        '    7. Consider if the view should be converted to an indexed view (requires SCHEMABINDING, no OUTER JOIN, etc.)',
        '    8. Check if view has WITH (NOEXPAND) hint for indexed views',
        '- SYNONYMS: Resolve the synonym to the actual object using sys.synonyms, then apply appropriate logic (table/view/function).',
        '- FUNCTIONS (Table-Valued Functions):',
        '  * Inline TVFs: Treat like views - analyze the underlying query and base tables',
        '  * Multi-statement TVFs: Cannot be indexed; recommend rewriting as inline TVF or stored procedure',
        '  * Scalar UDFs: Check if they are inlined (SQL 2019+) or causing row-by-row execution',
        '- For each object referenced in the query, determine its type and apply the correct analysis strategy.',
        '- If recommending index changes, ALWAYS specify the exact base table name, not the view/synonym name.',
        '---',
        'EXECUTION PLAN (ShowPlanXML):',
        xml,
      ]
      if (queryText && queryText.trim()) {
        sections.push('---')
        sections.push('CURRENT QUERY:')
        sections.push('````sql')
        sections.push(queryText)
        sections.push('````')
      }
      if (env && Object.keys(env).length) {
        sections.push('---')
        sections.push('ENVIRONMENT:')
        try { sections.push(JSON.stringify(env)) } catch (_) { sections.push(String(env)) }
      }
      if (serverCfg && Object.keys(serverCfg).length) {
        sections.push('---')
        sections.push('SERVER CONFIG:')
        try { sections.push(JSON.stringify(serverCfg)) } catch (_) { sections.push(String(serverCfg)) }
      }
      if (dbOpts && Object.keys(dbOpts).length) {
        sections.push('---')
        sections.push('DATABASE OPTIONS:')
        try { sections.push(JSON.stringify(dbOpts)) } catch (_) { sections.push(String(dbOpts)) }
      }
      if (sessionSet && Object.keys(sessionSet).length) {
        sections.push('---')
        sections.push('SESSION SET OPTIONS:')
        try { sections.push(JSON.stringify(sessionSet)) } catch (_) { sections.push(String(sessionSet)) }
      }
      if (compiledParams && Array.isArray(compiledParams.params) && compiledParams.params.length) {
        sections.push('---')
        sections.push('COMPILED PARAMETERS:')
        sections.push('```')
        for (const p of compiledParams.params) {
          sections.push(`${p.name} = ${p.value}`)
        }
        sections.push('```')
      }
      if (statsMsgs && statsMsgs.length) {
        sections.push('---')
        sections.push('STATISTICS IO/TIME MESSAGES:')
        sections.push('```')
        sections.push(statsMsgs.join('\n'))
        sections.push('```')
      }
      if (statsFreshness && statsFreshness.length) {
        sections.push('---')
        sections.push('STATISTICS FRESHNESS (STATS_DATE):')
        sections.push('```')
        for (const s of statsFreshness) sections.push(`${s.schema}.${s.table} -> ${s.stat_name}: ${s.last_updated}`)
        sections.push('```')
      }
      if (runtimeStats && Object.keys(runtimeStats).length) {
        sections.push('---')
        sections.push('RUNTIME STATS (dm_exec_query_stats):')
        try { sections.push(JSON.stringify(runtimeStats)) } catch (_) { sections.push(String(runtimeStats)) }
      }
      if (qsRuntime && (qsRuntime.runtime || (qsRuntime.waits && qsRuntime.waits.length))) {
        sections.push('---')
        sections.push('QUERY STORE RUNTIME/WAITS:')
        try { if (qsRuntime.runtime) sections.push(`runtime=${JSON.stringify(qsRuntime.runtime)}`) } catch (_) {}
        if (qsRuntime.waits && qsRuntime.waits.length) {
          sections.push('waits:')
          try { sections.push(JSON.stringify(qsRuntime.waits)) } catch (_) { sections.push(String(qsRuntime.waits)) }
        }
      }
      if (fileIoLatency && fileIoLatency.length) {
        sections.push('---')
        sections.push('FILE IO LATENCY (top files):')
        try { sections.push(JSON.stringify(fileIoLatency.slice(0,10))) } catch (_) { sections.push(String(fileIoLatency)) }
      }
      if (tempdbSnap && Object.keys(tempdbSnap).length) {
        sections.push('---')
        sections.push('TEMPDB SNAPSHOT:')
        try { sections.push(JSON.stringify(tempdbSnap)) } catch (_) { sections.push(String(tempdbSnap)) }
      }
      if (resourceGov && Object.keys(resourceGov).length) {
        sections.push('---')
        sections.push('RESOURCE GOVERNOR:')
        try { sections.push(JSON.stringify(resourceGov)) } catch (_) { sections.push(String(resourceGov)) }
      }
      if (hwInfo && Object.keys(hwInfo).length) {
        sections.push('---')
        sections.push('HARDWARE INFO:')
        try { sections.push(JSON.stringify(hwInfo)) } catch (_) { sections.push(String(hwInfo)) }
      }
      if (indexFrag && indexFrag.length) {
        sections.push('---')
        sections.push('INDEX FRAGMENTATION (sampled):')
        try { sections.push(JSON.stringify(indexFrag.slice(0,15))) } catch (_) { sections.push(String(indexFrag)) }
      }
      if (missIdx && missIdx.length) {
        sections.push('---')
        sections.push('MISSING INDEX SUGGESTIONS (from plan):')
        try { sections.push(JSON.stringify(missIdx.slice(0,8))) } catch (_) { sections.push(String(missIdx)) }
      }
      if (qsForced && Object.keys(qsForced).length) {
        sections.push('---')
        sections.push('QUERY STORE FORCED PLAN:')
        try { sections.push(JSON.stringify(qsForced)) } catch (_) { sections.push(String(qsForced)) }
      }
      if (statsProps && statsProps.length) {
        sections.push('---')
        sections.push('STATS PROPERTIES (rows, rows_sampled, modification_counter):')
        try { sections.push(JSON.stringify(statsProps.slice(0,20))) } catch (_) { sections.push(String(statsProps)) }
      }
      // Always include IO Summary and Plan Insights (Stage 1 data)
      if (ioSummary && ioSummary.length) {
        sections.push('---')
        sections.push('IO SUMMARY (Top by logical reads):')
        sections.push('```')
        for (const it of ioSummary) sections.push(`${it.table}: ${it.logicalReads} logical reads`)
        sections.push('```')
      }
      if (planInsights && Object.keys(planInsights).length) {
        sections.push('---')
        sections.push('PLAN INSIGHTS (warnings, missing indexes):')
        try { sections.push(JSON.stringify(planInsights)) } catch (_) { sections.push(String(planInsights)) }
      }
      if (missIdx && missIdx.length) {
        sections.push('---')
        sections.push('MISSING INDEX SUGGESTIONS (from plan):')
        try { sections.push(JSON.stringify(missIdx.slice(0,8))) } catch (_) { sections.push(String(missIdx)) }
      }
      
      // Auto-detected view/function definitions (Stage 1)
      if (viewDefinitions && viewDefinitions.length > 0) {
        sections.push('---')
        sections.push('VIEW DEFINITIONS (auto-detected):')
        sections.push('```sql')
        for (const v of viewDefinitions) {
          sections.push(`-- View: ${v.schema_name}.${v.object_name}`)
          sections.push(v.definition || '-- Definition not available')
          sections.push('')
        }
        sections.push('```')
        sections.push('⚠️ IMPORTANT: You can now suggest rewriting the query to avoid the view or recommend indexes on the BASE TABLES referenced in the view definition.')
      }
      
      if (functionDefinitions && functionDefinitions.length > 0) {
        sections.push('---')
        sections.push('FUNCTION DEFINITIONS (auto-detected):')
        sections.push('```sql')
        for (const f of functionDefinitions) {
          sections.push(`-- Function: ${f.schema_name}.${f.object_name} (${f.type_desc})`)
          sections.push(f.definition || '-- Definition not available')
          sections.push('')
        }
        sections.push('```')
        sections.push('⚠️ IMPORTANT: Check if this is an inline TVF (can be optimized) or multi-statement TVF (should be rewritten). You can suggest rewriting the query to avoid the function or converting multi-statement TVF to inline TVF.')
      }
      
      // Stage 2 data - only included if collected (after AI_REQUEST)
      if (metaJson && metaJson.trim()) {
        sections.push('---')
        sections.push('TABLE METADATA (JSON: schema, columns, indexes, stats):')
        sections.push(metaJson)
        if (ddlScripts && ddlScripts.trim()) {
          sections.push('---')
          sections.push('DDL CONTEXT (approximate):')
          sections.push('```sql')
          sections.push(ddlScripts)
          sections.push('```')
        }
        this.setAnalysisStatus('{Included TABLE METADATA and DDL CONTEXT}')
      }
      // XML compression already handled above (lines 869-923)
      // No additional truncation needed here

      sections.push('Return:')
      sections.push('- If SET STATISTICS IO/TIME output is not available, proceed using the execution plan only. Do NOT block waiting for stats. If stats are present, incorporate IO/time observations into Plan Summary and Root Causes.')
      sections.push('- Enclose the entire final response between AI_FINAL_BEGIN and AI_FINAL_END markers')
      sections.push('- Do NOT include metadata collection SQL (sys.* etc.). Use staged requests instead if more data is needed')
      sections.push('- Original Query (verbatim) before any rewrites or refactors')
      sections.push('- Summary of plan shape and most costly operators')
      sections.push('- Root causes: analyze ALL of these from the plan XML and provided metrics:')
      sections.push('  * Key Lookups and RID Lookups - check for Clustered Index Seek following NonClustered Index Seek')
      sections.push('  * Implicit Conversions - search for CONVERT_IMPLICIT in plan XML')
      sections.push('  * Table/Index Scans on large tables - check Actual/Estimated rows and scan count')
      sections.push('  * Cardinality mismatches - compare EstimateRows vs ActualRows for each operator')
      sections.push('  * High execution counts - check Number of Executions and Actual Rewinds')
      sections.push('  * Spills to tempdb - look for Sort/Hash warnings in plan XML')
      sections.push('  * Missing indexes - check MISSING INDEX SUGGESTIONS section if provided')
      sections.push('  * Stale statistics - check STATISTICS FRESHNESS and STATS PROPERTIES sections')
      sections.push('  * Index fragmentation - check INDEX FRAGMENTATION section if provided')
      sections.push('  * Parameter sniffing - check COMPILED PARAMETERS vs typical values')
      sections.push('  * Expensive operators - Sort, Hash Match, Nested Loops with large outer input')
      sections.push('  * Non-sargable predicates - check for functions on columns in WHERE/JOIN')
      sections.push('  * Parallelism issues - check DegreeOfParallelism and thread distribution')
      sections.push('  * Memory grant issues - check MemoryGrant warnings and actual vs granted')
      sections.push('- Concrete fixes: indexes (with columns and includes), query rewrites, predicates, hints only if necessary')
      sections.push('- Estimated impact and tradeoffs')
      sections.push('- Final Response Template (use these headings exactly):')
      sections.push('  AI_FINAL_BEGIN')
      sections.push('  1) Original Query:')
      sections.push('     ```sql')
      sections.push('     -- Original query text here, verbatim')
      sections.push('     ```')
      sections.push('  2) Plan Summary and Warnings:')
      sections.push('     - Provide structured summary with key metrics:')
      sections.push('       * **Query Type**: SELECT/INSERT/UPDATE/DELETE, JOIN types, aggregations')
      sections.push('       * **Execution Stats**: Total logical reads, CPU time, elapsed time, row counts')
      sections.push('       * **Most Expensive Operators**: Top 3 operators by cost with percentages')
      sections.push('       * **Critical Warnings**: Missing indexes, implicit conversions, spills, cardinality mismatches')
      sections.push('       * **Plan Shape**: Scan vs Seek ratio, parallelism degree, join strategies')
      sections.push('  3) Root Causes:')
      sections.push('     - Prioritize issues by impact (use emoji indicators):')
      sections.push('       * 🔴 **CRITICAL** (>50% of total cost): Issues that must be fixed immediately')
      sections.push('       * 🟡 **HIGH** (20-50% of cost): Significant performance impact')
      sections.push('       * 🟢 **MEDIUM** (5-20% of cost): Noticeable but not urgent')
      sections.push('       * ⚪ **LOW** (<5% of cost): Minor optimizations')
      sections.push('     - For each root cause, provide:')
      sections.push('       * **Issue**: What is wrong (e.g., "Table scan on Orders table")')
      sections.push('       * **Impact**: Cost percentage and affected rows (e.g., "45% of total cost, 1.2M rows scanned")')
      sections.push('       * **Why It Happens**: Technical explanation (e.g., "No index on OrderDate column")')
      sections.push('       * **How to Fix**: Brief solution pointer (e.g., "Create nonclustered index on OrderDate - see Section 4")')
      sections.push('  4) Index Review and Proposals:')
      sections.push('     - ⚠️ CRITICAL: COLUMN VALIDATION - Before proposing ANY index:')
      sections.push('       * Extract the table name from your proposed index')
      sections.push('       * Find that table in TABLE_METADATA')
      sections.push('       * Get the EXACT list of columns for that table')
      sections.push('       * Verify EVERY column in your index (keys AND includes) exists in that table')
      sections.push('       * Check spelling matches exactly (case-sensitive)')
      sections.push('       * If ANY column doesn\'t exist → DO NOT recommend that index')
      sections.push('       * Example: Orders table has (OrderID, CustomerID, OrderDate, TotalAmount)')
      sections.push('       * VALID: CREATE INDEX ... ON Orders (CustomerID) INCLUDE (TotalAmount) ✅')
      sections.push('       * INVALID: CREATE INDEX ... ON Orders (ProductID) ❌ (ProductID not in Orders)')
      sections.push('     - CRITICAL: Perform cost-benefit analysis for EACH proposed index:')
      sections.push('       * Check execution plan metrics: Actual Rows Read, Estimated I/O Cost, Estimated CPU Cost')
      sections.push('       * Review existing indexes on the table (from TABLE_METADATA)')
      sections.push('       * Calculate estimated index size: (row_count × (key_columns_size + include_columns_size)) / 1024 / 1024 MB')
      sections.push('       * Assess total index overhead: sum of all existing index sizes + new index size')
      sections.push('       * Evaluate query frequency: is this a one-time query or frequently executed?')
      sections.push('       * Consider maintenance cost: index updates on INSERT/UPDATE/DELETE')
      sections.push('     - For EACH index recommendation, provide:')
      sections.push('       * **Recommendation Level**: CRITICAL / RECOMMENDED / OPTIONAL / NOT RECOMMENDED')
      sections.push('       * **Justification**: Why this index is needed (or not needed)')
      sections.push('       * **Performance Impact**: Expected improvement (e.g., "Reduce logical reads from 31,465 to ~500 (98% improvement)")')
      sections.push('       * **Storage Cost**: Estimated index size in MB')
      sections.push('       * **Duplicate Check**: CRITICAL - Compare with existing indexes from TABLE_METADATA/DDL_CONTEXT:')
      sections.push('         - Extract key columns (in order) from existing indexes')
      sections.push('         - Extract INCLUDE columns (any order) from existing indexes')
      sections.push('         - Extract WHERE clause from existing filtered indexes')
      sections.push('         - If EXACT match (same keys in order, same includes, same WHERE): Mark as "DUPLICATE - Already exists as [IndexName]"')
      sections.push('         - If similar (subset of keys/includes): Recommend UPDATE with DROP_EXISTING=ON instead of new index')
      sections.push('         - If different: Proceed with new index recommendation')
      sections.push('       * **Existing Index Analysis**: Does a similar index already exist? Can we update it instead?')
      sections.push('       * **Maintenance Overhead**: Impact on INSERT/UPDATE/DELETE operations')
      sections.push('       * **Best Practice Guidance**: Should the user create this index? Consider:')
      sections.push('         - If query is infrequent (< 10 executions/day) and table is small (< 100K rows): NOT RECOMMENDED')
      sections.push('         - If similar index exists with 80%+ column overlap: RECOMMENDED to update existing with DROP_EXISTING=ON')
      sections.push('         - If table already has 10+ indexes: OPTIONAL (evaluate if other indexes can be consolidated)')
      sections.push('         - If query has high I/O cost (> 1.0) and frequent execution (> 100/day): CRITICAL')
      sections.push('         - If index size > 500MB and query improvement < 50%: NOT RECOMMENDED')
      sections.push('     - Provide full T-SQL CREATE INDEX statements, schema-qualified, INCLUDE/filtered WHERE as needed.')
      sections.push('     - ⚠️ CRITICAL: NO PLACEHOLDERS - Specify EXACT column names:')
      sections.push('       * NEVER use: INCLUDE ( /* Add columns here */ ) ❌')
      sections.push('       * ALWAYS use: INCLUDE (OrderDate, TotalAmount, Status) ✅')
      sections.push('       * If unsure which columns to include: Analyze the query SELECT list and include columns not in key')
      sections.push('       * If still unsure: Omit INCLUDE clause entirely (key columns only)')
      sections.push('       * INCLUDE should only contain columns used in the query but not in WHERE/JOIN predicates')
      sections.push('     - ⚠️ CRITICAL: Check SQL Server version/edition from SERVER_CONFIG and use compatible WITH options:')
      sections.push('       * Unknown/SQL 2008-2012: WITH (DROP_EXISTING=ON, SORT_IN_TEMPDB=ON)')
      sections.push('       * SQL 2014+ Standard: WITH (DROP_EXISTING=ON, ONLINE=ON, SORT_IN_TEMPDB=ON)')
      sections.push('       * SQL 2016 SP1+ Standard: WITH (DROP_EXISTING=ON, ONLINE=ON, SORT_IN_TEMPDB=ON, DATA_COMPRESSION=PAGE)')
      sections.push('       * SQL 2017+ Enterprise: WITH (DROP_EXISTING=ON, ONLINE=ON, SORT_IN_TEMPDB=ON, DATA_COMPRESSION=PAGE, RESUMABLE=ON)')
      sections.push('       * SQL 2019+: Add OPTIMIZE_FOR_SEQUENTIAL_KEY=ON if high insert contention on identity/sequential key')
      sections.push('     - ⚠️ CRITICAL: Check column data types from TABLE_METADATA - NEVER use MAX types or LOBs as KEY columns:')
      sections.push('       * nvarchar(max), varchar(max), varbinary(max), text, ntext, image, xml → Can ONLY be in INCLUDE clause')
      sections.push('       * If a column is nvarchar(max) and needed for filtering, use a computed column: LEFT(column, 450) PERSISTED')
      sections.push('       * Example: morada is nvarchar(max) → CREATE INDEX ... ON Table (CustomerID) INCLUDE (morada) ✅')
      sections.push('       * Example: morada is nvarchar(max) → CREATE INDEX ... ON Table (morada) ❌ WILL FAIL')
      sections.push('     - ⚠️ CRITICAL: For filtered indexes, check column data types and match constants correctly:')
      sections.push('       * bit column → Use 0 or 1: WHERE IsActive = 1 (NOT \'true\' or \'Active\')')
      sections.push('       * int/bigint → Use numeric: WHERE Amount > 1000 (NOT \'1000\')')
      sections.push('       * varchar/nvarchar → Use quoted string: WHERE Status = \'Active\' (NOT 1)')
      sections.push('       * datetime/date → Use quoted date: WHERE CreatedDate > \'2024-01-01\'')
      sections.push('       * Example error: SituacaoActual is bit, WHERE SituacaoActual = \'Active\' ❌ (should be WHERE SituacaoActual = 1 ✅)')
      sections.push('     - ⚠️ CRITICAL: For filtered indexes, NEVER use non-deterministic functions (GETDATE(), NEWID(), CURRENT_TIMESTAMP, etc.) in WHERE clause - use literal values only!')
      sections.push('     - If updating an existing index, preserve existing key columns/order; for PK/UNIQUE never change keys; add coverage via INCLUDE.')
      sections.push('     - Include a comment above each index showing the detected version/edition and any data type considerations for transparency.')
      sections.push('  5) Query Rewrite - ALWAYS PROVIDE OPTIMIZED QUERY:')
      sections.push('     - ⚠️ CRITICAL: ALWAYS provide a rewritten/optimized version of the query that resolves the performance issues')
      sections.push('     - This is NOT optional - users expect a ready-to-use optimized query')
      sections.push('     - Provide the complete rewritten query in executable SQL format')
      sections.push('     - For each rewrite, include:')
      sections.push('       * **Rewrite Type**: Sargability fix, predicate pushdown, join elimination, subquery to JOIN, CTE optimization, etc.')
      sections.push('       * **Original Query**: Show the original query in ```sql block')
      sections.push('       * **Optimized Query**: Show the rewritten query in ```sql block (ready to copy/paste)')
      sections.push('       * **Key Changes**: Bullet list of specific changes made')
      sections.push('       * **Why It Helps**: Explain each optimization (e.g., "Removes YEAR() function on column, enables index seek")')
      sections.push('       * **Expected Impact**: Quantified improvement (e.g., "Reduces logical reads from 45,000 to ~200 (99.5% improvement)")')
      sections.push('       * **Compatibility**: Note any SQL Server version requirements or behavior changes')
      sections.push('       * **Testing Recommendation**: "Test thoroughly - rewrite changes query semantics" or "Safe - logically equivalent"')
      sections.push('     - Common query rewrites to consider:')
      sections.push('       * Remove functions on columns in WHERE/JOIN: YEAR(OrderDate) = 2024 → OrderDate >= \'2024-01-01\' AND OrderDate < \'2025-01-01\'')
      sections.push('       * Fix implicit conversions: Add explicit CAST/CONVERT to match data types')
      sections.push('       * Convert scalar subqueries to JOINs or APPLY')
      sections.push('       * Replace DISTINCT with GROUP BY when appropriate')
      sections.push('       * Push predicates into views/CTEs')
      sections.push('       * Eliminate unnecessary JOINs')
      sections.push('       * Replace OR with UNION ALL for better index usage')
      sections.push('       * Use EXISTS instead of IN for large subqueries')
      sections.push('       * Add OPTION (RECOMPILE) for parameter sniffing issues')
      sections.push('       * Use indexed views for complex aggregations')
      sections.push('     - If the original query is already optimal, still provide it as "Optimized Query" with note: "Query is already well-optimized"')
      sections.push('  6) Predicates and Seek Predicates:')
      sections.push('     - Simplify for non-experts with actionable guidance:')
      sections.push('       * **Current Predicate Behavior**: Which predicates are seeks vs scans/filters')
      sections.push('       * **After Proposed Changes**: How predicates will behave with new indexes')
      sections.push('       * **Sargability Issues**: Functions on columns, implicit conversions, OR conditions preventing seeks')
      sections.push('       * **Optimization Opportunities**: How to make non-sargable predicates sargable')
      sections.push('       * **Visual Indicator**: Use ✅ for seeks, ⚠️ for residual filters, ❌ for scans')
      sections.push('  7) Estimated Impact and Tradeoffs:')
      sections.push('     - Provide comprehensive cost-benefit analysis with specific numbers:')
      sections.push('       * **Performance Gains**:')
      sections.push('         - Logical reads: Before → After (% reduction)')
      sections.push('         - CPU time: Before → After (% reduction)')
      sections.push('         - Elapsed time: Before → After (% reduction)')
      sections.push('         - Row processing: Scanned rows → Returned rows (selectivity improvement)')
      sections.push('       * **Resource Costs**:')
      sections.push('         - Storage: Total index size increase in MB and %')
      sections.push('         - Memory: Additional buffer pool usage for new indexes')
      sections.push('         - Maintenance: INSERT/UPDATE/DELETE overhead in ms per operation')
      sections.push('       * **Break-Even Analysis**:')
      sections.push('         - "These indexes will pay for themselves after ~X query executions"')
      sections.push('         - "At current query frequency (Y executions/day), ROI achieved in Z days"')
      sections.push('       * **Risk Assessment**:')
      sections.push('         - 🟢 **LOW RISK**: Simple index additions, well-tested patterns')
      sections.push('         - 🟡 **MEDIUM RISK**: Query rewrites, filtered indexes, large index sizes')
      sections.push('         - 🔴 **HIGH RISK**: Hints/trace flags, schema changes, breaking changes')
      sections.push('       * **Implementation Priority**:')
      sections.push('         - "Implement immediately: [list CRITICAL items]"')
      sections.push('         - "Schedule for next maintenance window: [list RECOMMENDED items]"')
      sections.push('         - "Evaluate based on workload: [list OPTIONAL items]"')
      sections.push('         - "Do not implement: [list NOT RECOMMENDED items with reasons]"')
      sections.push('  8) Advanced Optimizations (Table Partitioning & Columnstore):')
      sections.push('     - ⚠️ CRITICAL: Check table size and query patterns to recommend partitioning and columnstore indexes')
      sections.push('     - **Table Partitioning** - Recommend when:')
      sections.push('       * Table size > 100 GB or > 100 million rows')
      sections.push('       * Queries frequently filter on a date/time column (e.g., WHERE OrderDate > \'2024-01-01\')')
      sections.push('       * Historical data can be archived or queried separately')
      sections.push('       * Maintenance operations (index rebuild, backup) are slow due to table size')
      sections.push('       * Benefits: Partition elimination, faster maintenance, improved query performance')
      sections.push('       * Example: Partition Orders table by OrderDate (monthly or yearly partitions)')
      sections.push('       * Provide partition function and scheme DDL:')
      sections.push('         ```sql')
      sections.push('         CREATE PARTITION FUNCTION pf_OrderDate (datetime)')
      sections.push('         AS RANGE RIGHT FOR VALUES (\'2023-01-01\', \'2024-01-01\', \'2025-01-01\');')
      sections.push('         ')
      sections.push('         CREATE PARTITION SCHEME ps_OrderDate')
      sections.push('         AS PARTITION pf_OrderDate ALL TO ([PRIMARY]);')
      sections.push('         ```')
      sections.push('     - **Columnstore Indexes** - Recommend when:')
      sections.push('       * Table size > 10 GB or > 1 million rows')
      sections.push('       * Queries perform aggregations (SUM, AVG, COUNT, GROUP BY)')
      sections.push('       * Queries scan large portions of the table (analytical/reporting queries)')
      sections.push('       * Table has many columns but queries only access a few')
      sections.push('       * Data is mostly read-only or batch-updated (not frequent single-row updates)')
      sections.push('       * Benefits: 10x-100x compression, 10x-100x faster aggregations, reduced I/O')
      sections.push('       * Types:')
      sections.push('         - **Clustered Columnstore (CCI)**: For large fact tables (data warehouse) - REPLACES existing clustered index')
      sections.push('         - **Nonclustered Columnstore (NCCI)**: For OLTP tables with reporting queries - KEEPS existing clustered index')
      sections.push('       * ⚠️ CRITICAL: Check if table already has a clustered index:')
      sections.push('         - If table has clustered rowstore index + OLTP workload → Recommend NONCLUSTERED columnstore')
      sections.push('         - If table has clustered rowstore index + pure analytics → Can recommend CLUSTERED columnstore (but explain it replaces the clustered index)')
      sections.push('         - If recommending CLUSTERED columnstore, must explain: "This will DROP the existing clustered index. Ensure PK/unique constraints are recreated as nonclustered."')
      sections.push('       * ⚠️ CRITICAL: Columnstore WITH options (use ONLY these):')
      sections.push('         - DROP_EXISTING = ON (to rebuild existing columnstore)')
      sections.push('         - MAXDOP = n (parallel degree)')
      sections.push('         - COMPRESSION_DELAY = n MINUTES (for NCCI on OLTP tables, delays compression of new rows)')
      sections.push('         - DATA_COMPRESSION = COLUMNSTORE | COLUMNSTORE_ARCHIVE (NOT PAGE/ROW)')
      sections.push('         - ONLINE = ON (if supported by version/edition)')
      sections.push('         - DO NOT use: SORT_IN_TEMPDB, FILLFACTOR, PAD_INDEX (these are rowstore-only)')
      sections.push('       * ⚠️ CRITICAL: Filtered columnstore (WHERE clause):')
      sections.push('         - ONLY supported for NONCLUSTERED columnstore indexes')
      sections.push('         - NEVER use WHERE clause with CLUSTERED columnstore')
      sections.push('         - For NONCLUSTERED columnstore, WHERE must be deterministic and type-safe (same rules as filtered rowstore indexes)')
      sections.push('         - Example VALID: CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders ON Orders(OrderDate, Amount) WHERE Status = \'Active\';')
      sections.push('         - Example INVALID: CREATE CLUSTERED COLUMNSTORE INDEX CCI_Orders ON Orders WHERE Status = \'Active\'; -- ❌ No WHERE for CCI')
      sections.push('       * Example for analytical queries:')
      sections.push('         ```sql')
      sections.push('         -- Clustered columnstore (replaces clustered index)')
      sections.push('         CREATE CLUSTERED COLUMNSTORE INDEX CCI_Orders')
      sections.push('         ON Orders')
      sections.push('         WITH (DATA_COMPRESSION = COLUMNSTORE);')
      sections.push('         ')
      sections.push('         -- Nonclustered columnstore (keeps existing indexes)')
      sections.push('         CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders')
      sections.push('         ON Orders (OrderDate, CustomerID, TotalAmount, Status)')
      sections.push('         WITH (COMPRESSION_DELAY = 10 MINUTES, DATA_COMPRESSION = COLUMNSTORE);')
      sections.push('         ')
      sections.push('         -- Filtered nonclustered columnstore (WHERE supported)')
      sections.push('         CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_Orders_Active')
      sections.push('         ON Orders (OrderDate, CustomerID, TotalAmount)')
      sections.push('         WHERE Status = \'Active\'')
      sections.push('         WITH (DATA_COMPRESSION = COLUMNSTORE);')
      sections.push('         ```')
      sections.push('     - **Combining Partitioning + Columnstore**:')
      sections.push('       * For very large tables (> 500 GB), combine both techniques')
      sections.push('       * Partition by date, then create columnstore on each partition')
      sections.push('       * Enables partition elimination + columnstore compression')
      sections.push('       * Example:')
      sections.push('         ```sql')
      sections.push('         -- Create partitioned table with columnstore')
      sections.push('         CREATE CLUSTERED COLUMNSTORE INDEX CCI_Orders')
      sections.push('         ON Orders')
      sections.push('         ON ps_OrderDate(OrderDate);')
      sections.push('         ```')
      sections.push('     - **When NOT to use**:')
      sections.push('       * Columnstore: Frequent single-row inserts/updates/deletes (OLTP workload)')
      sections.push('       * Columnstore: Queries need row-level locking or small point lookups')
      sections.push('       * Partitioning: Table < 50 GB (overhead not worth it)')
      sections.push('       * Partitioning: No clear partitioning key (date/region/category)')
      sections.push('     - **Version Requirements**:')
      sections.push('       * Columnstore: SQL Server 2012+ (Enterprise), SQL 2016 SP1+ (Standard)')
      sections.push('       * Partitioning: SQL Server 2008+ (Enterprise), SQL 2016 SP1+ (Standard)')
      sections.push('  9) Last-Resort Hints/Trace Flags (optional):')
      sections.push('     - Only if strictly necessary after exhausting index, rewrite, partitioning, and columnstore options')
      sections.push('     - For each hint/flag, provide:')
      sections.push('       * **Hint/Flag**: Specific syntax (e.g., "OPTION (MAXDOP 4)" or "QUERYTRACEON 4199")')
      sections.push('       * **Purpose**: What it fixes (e.g., "Limits parallelism to reduce CXPACKET waits")')
      sections.push('       * **Risk Level**: 🟢 LOW / 🟡 MEDIUM / 🔴 HIGH')
      sections.push('       * **Side Effects**: Potential negative impacts (e.g., "May slow down other queries")')
      sections.push('       * **Scope**: Query-level (OPTION hint) vs Server-level (trace flag) vs Database-level')
      sections.push('       * **Monitoring**: What to watch after implementation (e.g., "Monitor wait stats for CXPACKET reduction")')
      sections.push('       * **Rollback Plan**: How to remove if it causes issues (e.g., "Remove OPTION hint from query")')
      sections.push('       * **Documentation**: Link to Microsoft docs or explain undocumented flags with caution')
      sections.push('  AI_FINAL_END')
      const prompt = sections.join('\n')
      
      // Log token estimate for debugging
      const estimatedTokens = Math.ceil(prompt.length / 4)
      try { 
        this.$root.$emit(AppEvent.aiAnalysisLog, { 
          level: 'info', 
          message: `Sending Stage 1 prompt: ${prompt.length} chars (~${estimatedTokens} tokens)` 
        }) 
      } catch (_) {}
      console.log(`[Toolbar] Stage 1 prompt size: ${prompt.length} chars (~${estimatedTokens} tokens)`)
      
      // Store Stage 1 prompt for use in Stage 2 (when AI requests additional data)
      this._stage1Prompt = prompt
      
      this.setAnalysisStatus('{Analyzing: sending prompt to AI}')
      this.$root.$emit(AppEvent.aiInlinePrompt, { prompt, runAfterInsert: false, aiMode: 'analysis' })
      this.setAnalysisStatus('{Waiting for AI_FINAL markers} (stage 1)')
      // Completion will be signaled by other components; add a timeout fallback log
      setTimeout(() => {
        if (this.analysisStatus.active && this.analysisStatus.message.toLowerCase().includes('waiting for ai_final')) {
          this.setAnalysisStatus('{Still waiting for AI_FINAL markers} (stage 1)')
          try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'info', message: 'Still waiting for AI response...' }) } catch (_) {}
        }
      }, 15000)
    },

    // Insert final AI recommendations into a new query tab, preserving the current tab
    async handleAiAnalysisFinalText(payload) {
      try {
        console.log('[Toolbar] handleAiAnalysisFinalText called, payload:', payload)
        const text = (payload && payload.text) || (typeof payload === 'string' ? payload : '')
        console.log('[Toolbar] Extracted text length:', text?.length)
        if (!text || !text.trim()) {
          console.warn('[Toolbar] Rejecting: text is empty')
          return
        }

        // Second-layer validation: enforce AI_FINAL markers and required sections
        const begin = text.indexOf('AI_FINAL_BEGIN')
        const end = text.indexOf('AI_FINAL_END')
        console.log('[Toolbar] AI_FINAL markers:', { begin, end })
        if (begin === -1 || end === -1 || end <= begin) {
          console.warn('[Toolbar] Rejecting: missing AI_FINAL markers')
          try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: 'Rejecting insertion: missing AI_FINAL markers.' }) } catch (_) {}
          return
        }
        const candidate = text.substring(begin + 'AI_FINAL_BEGIN'.length, end).trim()
        // Required sections and structure (accept legacy and new headings)
        const hasOriginalQuery = /(\n|^)\s*1[\).]\s*Original\s+Query/i.test(candidate)
        const hasOriginalQueryFence = /Original\s+Query[\s\S]*```sql[\s\S]*```/i.test(candidate)
        const hasPlanSummary = /(\n|^)\s*2[\).]\s*Plan\s+Summary(\s+and\s+Warnings)?/i.test(candidate)
        const hasRootCauses = /(\n|^)\s*3[\).]\s*Root\s+Causes/i.test(candidate)
        const hasIndexReview = /(\n|^)\s*4[\).]\s*(Index\s+Review\s+and\s+Proposals|Index\s+Recommendations)/i.test(candidate)
        const hasPredicates = /(\n|^)\s*6[\).]\s*(Predicates\s+and\s+Seek\s+Predicates|Predicate\s+Analysis)/i.test(candidate)
        const hasImpact = /(\n|^)\s*7[\).]\s*(Estimated\s+Impact(\s+and\s+Tradeoffs)?)/i.test(candidate)
        const hasIndexDDL = /(CREATE\s+(UNIQUE\s+)?INDEX|WITH\s*\(\s*DROP_EXISTING\s*=\s*ON)/i.test(candidate)
        const containsMetadataSql = /(\bfrom\s+sys\.|\bjoin\s+sys\.|\bobject_id\s*\(|\bOBJECT_ID\s*\(|\bINFORMATION_SCHEMA\b|\bsys\.(objects|schemas|indexes)\b)/i.test(candidate)
        const nonCommentLines = candidate.split(/\r?\n/).filter(l => l.trim() && !/^\s*--/.test(l)).length
        const isCommentOnly = nonCommentLines === 0
        const hasPlaceholders = /<summary here>|\bTBD\b|Provide full T-SQL|Provide an improved version|Only if strictly necessary/i.test(candidate) || /```sql\s*```/i.test(candidate)

        let workingCandidate = candidate
        const missing = []
        if (!hasOriginalQuery) missing.push('1) Original Query')
        if (!hasOriginalQueryFence) missing.push('1) Original Query fenced ```sql```')
        if (!hasPlanSummary) missing.push('2) Plan Summary')
        if (!hasRootCauses) missing.push('3) Root Causes')
        if (!hasIndexReview) missing.push('4) Index Recommendations')
        if (!hasPredicates) missing.push('6) Predicate Analysis')
        if (!hasImpact) missing.push('7) Estimated Impact')
        
        // Only require CREATE INDEX DDL if the AI is recommending indexes (not when it says "no indexes needed")
        const recommendsIndexes = /recommend|suggest|create|add|missing|need.*index/i.test(candidate) && !/no.*index|adequate|sufficient|optimal|not.*needed/i.test(candidate)
        if (recommendsIndexes && !hasIndexDDL) {
          missing.push('4) Index DDL (CREATE INDEX statements required when recommending indexes)')
        }

        // If Original Query is missing but we have the current editor query, auto-backfill section 1
        if ((!hasOriginalQuery || !hasOriginalQueryFence) && !containsMetadataSql) {
          try {
            const coreTabs = this.$root.$refs.CoreTabs
            const activeTab = coreTabs && coreTabs.activeTab
            const currentEditorQuery = activeTab ? (activeTab.unsavedQueryText || activeTab.query || '') : ''
            if (currentEditorQuery && currentEditorQuery.trim()) {
              const origSection = '1) Original Query:\n```sql\n' + currentEditorQuery.trim() + '\n```\n\n'
              workingCandidate = origSection + candidate
              // Recompute validations after backfill
              const hasPlanSummary2 = /(\n|^)\s*2[\).]\s*Plan\s+Summary\s+and\s+Warnings/i.test(workingCandidate)
              const hasRootCauses2 = /(\n|^)\s*3[\).]\s*Root\s+Causes/i.test(workingCandidate)
              const hasIndexReview2 = /(\n|^)\s*4[\).]\s*Index\s+Review\s+and\s+Proposals/i.test(workingCandidate)
              const hasPredicates2 = /(\n|^)\s*6[\).]\s*Predicates\s+and\s+Seek\s+Predicates/i.test(workingCandidate)
              const hasImpact2 = /(\n|^)\s*7[\).]\s*Estimated\s+Impact\s+and\s+Tradeoffs/i.test(workingCandidate)
              const hasIndexDDL2 = /(CREATE\s+(UNIQUE\s+)?INDEX|WITH\s*\(\s*DROP_EXISTING\s*=\s*ON)/i.test(workingCandidate)
              const nonCommentLines2 = workingCandidate.split(/\r?\n/).filter(l => l.trim() && !/^\s*--/.test(l)).length
              const isCommentOnly2 = nonCommentLines2 === 0
              if (hasPlanSummary2 && hasRootCauses2 && hasIndexReview2 && hasPredicates2 && hasImpact2 && hasIndexDDL2 && !isCommentOnly2) {
                // Use backfilled candidate
              } else {
                // Keep original candidate and let the normal rejection path log details
                workingCandidate = candidate
              }
            }
          } catch (_) {}
        }

        console.log('[Toolbar] Validation results:', {
          hasOriginalQuery, hasOriginalQueryFence, hasPlanSummary, hasRootCauses,
          hasIndexReview, hasPredicates, hasImpact, hasIndexDDL,
          containsMetadataSql, isCommentOnly, hasPlaceholders,
          missing: missing.join(', ')
        })
        
        if (missing.length > 0 || containsMetadataSql || isCommentOnly) {
          if (containsMetadataSql) {
            console.warn('[Toolbar] Rejecting: contains metadata SQL')
            try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: 'Rejecting insertion: content contains metadata-gathering SQL (sys.* / OBJECT_ID / INFORMATION_SCHEMA).' }) } catch (_) {}
          }
          if (isCommentOnly) {
            console.warn('[Toolbar] Rejecting: comment-only')
            try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: 'Rejecting insertion: content appears to be comment-only guidance.' }) } catch (_) {}
          }
          if (missing.length > 0) {
            console.warn('[Toolbar] Rejecting: missing sections ->', missing.join(', '))
            try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: 'Rejecting insertion: missing required sections -> ' + missing.join(', ') }) } catch (_) {}
          }
          return
        }

        // If it contains placeholders, do not insert; keep analysis status active for a re-run
        if (hasPlaceholders) {
          // One-time auto-refine pass without bothering the user
          if (!this.analysisRefineAttempted) {
            this.analysisRefineAttempted = true
            try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: 'Final AI output contains placeholders; auto-refining...' }) } catch (_) {}
            try { this.setAnalysisStatus('{Refining: re-requesting concrete recommendations}') } catch (_) {}
            // Re-run analyze with refine flag; do not show popup
            setTimeout(() => this.handleAnalyzePlanWithAI(true), 50)
            return
          }
          // If refinement already attempted, proceed with insertion but log a soft warning
          try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'warn', message: 'Refined output still contains placeholders; inserting anyway.' }) } catch (_) {}
        }

        // Compose content with a clear header and timestamp
        const ts = new Date().toISOString().replace('T',' ').replace('Z','')
        const header = `-- AI Recommendations generated ${ts}\n` +
                       `-- Review carefully before executing.\n\n`
        const content = header + workingCandidate + (workingCandidate.endsWith('\n') ? '' : '\n')
        // Create a brand-new query tab with this content to avoid touching the current tab
        try {
          const coreTabs = this.$root.$refs.CoreTabs
          if (coreTabs && typeof coreTabs.createQuery === 'function') {
            await coreTabs.createQuery(content, 'AI Recommendations')
          } else {
            // Fallback: use actionHandler but pass content by simulating paste after mount
            this.actionHandler.newQuery()
            await this.$nextTick()
            const nt = coreTabs && coreTabs.activeTab
            const compRef2 = coreTabs && nt && coreTabs.$refs[`tab-${nt.id}`]
            const tabComp2 = compRef2 && compRef2[0]
            if (nt) nt.unsavedQueryText = content
            if (tabComp2 && tabComp2.editor && typeof tabComp2.editor.setValue === 'function') tabComp2.editor.setValue(content)
          }
        } catch (_) {}
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'info', message: 'Inserted recommendations into a new tab' }) } catch (_) {}
        try { this.$noty.success('AI recommendations inserted into a new tab') } catch (_) {}
        // Cleanup analysis status
        try { this.clearAnalysisStatus() } catch (_) {}
        this.analysisFlowActive = false
        try { this.analysisStore?.setAnalysisFlowActive(false) } catch {}
        this.analysisRefineAttempted = false
      } catch (e) {
        try { this.$root.$emit(AppEvent.aiAnalysisLog, { level: 'error', message: `Failed to insert recommendations: ${e && e.message ? e.message : e}` }) } catch (_) {}
      }
    },
    
    // Theme Actions
    toggleThemeMenu(event) {
      event.stopPropagation()
      this.showThemeMenu = !this.showThemeMenu
    },
    closeThemeMenu() {
      this.showThemeMenu = false
    },
    selectTheme(theme) {
      // switchTheme expects a label that will be converted to lowercase with spaces replaced by dashes
      // So we need to convert our theme format back to the label format
      const themeLabels = {
        'system': 'System',
        'light': 'Light',
        'dark': 'Dark',
        'solarized': 'Solarized',
        'solarized-dark': 'Solarized Dark'
      }
      this.actionHandler.switchTheme(themeLabels[theme] || theme)
      this.showThemeMenu = false
    }
  }
}
</script>

<style scoped>
.app-toolbar {
  display: flex;
  align-items: center;
  min-height: 38px;
  background: var(--theme-bg);
  border-bottom: 1px solid var(--theme-border);
  padding: 3px 8px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: nowrap;
}

.toolbar-left {
  flex: 0 1 auto;
}

.toolbar-right {
  margin-left: auto;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--theme-base);
  cursor: pointer;
  border-radius: 4px;
  padding: 4px;
  margin: 0 0.5px;
  transition: background-color 0.15s ease;
  flex-shrink: 0;
  box-sizing: border-box;
  outline: none;
  position: relative;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--theme-bg-hover);
}

.toolbar-btn:active:not(:disabled) {
  background: var(--theme-bg-active);
}

.toolbar-btn:focus-visible {
  box-shadow: 0 0 0 2px var(--theme-primary);
}

.toolbar-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.toolbar-btn i {
  font-size: 18px;
  line-height: 1;
  display: block;
  user-select: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.toolbar-btn-with-text {
  min-width: auto;
  padding: 4px 8px;
  gap: 6px;
}

.toolbar-btn-with-text .btn-text {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  user-select: none;
  line-height: 1;
}

.icon-sidebar-left,
.icon-sidebar-right,
.icon-panel-bottom {
  width: 18px;
  height: 18px;
  display: block;
}

.icon-sidebar-left .panel,
.icon-sidebar-right .panel,
.icon-panel-bottom .panel {
  fill: transparent;
  stroke: currentColor;
  stroke-width: 2;
  opacity: 0.6;
}

.icon-sidebar-left.is-open .panel,
.icon-sidebar-right.is-open .panel,
.icon-panel-bottom.is-open .panel {
  fill: currentColor;
  stroke: none;
  opacity: 1;
}

.toolbar-separator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-border);
  margin: 0 6px;
  font-size: 16px;
  line-height: 1;
  opacity: 0.6;
  user-select: none;
}

/* Database Selector */
.toolbar-database-selector {
  display: inline-flex;
  align-items: center;
  margin: 0 4px;
}

/* .database-dropdown {
  min-width: 180px;
 /* height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  background: var(--theme-bg);
  color: var(--theme-base);
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease;
} */

.database-dropdown {
  width: 180px;
  max-width: 180px;
  height: 22px;
  padding: 0 0.5rem;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  background: var(--theme-bg);
  color: var(--theme-base);
  font-size: 12px;
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
  line-height: 22px;
}

.database-dropdown:hover {
  border-color: var(--theme-primary);
}

.database-dropdown:focus {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
}

/* Execute Button */
.toolbar-btn-execute {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--theme-base);
  cursor: pointer;
  border-radius: 4px;
  padding: 4px 8px;
  margin: 0 0.5px;
  transition: background-color 0.15s ease;
  flex-shrink: 0;
  box-sizing: border-box;
  outline: none;
  position: relative;
  gap: 6px;
}

.toolbar-btn-execute:hover:not(:disabled) {
  background: var(--theme-bg-hover);
}

.toolbar-btn-execute:active:not(:disabled) {
  background: var(--theme-bg-active);
}

.toolbar-btn-execute:focus-visible {
  box-shadow: 0 0 0 2px var(--theme-primary);
}

.toolbar-btn-execute:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.toolbar-btn-execute i {
  font-size: 18px;
  line-height: 1;
  display: block;
  user-select: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.toolbar-btn-execute .btn-label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  user-select: none;
  line-height: 1;
}

/* Theme Dropdown */
.theme-dropdown {
  position: relative;
}

.theme-btn {
  padding: 5px 8px !important;
  min-width: auto !important;
  gap: 2px;
}

.dropdown-arrow {
  font-size: 16px !important;
  margin-left: -2px;
}

.theme-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--theme-bg);
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 160px;
  z-index: 1000;
  overflow: hidden;
}

.theme-menu-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  gap: 8px;
}

.theme-menu-item:hover {
  background: var(--theme-bg-hover);
}

.theme-menu-item.active {
  background: var(--theme-bg-active);
}

.check-icon {
  font-size: 18px !important;
  width: 18px;
  flex-shrink: 0;
  color: var(--theme-primary);
}

.theme-icon {
  font-size: 18px !important;
  width: 18px;
  flex-shrink: 0;
  color: var(--theme-base);
  opacity: 0.7;
}

.theme-menu-item span {
  flex: 1;
  font-size: 14px;
  color: var(--theme-base);
}
</style>
