<template>
  <div class="inline-ai">
    <div class="inline-ai-box">
      <i class="material-icons wand">auto_fix_high</i>
      <input
        ref="input"
        v-model="text"
        class="inline-ai-input"
        type="text"
        :placeholder="animatedPlaceholder"
        :disabled="busy"
        autofocus
        @keydown.enter.prevent="handleEnter"
        @keydown.tab="handleTab"
        @keydown.down.prevent="navigateDropdown(1)"
        @keydown.up.prevent="navigateDropdown(-1)"
        @keydown.esc="closeDropdown"
        @input="onInput"
        @blur="closeDropdownDelayed"
      />
      <div class="inline-ai-controls">
        <label class="mode-toggle">
          <select v-model="aiMode" class="mode-select">
            <option value="developer">🔧 Developer</option>
            <option value="dba">🎓 DBA</option>
          </select>
        </label>
        <label class="run-toggle">
          <input type="checkbox" v-model="runAfterInsert" />
          <span>Run after insert</span>
        </label>
      </div>
      <span v-if="busy" class="spinner" aria-label="Thinking" />
      <button class="btn-link inline-action" @click.prevent="cancel" :disabled="busy">Cancel</button>
      <button class="btn inline-create" :disabled="!text.trim() || busy" @click.prevent="submit">Create</button>
    </div>
    
    <!-- Slash Commands / @ Mentions Dropdown -->
    <div v-if="showDropdown && dropdownItems.length > 0" class="autocomplete-dropdown">
      <div class="dropdown-header">{{ dropdownHeader }}</div>
      <template v-for="(item, index) in dropdownItems">
        <!-- Category header for slash commands -->
        <div
          v-if="item.isCategory"
          :key="'cat-' + index"
          class="dropdown-category"
        >
          {{ item.categoryName }}
        </div>
        <!-- Regular item -->
        <div
          v-else
          :key="index"
          class="dropdown-item"
          :class="{ active: selectedIndex === index }"
          @mousedown.prevent="selectItem(item)"
          @mouseenter="selectedIndex = index"
        >
          <i class="material-icons dropdown-icon">{{ item.icon }}</i>
          <div class="dropdown-content">
            <span class="dropdown-text">{{ item.text }}</span>
            <span v-if="item.description" class="dropdown-description">{{ item.description }}</span>
            <span v-if="item.category" class="dropdown-badge">{{ item.category }}</span>
          </div>
        </div>
      </template>
    </div>
    
  </div>
</template>

<script lang="ts">
// @ts-nocheck - Suppress false positive template type errors in Vue 2.7
import Vue from 'vue'
import { AppEvent } from '@/common/AppEvent'

interface StepPayload {
  id: string;
  status: 'none' | 'pending' | 'done';
}

export default Vue.extend({
  name: 'InlineAICommand',
  props: {
    placeholder: { type: String, default: 'Ask AI about this database…' }
  },
  computed: {
    hasProgress(): boolean {
      return this.steps && this.steps.some(s => s.status !== 'none')
    },
    animatedPlaceholder(): string {
      if (this.isPaused || this.text.length > 0) {
        return this.placeholder
      }
      return this.currentAnimatedText
    },
    dropdownHeader(): string {
      if (this.dropdownType === 'slash') return 'Commands'
      if (this.dropdownType === 'mention') return 'Database Objects'
      return ''
    },
    dropdownItems(): any[] {
      if (this.dropdownType === 'slash') {
        return this.getFilteredSlashCommands()
      } else if (this.dropdownType === 'mention') {
        return this.getFilteredMentions()
      }
      return []
    },
    database(): string {
      return (this.$store as any).state.database
    }
  },
  watch: {
    text(newValue: string) {
      // Stop animation when user starts typing
      if (newValue && newValue.length > 0) {
        this.isPaused = true
        if (this.typingTimer) {
          clearTimeout(this.typingTimer)
          this.typingTimer = null
        }
      }
    },
    busy(newValue: boolean) {
      // Re-focus input when no longer busy
      if (!newValue) {
        this.$nextTick(() => {
          const input = this.$refs.input as HTMLInputElement
          if (input && !input.disabled) {
            input.focus()
          }
        })
      }
    },
    database(newDatabase: string, oldDatabase: string) {
      // Reload database objects when database changes
      if (newDatabase && newDatabase !== oldDatabase) {
        console.log('[InlineAI] Database changed from', oldDatabase, 'to', newDatabase, '- reloading objects')
        this.databaseObjects = [] // Clear old objects
        // Objects will be reloaded on next @ trigger
      }
    }
  },
  data() {
    return {
      text: '',
      aiMode: 'developer', // 'developer' or 'dba'
      runAfterInsert: false,
      busy: false,
      showDropdown: false,
      dropdownType: null as 'slash' | 'mention' | null,
      selectedIndex: -1,
      dropdownTriggerPos: -1,
      hideTimeout: null as number | null,
      steps: [
        { id: 'db', text: 'Get Active Database', status: 'none' },
        { id: 'tables', text: 'Get Tables', status: 'none' },
        { id: 'columns', text: 'Get Columns', status: 'none' },
        { id: 'insert', text: 'Insert SQL', status: 'none' },
      ] as Array<{id:string;text:string;status:'none'|'pending'|'done'}>,
      // Slash commands - Categorized A-Z
      slashCommands: [
        // A - Analysis & Always On & Auditing
        { text: '/analyze-plan', description: 'Analyze execution plan', icon: 'analytics', category: 'Analysis' },
        { text: '/analyze-query', description: 'Analyze query performance', icon: 'search', category: 'Analysis' },
        { text: '/alwayson-health', description: 'Always On availability group health', icon: 'health_and_safety', category: 'Always On' },
        { text: '/alwayson-latency', description: 'Always On replication latency', icon: 'schedule', category: 'Always On' },
        { text: '/alwayson-failover', description: 'Always On failover history', icon: 'swap_horiz', category: 'Always On' },
        { text: '/audit', description: 'SQL Server Audit status', icon: 'policy', category: 'Auditing' },
        { text: '/autogrowth', description: 'Database autogrowth events', icon: 'trending_up', category: 'Files' },
        
        // B - Blocking & Backups
        { text: '/blocking', description: 'Check current blocking sessions', icon: 'block', category: 'Blocking' },
        { text: '/blocking-chains', description: 'Show blocking chains and head blockers', icon: 'account_tree', category: 'Blocking' },
        { text: '/blocking-history', description: 'View blocking history from Extended Events', icon: 'history', category: 'Blocking' },
        { text: '/backup-status', description: 'Check backup status for all databases', icon: 'backup', category: 'Backup' },
        { text: '/backup-history', description: 'View backup history', icon: 'restore', category: 'Backup' },
        
        // C - CPU & Connections & Columnstore & Config
        { text: '/cpu-usage', description: 'Check CPU usage by query', icon: 'speed', category: 'CPU' },
        { text: '/cpu-top', description: 'Top CPU consuming queries', icon: 'trending_up', category: 'CPU' },
        { text: '/columnstore', description: 'Columnstore index statistics', icon: 'view_column', category: 'Columnstore' },
        { text: '/columnstore-fragmentation', description: 'Columnstore fragmentation', icon: 'broken_image', category: 'Columnstore' },
        { text: '/config', description: 'Server configuration options', icon: 'settings', category: 'Configuration' },
        { text: '/config-changes', description: 'Recent configuration changes', icon: 'history', category: 'Configuration' },
        { text: '/connections', description: 'Show active connections', icon: 'cable', category: 'Connections' },
        { text: '/connections-by-db', description: 'Connections grouped by database', icon: 'storage', category: 'Connections' },
        
        // D - Deadlocks & DMVs (Expert Level)
        { text: '/deadlocks', description: 'Find recent deadlocks', icon: 'lock', category: 'Deadlocks' },
        { text: '/deadlock-graph', description: 'Show deadlock graph XML', icon: 'account_tree', category: 'Deadlocks' },
        { text: '/deadlock-victims', description: 'Deadlock victim history', icon: 'warning', category: 'Deadlocks' },
        { text: '/dmv-waits', description: 'Wait statistics (sys.dm_os_wait_stats)', icon: 'hourglass_empty', category: 'DMV' },
        { text: '/dmv-sessions', description: 'Active sessions (sys.dm_exec_sessions)', icon: 'people', category: 'DMV' },
        { text: '/dmv-requests', description: 'Active requests (sys.dm_exec_requests)', icon: 'pending_actions', category: 'DMV' },
        { text: '/dmv-connections', description: 'Connection details (sys.dm_exec_connections)', icon: 'cable', category: 'DMV' },
        { text: '/dmv-query-stats', description: 'Query execution stats (sys.dm_exec_query_stats)', icon: 'query_stats', category: 'DMV' },
        { text: '/dmv-plan-cache', description: 'Plan cache analysis (sys.dm_exec_cached_plans)', icon: 'memory', category: 'DMV' },
        { text: '/dmv-index-usage', description: 'Index usage stats (sys.dm_db_index_usage_stats)', icon: 'storage', category: 'DMV' },
        { text: '/dmv-index-physical', description: 'Index physical stats (sys.dm_db_index_physical_stats)', icon: 'broken_image', category: 'DMV' },
        { text: '/dmv-index-operational', description: 'Index operational stats (sys.dm_db_index_operational_stats)', icon: 'bar_chart', category: 'DMV' },
        { text: '/dmv-missing-indexes', description: 'Missing indexes (sys.dm_db_missing_index_*)', icon: 'add_box', category: 'DMV' },
        { text: '/dmv-io-virtual-file', description: 'I/O stats by file (sys.dm_io_virtual_file_stats)', icon: 'storage', category: 'DMV' },
        { text: '/dmv-os-schedulers', description: 'Scheduler stats (sys.dm_os_schedulers)', icon: 'schedule', category: 'DMV' },
        { text: '/dmv-os-memory-clerks', description: 'Memory clerks (sys.dm_os_memory_clerks)', icon: 'pie_chart', category: 'DMV' },
        { text: '/dmv-os-buffer-descriptors', description: 'Buffer pool usage (sys.dm_os_buffer_descriptors)', icon: 'memory', category: 'DMV' },
        { text: '/dmv-db-file-space', description: 'Database file space (sys.dm_db_file_space_usage)', icon: 'folder', category: 'DMV' },
        { text: '/dmv-db-log-space', description: 'Log space usage (sys.dm_db_log_space_usage)', icon: 'description', category: 'DMV' },
        { text: '/dmv-db-partition-stats', description: 'Partition stats (sys.dm_db_partition_stats)', icon: 'table_chart', category: 'DMV' },
        { text: '/dmv-tran-locks', description: 'Transaction locks (sys.dm_tran_locks)', icon: 'lock', category: 'DMV' },
        { text: '/dmv-tran-active', description: 'Active transactions (sys.dm_tran_active_transactions)', icon: 'pending', category: 'DMV' },
        { text: '/dmv-tran-session', description: 'Session transactions (sys.dm_tran_session_transactions)', icon: 'people', category: 'DMV' },
        { text: '/dmv-tran-database', description: 'Database transactions (sys.dm_tran_database_transactions)', icon: 'storage', category: 'DMV' },
        { text: '/dmv-resource-governor', description: 'Resource Governor stats (sys.dm_resource_governor_*)', icon: 'tune', category: 'DMV' },
        { text: '/dmv-clr', description: 'CLR stats (sys.dm_clr_*)', icon: 'code', category: 'DMV' },
        
        // E - Execution Plans & Errors & Extended Events & Encryption
        { text: '/encryption', description: 'TDE and encryption status', icon: 'lock', category: 'Encryption' },
        { text: '/errors', description: 'Check SQL Server error log', icon: 'error', category: 'Errors' },
        { text: '/execution-plans', description: 'Find cached execution plans', icon: 'map', category: 'Execution' },
        { text: '/expensive-queries', description: 'Most expensive queries', icon: 'attach_money', category: 'Execution' },
        { text: '/xevents', description: 'List Extended Event sessions', icon: 'event', category: 'Extended Events' },
        { text: '/xevents-blocking', description: 'Extended Events for blocking', icon: 'block', category: 'Extended Events' },
        { text: '/xevents-deadlocks', description: 'Extended Events for deadlocks', icon: 'lock', category: 'Extended Events' },
        { text: '/xevents-queries', description: 'Extended Events for query tracking', icon: 'query_stats', category: 'Extended Events' },
        
        // F - Fragmentation & Foreign Keys & Files & Filegroups
        { text: '/files', description: 'Database files and sizes', icon: 'insert_drive_file', category: 'Files' },
        { text: '/filegroups', description: 'Filegroup information', icon: 'folder_open', category: 'Files' },
        { text: '/foreign-keys', description: 'List all foreign keys', icon: 'link', category: 'Schema' },
        { text: '/foreign-keys-missing-indexes', description: 'Foreign keys without indexes', icon: 'link_off', category: 'Schema' },
        { text: '/fragmentation', description: 'Check index fragmentation', icon: 'broken_image', category: 'Fragmentation' },
        { text: '/fragmentation-top', description: 'Top fragmented indexes', icon: 'warning', category: 'Fragmentation' },
        
        // G - Growth & General
        { text: '/growth-history', description: 'Database growth history', icon: 'trending_up', category: 'Growth' },
        { text: '/growth-forecast', description: 'Forecast database growth', icon: 'show_chart', category: 'Growth' },
        
        // H - Health Checks
        { text: '/health-check', description: 'Run comprehensive health check', icon: 'health_and_safety', category: 'Health' },
        
        // I - Indexes & I/O & In-Memory
        { text: '/in-memory-oltp', description: 'In-Memory OLTP statistics', icon: 'memory', category: 'In-Memory' },
        { text: '/indexes', description: 'List all indexes', icon: 'storage', category: 'Indexes' },
        { text: '/indexes-missing', description: 'Find missing index recommendations', icon: 'add_box', category: 'Indexes' },
        { text: '/indexes-unused', description: 'Find unused indexes', icon: 'delete', category: 'Indexes' },
        { text: '/indexes-duplicate', description: 'Find duplicate indexes', icon: 'content_copy', category: 'Indexes' },
        { text: '/indexes-usage', description: 'Index usage statistics', icon: 'bar_chart', category: 'Indexes' },
        { text: '/io-stats', description: 'I/O statistics by file', icon: 'storage', category: 'I/O' },
        { text: '/io-stalls', description: 'I/O stall analysis', icon: 'hourglass_full', category: 'I/O' },
        
        // J - Jobs
        { text: '/jobs', description: 'List SQL Agent jobs', icon: 'work', category: 'Jobs' },
        { text: '/jobs-failed', description: 'Recently failed jobs', icon: 'error_outline', category: 'Jobs' },
        
        // K - Kill Sessions
        { text: '/kill-session', description: 'Generate KILL command for session', icon: 'close', category: 'Sessions' },
        
        // L - Locks & Logs & Linked Servers & Logins & Log Shipping
        { text: '/linked-servers', description: 'List linked servers', icon: 'link', category: 'Linked Servers' },
        { text: '/linked-server-test', description: 'Test linked server connections', icon: 'check_circle', category: 'Linked Servers' },
        { text: '/locks', description: 'Show current locks', icon: 'lock_open', category: 'Locks' },
        { text: '/locks-by-object', description: 'Locks grouped by object', icon: 'table_chart', category: 'Locks' },
        { text: '/log-shipping', description: 'Log shipping status', icon: 'local_shipping', category: 'High Availability' },
        { text: '/log-space', description: 'Transaction log space usage', icon: 'description', category: 'Logs' },
        { text: '/log-reuse', description: 'Log reuse wait description', icon: 'info', category: 'Logs' },
        { text: '/logins', description: 'Server logins and permissions', icon: 'person', category: 'Security' },
        
        // M - Memory & Maintenance & Mirroring
        { text: '/maintenance-plans', description: 'List maintenance plans', icon: 'build', category: 'Maintenance' },
        { text: '/memory-usage', description: 'Memory usage by database', icon: 'memory', category: 'Memory' },
        { text: '/memory-clerks', description: 'Memory usage by clerk type', icon: 'pie_chart', category: 'Memory' },
        { text: '/mirroring', description: 'Database mirroring status', icon: 'flip', category: 'High Availability' },
        
        // N - Notifications
        { text: '/notify', description: 'Set up performance notifications', icon: 'notifications', category: 'Notifications' },
        
        // O - Optimize & Ola Hallengren
        { text: '/optimize-query', description: 'Get query optimization suggestions', icon: 'tune', category: 'Optimization' },
        { text: '/ola-backup', description: 'Ola Hallengren: DatabaseBackup (Full/Diff/Log)', icon: 'backup', category: 'Ola Hallengren' },
        { text: '/ola-integrity', description: 'Ola Hallengren: DatabaseIntegrityCheck (CHECKDB)', icon: 'verified', category: 'Ola Hallengren' },
        { text: '/ola-index', description: 'Ola Hallengren: IndexOptimize (Rebuild/Reorganize)', icon: 'build_circle', category: 'Ola Hallengren' },
        { text: '/ola-stats', description: 'Ola Hallengren: Update Statistics', icon: 'analytics', category: 'Ola Hallengren' },
        { text: '/ola-cleanup', description: 'Ola Hallengren: CommandLog cleanup', icon: 'delete_sweep', category: 'Ola Hallengren' },
        
        // P - Performance & Parameters & Permissions
        { text: '/parallelism', description: 'Check parallelism waits (CXPACKET)', icon: 'call_split', category: 'Performance' },
        { text: '/parameter-sniffing', description: 'Detect parameter sniffing issues', icon: 'bug_report', category: 'Performance' },
        { text: '/performance-counters', description: 'SQL Server performance counters', icon: 'speed', category: 'Performance' },
        { text: '/permissions', description: 'User and role permissions', icon: 'admin_panel_settings', category: 'Security' },
        
        // Q - Query Store
        { text: '/query-store', description: 'Query Store top queries', icon: 'inventory', category: 'Query Store' },
        { text: '/query-store-regressed', description: 'Regressed queries', icon: 'trending_down', category: 'Query Store' },
        { text: '/query-store-forced', description: 'Forced plans', icon: 'push_pin', category: 'Query Store' },
        
        // R - Recompiles & Rewrite & Replication
        { text: '/recompiles', description: 'Find queries with excessive recompiles', icon: 'refresh', category: 'Recompiles' },
        { text: '/replication-status', description: 'Replication status', icon: 'sync', category: 'Replication' },
        { text: '/replication-latency', description: 'Replication latency', icon: 'schedule', category: 'Replication' },
        { text: '/replication-errors', description: 'Replication errors', icon: 'error', category: 'Replication' },
        { text: '/rewrite', description: 'Rewrite query for better performance', icon: 'autorenew', category: 'Optimization' },
        
        // S - Statistics & sp_Blitz Suite & sp_WhoIsActive & Service Broker & Snapshots & Server Properties
        { text: '/server-properties', description: 'SQL Server properties', icon: 'info', category: 'Configuration' },
        { text: '/service-broker', description: 'Service Broker queue status', icon: 'message', category: 'Service Broker' },
        { text: '/service-broker-errors', description: 'Service Broker errors', icon: 'error', category: 'Service Broker' },
        { text: '/snapshots', description: 'List database snapshots', icon: 'photo_camera', category: 'Snapshots' },
        { text: '/snapshot-create', description: 'Create database snapshot', icon: 'add_a_photo', category: 'Snapshots' },
        { text: '/space-usage', description: 'Database space usage', icon: 'pie_chart', category: 'Space' },
        { text: '/sp-blitz', description: 'Run sp_Blitz health check', icon: 'health_and_safety', category: 'sp_Blitz' },
        { text: '/sp-blitzfirst', description: 'Run sp_BlitzFirst (current perf)', icon: 'speed', category: 'sp_Blitz' },
        { text: '/sp-blitzindex', description: 'Run sp_BlitzIndex', icon: 'storage', category: 'sp_Blitz' },
        { text: '/sp-blitzcache', description: 'Run sp_BlitzCache', icon: 'memory', category: 'sp_Blitz' },
        { text: '/sp-blitzlock', description: 'Run sp_BlitzLock', icon: 'lock', category: 'sp_Blitz' },
        { text: '/sp-blitzwho', description: 'Run sp_BlitzWho (active sessions)', icon: 'people', category: 'sp_Blitz' },
        { text: '/sp-whoisactive', description: "sp_WhoIsActive: What's happening now", icon: 'visibility', category: 'sp_WhoIsActive' },
        { text: '/sp-whoisactive-delta', description: 'sp_WhoIsActive: Delta analysis (5 sec interval)', icon: 'timeline', category: 'sp_WhoIsActive' },
        { text: '/sp-whoisactive-tran', description: 'sp_WhoIsActive: Transaction log usage', icon: 'description', category: 'sp_WhoIsActive' },
        { text: '/sp-whoisactive-memory', description: 'sp_WhoIsActive: Memory usage', icon: 'memory', category: 'sp_WhoIsActive' },
        { text: '/sp-whoisactive-tempdb', description: 'sp_WhoIsActive: Tempdb usage', icon: 'folder_open', category: 'sp_WhoIsActive' },
        { text: '/sp-whoisactive-blocking', description: 'sp_WhoIsActive: Blocking analysis', icon: 'block', category: 'sp_WhoIsActive' },
        { text: '/sp-whoisactive-plans', description: 'sp_WhoIsActive: With execution plans', icon: 'map', category: 'sp_WhoIsActive' },
        { text: '/statistics', description: 'Check statistics freshness', icon: 'analytics', category: 'Statistics' },
        { text: '/statistics-outdated', description: 'Find outdated statistics', icon: 'schedule', category: 'Statistics' },
        
        // T - Tables & Tempdb & Trace Flags
        { text: '/tables', description: 'List all tables with row counts', icon: 'table_view', category: 'Tables' },
        { text: '/table-sizes', description: 'Table sizes and row counts', icon: 'table_chart', category: 'Tables' },
        { text: '/table-scans', description: 'Find queries doing table scans', icon: 'search', category: 'Tables' },
        { text: '/tempdb-usage', description: 'Tempdb space usage', icon: 'folder_open', category: 'Tempdb' },
        { text: '/tempdb-contention', description: 'Tempdb contention (PFS/SGAM)', icon: 'warning', category: 'Tempdb' },
        { text: '/trace-flags', description: 'Active trace flags', icon: 'flag', category: 'Trace Flags' },
        
        // U - Updates
        { text: '/update-stats', description: 'Generate UPDATE STATISTICS commands', icon: 'update', category: 'Maintenance' },
        
        // V - VLFs & Version Store
        { text: '/vlfs', description: 'Virtual Log File (VLF) count', icon: 'description', category: 'Logs' },
        { text: '/version-store', description: 'Version store usage (tempdb)', icon: 'history', category: 'Tempdb' },
        
        // W - Waits
        { text: '/waits', description: 'Wait statistics summary', icon: 'hourglass_empty', category: 'Waits' },
        { text: '/waits-by-query', description: 'Waits by query', icon: 'pending', category: 'Waits' },
        { text: '/waits-top', description: 'Top wait types', icon: 'priority_high', category: 'Waits' },
        
        // X - XML Plans
        { text: '/xml-plans', description: 'Extract XML execution plans', icon: 'code', category: 'Execution' },
      ],
      // Database objects (will be populated dynamically)
      databaseObjects: [] as Array<{text:string;type:string;schema:string;icon:string}>,
      // Track selected objects with their metadata for CREATE statement fetching
      selectedObjects: [] as Array<{name:string;schema:string;type:string}>,
      // Auto-typing animation
      examplePrompts: [
        'Type / for commands…',
        'Type @ to mention objects…',
        '/fix-index for index analysis…',
        '/blocking to check deadlocks…',
        '/sp-blitz for health check…',
        '@TableName to scope changes…',
      ],
      currentPromptIndex: 0,
      currentCharIndex: 0,
      currentAnimatedText: '',
      typingTimer: null as number | null,
      isPaused: false,
      isInitialMount: true,
    }
  },
  mounted() {
    this.$root.$on(AppEvent.aiInlineDone, this.stopBusy)
    this.$root.$on(AppEvent.aiInlineStep, this.onStep)
    
    // Listen for database changes to reload objects
    this.$root.$on('database-changed', this.handleDatabaseChange)
    
    // Start typing animation first
    this.startTypingAnimation()
    
    // Then focus after a brief delay to let animation start
    const input = this.$refs.input as HTMLInputElement
    if (input) {
      setTimeout(() => {
        input.focus()
        // Mark initial mount as complete after focus
        setTimeout(() => {
          this.isInitialMount = false
        }, 100)
      }, 50)
    }
  },
  beforeDestroy() {
    this.$root.$off(AppEvent.aiInlineDone, this.stopBusy)
    this.$root.$off(AppEvent.aiInlineStep, this.onStep)
    this.$root.$off('database-changed', this.handleDatabaseChange)
    
    // Clear typing animation timer
    if (this.typingTimer) {
      clearTimeout(this.typingTimer)
      this.typingTimer = null
    }
  },
  methods: {
    handleTab(e: KeyboardEvent) {
      if (this.showDropdown && this.selectedIndex >= 0 && this.dropdownItems[this.selectedIndex]) {
        const item = this.dropdownItems[this.selectedIndex]
        if (item && !item.isCategory) {
          e.preventDefault()
          this.selectItem(item)
        }
      }
    },
    cancel() {
      this.closeDropdown()
      this.$root.$emit(AppEvent.toggleInlineAI)
    },
    submit() {
      const value = this.text.trim()
      if (!value) return
      this.busy = true
      
      // Parse slash commands and @ mentions BEFORE clearing text
      const parsedPrompt = this.parsePrompt(value)
      
      // Store selected objects before clearing
      const mentionedObjects = [...this.selectedObjects]
      
      // Now clear everything
      this.text = ''
      this.selectedObjects = []
      this.closeDropdown()
      this.resetSteps()
      
      this.$root.$emit(AppEvent.aiInlinePrompt, { 
        prompt: parsedPrompt.text,
        command: parsedPrompt.command,
        mentions: parsedPrompt.mentions,
        mentionedObjects: mentionedObjects, // Pass object metadata for CREATE statement fetching
        runAfterInsert: this.runAfterInsert,
        aiMode: this.aiMode
      })
    },
    handleEnter() {
      if (this.showDropdown && this.selectedIndex >= 0 && this.dropdownItems[this.selectedIndex]) {
        this.selectItem(this.dropdownItems[this.selectedIndex])
      } else {
        this.submit()
      }
    },
    parsePrompt(text: string) {
      // Extract slash command (first word starting with /)
      const commandMatch = text.match(/^\/([a-z-]+)/)
      const command = commandMatch ? commandMatch[1] : null
      
      // Extract @ mentions
      const mentionMatches = text.matchAll(/@([a-zA-Z0-9_\[\]\.]+)/g)
      const mentions = Array.from(mentionMatches).map(m => m[1])
      
      return { text, command, mentions }
    },
    stopBusy() {
      this.busy = false
      // Keep steps visible for 2 seconds before resetting
      setTimeout(() => {
        this.resetSteps()
      }, 2000)
      this.$nextTick(() => {
        (this.$refs.input as HTMLInputElement)?.focus()
      })
    },
    onStep(payload: StepPayload) {
      const { id, status } = payload
      if (!id || !status) return
      const idx = this.steps.findIndex(s => s.id === id)
      if (idx >= 0) this.$set(this.steps[idx], 'status', status)
    },
    resetSteps() {
      this.steps.forEach((s, i) => this.$set(this.steps[i], 'status', 'none'))
    },
    
    // Auto-typing animation methods
    startTypingAnimation() {
      if (this.isPaused) return
      
      const currentPrompt = this.examplePrompts[this.currentPromptIndex]
      
      // Typing phase
      if (this.currentCharIndex < currentPrompt.length) {
        this.currentAnimatedText = currentPrompt.substring(0, this.currentCharIndex + 1)
        this.currentCharIndex++
        this.typingTimer = setTimeout(() => this.startTypingAnimation(), 80) // Type speed
      } 
      // Pause at end
      else if (this.currentCharIndex === currentPrompt.length) {
        this.currentCharIndex++
        this.typingTimer = setTimeout(() => this.startTypingAnimation(), 2000) // Pause duration
      }
      // Erasing phase
      else if (this.currentAnimatedText.length > 0) {
        this.currentAnimatedText = this.currentAnimatedText.substring(0, this.currentAnimatedText.length - 1)
        this.typingTimer = setTimeout(() => this.startTypingAnimation(), 40) // Erase speed
      }
      // Move to next prompt
      else {
        this.currentPromptIndex = (this.currentPromptIndex + 1) % this.examplePrompts.length
        this.currentCharIndex = 0
        this.typingTimer = setTimeout(() => this.startTypingAnimation(), 500) // Pause before next
      }
    },
    
    onInput() {
      // Stop animation when user types
      if (this.text.length > 0) {
        this.isPaused = true
        if (this.typingTimer) {
          clearTimeout(this.typingTimer)
          this.typingTimer = null
        }
      } else {
        // Resume animation when input is cleared
        this.isPaused = false
        this.startTypingAnimation()
      }
      
      // Auto-switch mode based on input type
      if (this.text.startsWith('/')) {
        // Slash command -> DBA mode
        if (this.aiMode !== 'dba') {
          this.aiMode = 'dba'
        }
      } else if (this.text.includes('@')) {
        // @ mention -> Developer mode
        if (this.aiMode !== 'developer') {
          this.aiMode = 'developer'
        }
      }
      
      // Check for slash commands or @ mentions
      this.checkForTriggers()
    },
    checkForTriggers() {
      const input = this.$refs.input as HTMLInputElement
      if (!input) return
      
      const cursorPos = input.selectionStart || 0
      const textBeforeCursor = this.text.substring(0, cursorPos)
      
      // Check for slash command at start
      if (textBeforeCursor.match(/^\/[a-z-]*$/)) {
        this.dropdownType = 'slash'
        this.dropdownTriggerPos = 0
        this.showDropdown = true
        this.selectedIndex = 0
        return
      }
      
      // Check for @ mention
      const mentionMatch = textBeforeCursor.match(/@([a-zA-Z0-9_\[\]\.]*?)$/)
      if (mentionMatch) {
        this.dropdownType = 'mention'
        this.dropdownTriggerPos = mentionMatch.index || 0
        this.showDropdown = true
        this.selectedIndex = 0
        // Load database objects if not loaded
        if (this.databaseObjects.length === 0) {
          this.loadDatabaseObjects()
        }
        return
      }
      
      // Close dropdown if no trigger
      this.closeDropdown()
    },
    getFilteredSlashCommands() {
      const input = this.$refs.input as HTMLInputElement
      if (!input) return this.slashCommands.slice(0, 20)
      
      const cursorPos = input.selectionStart || 0
      const textBeforeCursor = this.text.substring(0, cursorPos)
      const match = textBeforeCursor.match(/^\/([a-z-]*)$/)
      
      if (!match) return this.slashCommands.slice(0, 20)
      
      const query = match[1].toLowerCase()
      if (!query) return this.slashCommands.slice(0, 20)
      
      // Filter commands by text, description, or category
      const filtered = this.slashCommands.filter(cmd => 
        cmd.text.toLowerCase().includes(query) || 
        cmd.description.toLowerCase().includes(query) ||
        cmd.category.toLowerCase().includes(query)
      )
      
      // Group by category and add category headers
      const grouped: any[] = []
      const categories = new Set<string>()
      
      filtered.forEach(cmd => {
        if (!categories.has(cmd.category)) {
          categories.add(cmd.category)
          // Add category header
          grouped.push({
            isCategory: true,
            categoryName: cmd.category
          })
        }
        grouped.push(cmd)
      })
      
      return grouped.slice(0, 30) // Limit to 30 items
    },
    getFilteredMentions() {
      const input = this.$refs.input as HTMLInputElement
      if (!input) return this.databaseObjects
      
      const cursorPos = input.selectionStart || 0
      const textBeforeCursor = this.text.substring(0, cursorPos)
      const match = textBeforeCursor.match(/@([a-zA-Z0-9_\[\]\.]*?)$/)
      
      if (!match) return this.databaseObjects
      
      const query = match[1].toLowerCase()
      if (!query) return this.databaseObjects.slice(0, 20) // Show first 20
      
      return this.databaseObjects.filter(obj => 
        obj.text.toLowerCase().includes(query) ||
        obj.schema.toLowerCase().includes(query)
      ).slice(0, 20)
    },
    selectItem(item: any) {
      const input = this.$refs.input as HTMLInputElement
      if (!input) return
      
      const cursorPos = input.selectionStart || 0
      const textBefore = this.text.substring(0, this.dropdownTriggerPos)
      const textAfter = this.text.substring(cursorPos)
      
      if (this.dropdownType === 'slash') {
        // Replace /command with selected command + space
        this.text = item.text + ' ' + textAfter
        this.$nextTick(() => {
          input.setSelectionRange(item.text.length + 1, item.text.length + 1)
        })
      } else if (this.dropdownType === 'mention') {
        // Replace @partial with @FullObjectName + space
        this.text = textBefore + '@' + item.text + ' ' + textAfter
        const newPos = textBefore.length + item.text.length + 2
        this.$nextTick(() => {
          input.setSelectionRange(newPos, newPos)
        })
        
        // Store selected object metadata for CREATE statement fetching
        const [schema, name] = item.text.includes('.') ? item.text.split('.') : [item.schema, item.text]
        this.selectedObjects.push({
          name: name || item.text,
          schema: schema || item.schema || 'dbo',
          type: item.type
        })
      }
      
      this.closeDropdown()
      input.focus()
    },
    navigateDropdown(direction: number) {
      if (!this.showDropdown || this.dropdownItems.length === 0) return
      
      let newIndex = this.selectedIndex + direction
      
      // Skip category headers (items with isCategory = true)
      while (newIndex >= 0 && newIndex < this.dropdownItems.length) {
        if (!this.dropdownItems[newIndex].isCategory) {
          this.selectedIndex = newIndex
          this.scrollMenuToActiveItem()
          return
        }
        newIndex += direction
      }
      
      // Wrap around
      if (newIndex < 0) {
        // Find last non-category item
        for (let i = this.dropdownItems.length - 1; i >= 0; i--) {
          if (!this.dropdownItems[i].isCategory) {
            this.selectedIndex = i
            this.scrollMenuToActiveItem()
            return
          }
        }
      } else {
        // Find first non-category item
        for (let i = 0; i < this.dropdownItems.length; i++) {
          if (!this.dropdownItems[i].isCategory) {
            this.selectedIndex = i
            this.scrollMenuToActiveItem()
            return
          }
        }
      }
    },
    scrollMenuToActiveItem() {
      // Use nextTick to ensure DOM is updated after selectedIndex changes
      this.$nextTick(() => {
        const menu = document.querySelector('.autocomplete-dropdown');
        const activeItem = document.querySelector('.dropdown-item.active');
        if (menu && activeItem) {
          const menuRect = menu.getBoundingClientRect();
          const itemRect = activeItem.getBoundingClientRect();
          
          // Check if item is below visible area
          if (itemRect.bottom > menuRect.bottom) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          // Check if item is above visible area
          else if (itemRect.top < menuRect.top) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      });
    },
    closeDropdown() {
      this.showDropdown = false
      this.dropdownType = null
      this.selectedIndex = -1
      this.dropdownTriggerPos = -1
      if (this.hideTimeout) {
        clearTimeout(this.hideTimeout)
        this.hideTimeout = null
      }
    },
    closeDropdownDelayed() {
      this.hideTimeout = setTimeout(() => {
        this.closeDropdown()
      }, 200) as any
    },
    async loadDatabaseObjects() {
      try {
        console.log('[InlineAI] Requesting database objects...')
        
        // Emit event to request database objects from parent
        this.$root.$emit(AppEvent.requestDatabaseObjects)
        
        // Listen for response
        const handler = (objects: any[]) => {
          console.log('[InlineAI] Received database objects:', objects.length)
          this.databaseObjects = objects.map(obj => ({
            text: obj.schema ? `${obj.schema}.${obj.name}` : obj.name,
            type: obj.type,
            schema: obj.schema || 'dbo',
            icon: this.getObjectIcon(obj.type)
          }))
          console.log('[InlineAI] Mapped database objects:', this.databaseObjects.length)
          this.$root.$off(AppEvent.databaseObjectsLoaded, handler)
        }
        this.$root.$on(AppEvent.databaseObjectsLoaded, handler)
      } catch (e) {
        console.error('[InlineAI] Failed to load database objects:', e)
      }
    },
    getObjectIcon(type: string): string {
      const icons: Record<string, string> = {
        'table': 'table_chart',
        'view': 'visibility',
        'procedure': 'code',
        'function': 'functions',
        'index': 'storage',
        'trigger': 'bolt',
        'constraint': 'link',
        'foreignkey': 'link',
        'primarykey': 'vpn_key',
        'unique': 'fingerprint',
        'check': 'check_circle',
        'default': 'settings',
        'schema': 'folder',
        'type': 'data_object',
        'synonym': 'shortcut',
        'sequence': 'format_list_numbered',
      }
      return icons[type.toLowerCase()] || 'description'
    },
    handleDatabaseChange() {
      // Clear cached objects when database changes
      console.log('[InlineAI] Database change event received - clearing cached objects')
      this.databaseObjects = []
    }
  }
})
</script>

<style scoped>
.inline-ai {
  padding: 8px 12px 10px;
  background: var(--theme-bg);
  border-top: 1px solid var(--theme-border);
  border-bottom: 1px solid var(--theme-border);
  margin: 2px 0 6px;
  position: relative;
}
.inline-ai-box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--query-editor-bg);
  border: 1px solid var(--theme-border);
  border-radius: 16px;
  padding: 8px 10px 8px 12px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.12);
}
.wand { font-size: 18px; color: var(--theme-muted); }
.inline-ai-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--theme-base);
  min-height: 18px;
}
.inline-ai-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.inline-ai-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mode-toggle {
  display: flex;
  align-items: center;
}
.mode-select {
  background: var(--theme-bg);
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--theme-base);
  cursor: pointer;
  outline: none;
}
.mode-select:hover {
  background: var(--theme-bg-alt);
}
.run-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--theme-muted); }
.spinner { width: 16px; height: 16px; border: 2px solid var(--theme-border); border-top-color: var(--theme-base); border-radius: 50%; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.inline-action { color: var(--theme-muted); }
.inline-create { background: var(--theme-bg-hover); color: var(--theme-base); border: 1px solid var(--theme-border); border-radius: 12px; padding: 4px 10px; }
.inline-create:disabled { opacity: .5; cursor: not-allowed; }
.inline-steps { display: flex; gap: 14px; padding: 6px 14px 0 34px; color: var(--theme-muted); font-size: 12px; }
.inline-steps .step { display: inline-flex; align-items: center; gap: 6px; opacity: .7; }
.inline-steps .step.pending { opacity: 1; color: var(--theme-base); }
.inline-steps .step.done { opacity: 1; color: var(--theme-success, #22c55e); }
.step-icon { font-size: 14px; }
.step-icon.spin { animation: spin 0.9s linear infinite; }
.step-icon.muted { opacity: .4; }

/* Autocomplete Dropdown */
.autocomplete-dropdown {
  position: absolute;
  top: 100%;
  left: 12px;
  right: 12px;
  margin-top: 4px;
  background: var(--query-editor-bg);
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  max-height: 400px;
  overflow-y: auto;
  z-index: 1000;
}
.dropdown-header {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--theme-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--theme-border);
  background: var(--theme-bg);
  position: sticky;
  top: 0;
  z-index: 10;
}
.dropdown-category {
  padding: 6px 12px 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--theme-muted);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  background: var(--theme-bg-alt, rgba(0,0,0,0.02));
  border-top: 1px solid var(--theme-border-subtle, rgba(0,0,0,0.05));
  margin-top: 4px;
}
.dropdown-category:first-of-type {
  margin-top: 0;
  border-top: none;
}
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s ease;
  border-bottom: 1px solid var(--theme-border-subtle, rgba(0,0,0,0.05));
}
.dropdown-item:last-child {
  border-bottom: none;
}
.dropdown-item:hover {
  background: var(--theme-bg-hover);
}
.dropdown-item.active {
  background: rgba(251, 191, 36, 0.15); /* Yellow/gold highlight */
  border-left: 3px solid #fbbf24; /* Yellow left border */
  padding-left: 9px; /* Adjust padding for border */
}
.dropdown-icon {
  font-size: 18px;
  color: var(--theme-muted);
  flex-shrink: 0;
}
.dropdown-item.active .dropdown-icon {
  color: #fbbf24; /* Yellow icon */
}
.dropdown-item.active .dropdown-text {
  color: var(--theme-base);
  font-weight: 600;
}
.dropdown-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dropdown-text {
  font-size: 13px;
  color: var(--theme-base);
  font-weight: 500;
}
.dropdown-description {
  font-size: 11px;
  color: var(--theme-muted);
}
.dropdown-badge {
  display: inline-block;
  padding: 2px 6px;
  margin-top: 4px;
  font-size: 9px;
  font-weight: 600;
  color: var(--theme-muted);
  background: var(--theme-bg-alt, rgba(0,0,0,0.05));
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
