<template>
  <div class="object-explorer">
    <!-- Connection Header -->
    <div class="explorer-header">
      <div class="connection-info">
        <i class="material-icons connection-icon">storage</i>
        <div class="connection-details">
          <div class="connection-name">{{ connectionName }}</div>
          <div class="connection-server">{{ serverInfo }}</div>
        </div>
      </div>
      <div class="header-actions">
        <button @click="showAddDatabase" title="Add Database" class="icon-btn">
          <i class="material-icons">add</i>
        </button>
        <button @click="refreshAll" title="Refresh" class="icon-btn">
          <i class="material-icons">refresh</i>
        </button>
        <button @click="disconnect" title="Disconnect" class="icon-btn">
          <i class="material-icons">power_settings_new</i>
        </button>
      </div>
    </div>

    <div class="fixed">
      <div class="filter">
        <div class="filter-wrap">
          <input
            class="filter-input"
            type="text"
            placeholder="Filter"
            v-model="filterQuery"
          >
          <x-buttons class="filter-actions">
            <x-button
              @click="clearFilter"
              v-if="filterQuery"
            >
              <i class="clear material-icons">cancel</i>
            </x-button>
            <x-button
              :title="entitiesHidden ? 'Filter active' : 'No filters'"
              class="btn btn-fab btn-link action-item"
              :class="{active: entitiesHidden}"
              menu
            >
              <i class="material-icons-outlined">filter_alt</i>
              <x-menu style="--target-align: right;">
                <label>
                  <input
                    type="checkbox"
                    v-model="showTables"
                  >
                  <span>Tables</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    v-model="showViews"
                  >
                  <span>Views</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    v-model="showProcedures"
                  >
                  <span>Procedures</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    v-model="showFunctions"
                  >
                  <span>Functions</span>
                </label>
                <x-menuitem />
              </x-menu>
            </x-button>
          </x-buttons>
        </div>
      </div>
    </div>

    <!-- Tree Structure -->
    <div class="explorer-tree">
      <tree-node
        v-for="node in filteredRootNodes"
        :key="node.id"
        :node="node"
        :level="0"
        @toggle="toggleNode"
        @select="selectNode"
        @contextmenu="showContextMenu"
      />
    </div>

    <!-- Context Menu -->
    <object-explorer-context-menu
      :visible="contextMenuVisible"
      :position="contextMenuPosition"
      :node="contextMenuNode"
      @action="handleContextMenuAction"
      @close="closeContextMenu"
    />

    <portal to="modals">
      <modal
        class="vue-dialog sqlmind-modal save-add-database"
        name="object-explorer-add-database"
        height="auto"
        :scrollable="true"
      >
        <div
          v-if="this.connectionType === 'oracle'"
          class="dialog-content"
          v-kbd-trap="true"
        >
          <p>
            Oracle has a lot of <a
              class="external-link"
              href="https://docs.oracle.com/cd/B19306_01/server.102/b14231/create.htm#i1008760"
            >configuration requirements to create a new database</a> which makes it difficult for SQLMind to do automatically.
          </p>
          <p>SQLMind can generate you some boilerplate code to get you started if you like.</p>
          <div class="vue-dialog-buttons">
            <button
              class="btn btn-flat"
              type="button"
              @click.prevent="$modal.hide('object-explorer-add-database')"
            >
              Cancel
            </button>
            <button
              class="btn btn-primary"
              type="button"
              @click.prevent="createDatabaseSQL"
            >
              Generate Create Database Boilerplate
            </button>
          </div>
        </div>
        <div
          v-else
          class="dialog-content"
          v-kbd-trap="true"
        >
          <add-database-form
            @databaseCreated="databaseCreated"
            @cancel="$modal.hide('object-explorer-add-database')"
          />
        </div>
      </modal>
    </portal>
  </div>
</template>

<script>
import { mapState, mapGetters, mapActions } from 'vuex'
import TreeNode from './core/TreeNode.vue'
import ObjectExplorerContextMenu from './ObjectExplorerContextMenu.vue'
import { AppEvent } from '@/common/AppEvent'
import rawLog from '@bksLogger'
import AddDatabaseForm from "@/components/connection/AddDatabaseForm.vue"

const log = rawLog.scope('object-explorer')

export default {
  name: 'ObjectExplorer',
  components: { TreeNode, ObjectExplorerContextMenu, AddDatabaseForm },
  data() {
    return {
      expandedNodes: new Set(),
      selectedNode: null,
      rootNodes: [],
      showProcedures: true,
      showFunctions: true,
      contextMenuVisible: false,
      contextMenuPosition: { x: 0, y: 0 },
      contextMenuNode: null,
      tableColumnsCache: {}, // Store loaded columns by table name
      tableKeysCache: {}, // Store loaded keys by table name
      tableIndexesCache: {}, // Store loaded indexes by table name
      expandedTables: new Set(), // Track which tables are expanded
      databaseStates: {} // Store database states (ONLINE, OFFLINE, etc.)
    }
  },
  computed: {
    ...mapState(['connection', 'database', 'databaseList', 'tables', 'routines', 'connectionType']),
    ...mapGetters(['isUltimate', 'dialect', 'dialectData']),
    filteredRootNodes() {
      const q = (this.filterQuery || '').toLowerCase().trim()
      if (!q) return this.rootNodes
      return this.filterTreeNodes(this.rootNodes, q)
    },
    filterQuery: {
      get() {
        return this.$store.state.entityFilter.filterQuery
      },
      set(newFilter) {
        this.$store.dispatch('setFilterQuery', newFilter)
      }
    },
    showTables: {
      get() {
        return this.$store.state.entityFilter.showTables
      },
      set() {
        this.$store.commit('showTables')
      }
    },
    showViews: {
      get() {
        return this.$store.state.entityFilter.showViews
      },
      set() {
        this.$store.commit('showViews')
      }
    },
    showRoutines: {
      get() {
        return this.$store.state.entityFilter.showRoutines
      },
      set() {
        this.$store.commit('showRoutines')
      }
    },
    entitiesHidden() {
      return !this.showTables || !this.showViews || !this.showProcedures || !this.showFunctions
    },
    connectionName() {
      return this.connection?.name || 'SQL Server'
    },
    serverInfo() {
      if (!this.connection) return ''
      const host = this.connection.host || 'localhost'
      const port = this.connection.port ? `:${this.connection.port}` : ''
      return `${host}${port}`
    }
  },
  watch: {
    databaseList: {
      async handler() {
        await this.fetchDatabaseStates()
        this.buildTree()
      },
      immediate: true
    },
    database: {
      handler() {
        // Avoid showing stale cached Columns/Keys/Indexes when switching databases
        this.tableColumnsCache = {}
        this.tableKeysCache = {}
        this.tableIndexesCache = {}
        this.expandedTables = new Set()
        this.buildTree()
      }
    },
    tables() {
      this.updateTablesInTree()
    },
    routines() {
      this.updateRoutinesInTree()
    }
  },
  async mounted() {
    await this.fetchDatabaseStates()
    this.buildTree()
  },
  methods: {
    ...mapActions({ updateDatabaseList: 'updateDatabaseList' }),
    clearFilter() {
      this.filterQuery = null
    },
    filterTreeNodes(nodes, q) {
      const out = []
      for (const node of nodes || []) {
        const label = (node.label || '').toLowerCase()
        const children = node.children ? this.filterTreeNodes(node.children, q) : []
        if (label.includes(q) || children.length > 0) {
          out.push({ ...node, children })
        }
      }
      return out
    },
    showAddDatabase() {
      this.$modal.show('object-explorer-add-database')
    },
    async refreshDatabases() {
      await this.updateDatabaseList()
      this.buildTree()
    },
    async databaseCreated(db) {
      this.$modal.hide('object-explorer-add-database')
      if (this.dialectData?.disabledFeatures?.multipleDatabases) {
        const current = (typeof this.database === 'string' ? this.database : '')
        const fileLocation = current.split('/')
        fileLocation.pop()
        const url = this.connectionType === 'sqlite' ? `${fileLocation.join('/')}/${db}.db` : `${fileLocation.join('/')}/${db}`
        return window.main.send(AppEvent.menuClick, 'newWindow', { url })
      }
      await this.refreshDatabases()
      await this.$store.dispatch('changeDatabase', db)
      this.buildTree()
    },
    createDatabaseSQL() {
      this.$root.$emit(AppEvent.newTab, this.connection.createDatabaseSQL())
      this.$modal.hide('object-explorer-add-database')
    },
    buildTree() {
      const { systemDatabases, userDatabases } = this.separateDatabases()
      
      // Preserve expanded state of system databases folder
      const oldSystemDbFolder = this.findNode(this.rootNodes, 'system-databases')
      const systemDbFolderExpanded = oldSystemDbFolder ? oldSystemDbFolder.expanded : false
      
      // Root level: Databases folder with System and User subfolders
      this.rootNodes = [
        {
          id: 'databases',
          label: 'Databases',
          icon: 'folder',
          type: 'folder',
          expanded: true,
          children: [
            {
              id: 'system-databases',
              label: 'System Databases',
              icon: 'folder',
              type: 'system-databases-folder',
              expanded: systemDbFolderExpanded,
              children: systemDatabases
            },
            ...userDatabases
          ]
        },
        {
          id: 'security',
          label: 'Security',
          icon: 'security',
          type: 'folder',
          expanded: false,
          children: []
        },
        {
          id: 'server-objects',
          label: 'Server Objects',
          icon: 'dns',
          type: 'folder',
          expanded: false,
          children: []
        }
      ]
    },
    separateDatabases() {
      if (!this.databaseList || this.databaseList.length === 0) {
        return { systemDatabases: [], userDatabases: [] }
      }

      const systemDbNames = ['master', 'model', 'msdb', 'tempdb']
      const systemDatabases = []
      const userDatabases = []

      this.databaseList.forEach(dbName => {
        const dbState = this.databaseStates[dbName]
        const isOffline = dbState && dbState !== 'ONLINE'
        const displayName = isOffline ? `${dbName} (${dbState})` : dbName
        
        const dbNode = {
          id: `db-${dbName}`,
          label: displayName,
          icon: isOffline ? 'cancel' : 'storage',
          type: 'database',
          expanded: dbName === this.database,
          dbName: dbName,
          isOffline: isOffline,
          children: this.buildDatabaseChildren(dbName)
        }

        if (systemDbNames.includes(dbName.toLowerCase())) {
          systemDatabases.push(dbNode)
        } else {
          userDatabases.push(dbNode)
        }
      })

      return { systemDatabases, userDatabases }
    },
    async fetchDatabaseStates() {
      try {
        // Only supported for SQL Server at the moment
        if (this.connectionType !== 'sqlserver') {
          this.databaseStates = {}
          return
        }
        if (!this.connection || typeof this.connection.executeQuery !== 'function') {
          this.databaseStates = {}
          return
        }
        const result = await this.connection.executeQuery('SELECT name, state_desc FROM sys.databases')
        const rows = result && result[0] && Array.isArray(result[0].rows) ? result[0].rows : []
        const next = {}
        rows.forEach((r) => {
          const name = r?.name
          const state = r?.state_desc
          if (typeof name === 'string' && typeof state === 'string') {
            next[name] = state
          }
        })
        this.databaseStates = next
      } catch (e) {
        console.warn('[ObjectExplorer] Failed to load database states:', e)
        this.databaseStates = {}
      }
    },
    buildDatabaseChildren(dbName) {
      const isCurrentDb = dbName === this.database

      const children = []
      if (this.showTables) {
        children.push({
          id: `${dbName}-tables`,
          label: 'Tables',
          icon: 'table_chart',
          type: 'tables-folder',
          expanded: false,
          dbName: dbName,
          children: isCurrentDb ? this.buildTableNodes() : []
        })
      }
      if (this.showViews) {
        children.push({
          id: `${dbName}-views`,
          label: 'Views',
          icon: 'visibility',
          type: 'views-folder',
          expanded: false,
          dbName: dbName,
          children: isCurrentDb ? this.buildViewNodes() : []
        })
      }
      if (this.showProcedures) {
        children.push({
          id: `${dbName}-procedures`,
          label: 'Stored Procedures',
          icon: 'code',
          type: 'procedures-folder',
          expanded: false,
          dbName: dbName,
          children: isCurrentDb ? this.buildProcedureNodes() : []
        })
      }
      if (this.showFunctions) {
        children.push({
          id: `${dbName}-functions`,
          label: 'Functions',
          icon: 'functions',
          type: 'functions-folder',
          expanded: false,
          dbName: dbName,
          children: isCurrentDb ? this.buildFunctionNodes() : []
        })
      }
      return children
    },
    buildTableNodes() {
      if (!this.tables || this.tables.length === 0) {
        return []
      }

      return this.tables
        .filter(t => t.entityType === 'table')
        .map(table => {
          const cacheKey = `${this.database}.${table.schema}.${table.name}`
          const cachedColumns = this.tableColumnsCache[cacheKey] || []
          const cachedKeys = this.tableKeysCache[cacheKey] || []
          const cachedIndexes = this.tableIndexesCache[cacheKey] || []
          const isExpanded = this.expandedTables.has(cacheKey)
          
          return {
            id: `table-${table.name}`,
            label: table.name,
            icon: 'table_view',
            type: 'table',
            tableName: table.name,
            schema: table.schema,
            expanded: isExpanded,
            children: [
              {
                id: `table-${table.name}-columns`,
                label: 'Columns',
                icon: 'view_column',
                type: 'columns-folder',
                expanded: cachedColumns.length > 0,
                children: cachedColumns
              },
              {
                id: `table-${table.name}-keys`,
                label: 'Keys',
                icon: 'vpn_key',
                type: 'keys-folder',
                expanded: cachedKeys.length > 0,
                children: cachedKeys
              },
              {
                id: `table-${table.name}-indexes`,
                label: 'Indexes',
                icon: 'list',
                type: 'indexes-folder',
                expanded: cachedIndexes.length > 0,
                children: cachedIndexes
              }
            ]
          }
        })
    },
    buildViewNodes() {
      if (!this.tables || this.tables.length === 0) {
        return []
      }

      return this.tables
        .filter(t => t.entityType === 'view' || t.entityType === 'materialized-view')
        .map(view => ({
          id: `view-${view.name}`,
          label: view.name,
          icon: 'visibility',
          type: 'view',
          viewName: view.name,
          schema: view.schema,
          children: []
        }))
    },
    buildProcedureNodes() {
      if (!this.routines || this.routines.length === 0) {
        return []
      }

      return this.routines
        .filter(r => r.type && r.type.toLowerCase() === 'procedure')
        .map(proc => ({
          id: `procedure-${proc.name}`,
          label: proc.name,
          icon: 'code',
          type: 'procedure',
          procedureName: proc.name,
          schema: proc.schema,
          children: []
        }))
    },
    buildFunctionNodes() {
      if (!this.routines || this.routines.length === 0) {
        return []
      }

      return this.routines
        .filter(r => r.type && r.type.toLowerCase() === 'function')
        .map(func => ({
          id: `function-${func.name}`,
          label: func.name,
          icon: 'functions',
          type: 'function',
          functionName: func.name,
          schema: func.schema,
          children: []
        }))
    },
    updateTablesInTree() {
      // Update tables in the current database node
      const dbNode = this.findNode(this.rootNodes, `db-${this.database}`)
      if (dbNode) {
        const tablesFolder = dbNode.children.find(c => c.type === 'tables-folder')
        if (tablesFolder) {
          tablesFolder.children = this.buildTableNodes()
        }
      }
    },
    updateRoutinesInTree() {
      // Update views, procedures, and functions in the current database node
      const dbNode = this.findNode(this.rootNodes, `db-${this.database}`)
      if (dbNode) {
        const viewsFolder = dbNode.children.find(c => c.type === 'views-folder')
        if (viewsFolder) {
          viewsFolder.children = this.buildViewNodes()
        }
        
        const proceduresFolder = dbNode.children.find(c => c.type === 'procedures-folder')
        if (proceduresFolder) {
          proceduresFolder.children = this.buildProcedureNodes()
        }
        
        const functionsFolder = dbNode.children.find(c => c.type === 'functions-folder')
        if (functionsFolder) {
          functionsFolder.children = this.buildFunctionNodes()
        }
      }
    },
    findNode(nodes, id) {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = this.findNode(node.children, id)
          if (found) return found
        }
      }
      return null
    },
    async toggleNode(node) {
      node.expanded = !node.expanded
      
      // If expanding a database, switch to it and wait for data to load
      if (node.type === 'database' && node.expanded && node.dbName !== this.database) {
        try {
          // changeDatabase already calls updateTables and updateRoutines internally
          await this.$store.dispatch('changeDatabase', node.dbName)
          // Force rebuild the tree after database switch to populate the folders
          this.$nextTick(() => {
            this.buildTree()
          })
        } catch (e) {
          this.$noty.error(e.message)
        }
      }
      
      // If expanding/collapsing a table, track its state and load columns/keys/indexes if needed
      if (node.type === 'table') {
        const cacheKey = `${this.database}.${node.schema}.${node.tableName}`
        
        if (node.expanded) {
          // Track that this table is expanded
          this.expandedTables.add(cacheKey)
          
          try {
            const table = this.$store.state.tables.find(t =>
              t.name === node.tableName && (!node.schema || t.schema === node.schema)
            )

            if (table) {
              // Load columns (independent cache)
              if (!this.tableColumnsCache[cacheKey]) {
                const columns = await this.$store.state.connection.listTableColumns(node.tableName, node.schema)

                const columnNodes = (columns || []).map(col => ({
                  id: `column-${node.tableName}-${col.columnName}`,
                  label: `${col.columnName} (${col.dataType}${col.nullable ? ', null' : ', not null'})`,
                  icon: 'view_column',
                  type: 'column',
                  columnName: col.columnName,
                  dataType: col.dataType,
                  children: []
                }))

                this.$set(this.tableColumnsCache, cacheKey, columnNodes)

                const columnsFolder = node.children.find(c => c.type === 'columns-folder')
                if (columnsFolder) {
                  this.$set(columnsFolder, 'children', columnNodes)
                  this.$set(columnsFolder, 'expanded', true)
                }
              } else {
                const columnsFolder = node.children.find(c => c.type === 'columns-folder')
                if (columnsFolder && (!columnsFolder.children || columnsFolder.children.length === 0)) {
                  this.$set(columnsFolder, 'children', this.tableColumnsCache[cacheKey])
                }
              }

              // Load keys (independent cache)
              if (!this.tableKeysCache[cacheKey]) {
                const keyNodes = []

                const primaryKeys = await this.$store.state.connection.getPrimaryKeys(node.tableName, node.schema)
                if (primaryKeys && primaryKeys.length > 0) {
                  const pkName = primaryKeys[0].constraintName || 'PK_' + node.tableName
                  keyNodes.push({
                    id: `key-${node.tableName}-${pkName}`,
                    label: `${pkName} (PRIMARY KEY)`,
                    icon: 'vpn_key',
                    type: 'key',
                    keyName: pkName,
                    children: []
                  })
                }

                const fkeys = await this.$store.state.connection.getTableKeys(node.tableName, node.schema)
                if (fkeys && fkeys.length > 0) {
                  fkeys.forEach(key => {
                    keyNodes.push({
                      id: `key-${node.tableName}-${key.constraintName}`,
                      label: `${key.constraintName} (FOREIGN KEY)`,
                      icon: 'vpn_key',
                      type: 'key',
                      keyName: key.constraintName,
                      children: []
                    })
                  })
                }

                this.$set(this.tableKeysCache, cacheKey, keyNodes)

                const keysFolder = node.children.find(c => c.type === 'keys-folder')
                if (keysFolder) {
                  this.$set(keysFolder, 'children', keyNodes)
                  this.$set(keysFolder, 'expanded', true)
                }
              } else {
                const keysFolder = node.children.find(c => c.type === 'keys-folder')
                if (keysFolder && (!keysFolder.children || keysFolder.children.length === 0)) {
                  this.$set(keysFolder, 'children', this.tableKeysCache[cacheKey])
                }
              }

              // Load indexes (independent cache)
              if (!this.tableIndexesCache[cacheKey]) {
                const indexes = await this.$store.state.connection.listTableIndexes(node.tableName, node.schema)
                const indexNodes = (indexes || []).map(idx => ({
                  id: `index-${node.tableName}-${idx.name}`,
                  label: `${idx.name}${idx.unique ? ' (Unique)' : ''}`,
                  icon: 'list',
                  type: 'index',
                  indexName: idx.name,
                  children: []
                }))

                this.$set(this.tableIndexesCache, cacheKey, indexNodes)

                const indexesFolder = node.children.find(c => c.type === 'indexes-folder')
                if (indexesFolder) {
                  this.$set(indexesFolder, 'children', indexNodes)
                  this.$set(indexesFolder, 'expanded', indexNodes.length > 0)
                }
              } else {
                const indexesFolder = node.children.find(c => c.type === 'indexes-folder')
                if (indexesFolder && (!indexesFolder.children || indexesFolder.children.length === 0)) {
                  this.$set(indexesFolder, 'children', this.tableIndexesCache[cacheKey])
                }
              }
            }
          } catch (e) {
            console.error('Failed to load table details:', e)
          }
        } else {
          // Track that this table is collapsed
          this.expandedTables.delete(cacheKey)
        }
      }
    },
    selectNode(node) {
      this.selectedNode = node
      
      // Handle different node types
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.loadTable, { table })
        }
      }
    },
    showContextMenu(node, event) {
      this.contextMenuNode = node
      this.contextMenuPosition = { x: event.clientX, y: event.clientY }
      this.contextMenuVisible = true
      
      // Close context menu when clicking anywhere
      const closeMenu = () => {
        this.closeContextMenu()
        document.removeEventListener('click', closeMenu)
      }
      setTimeout(() => {
        document.addEventListener('click', closeMenu)
      }, 0)
    },
    closeContextMenu() {
      this.contextMenuVisible = false
      this.contextMenuNode = null
    },
    handleContextMenuAction({ action, node }) {
      log.info('Context menu action:', action, node)
      
      switch (action) {
        case 'create-table':
          this.$root.$emit(AppEvent.createTable)
          break
        case 'create-table-from-file':
          this.$root.$emit(AppEvent.createTableFromFile)
          break
        case 'drop-database':
          this.dropDatabase(node)
          break
        case 'refresh':
          this.refreshNode(node)
          break
        case 'view-data':
          this.viewData(node)
          break
        case 'view-structure':
          this.viewStructure(node)
          break
        case 'select-top':
          this.selectTopRows(node)
          break
        case 'open-table':
          this.openTable(node)
          break
        case 'open-view':
          this.openView(node)
          break
        case 'new-query':
          this.newQuery()
          break
        case 'export':
          this.exportData(node)
          break
        case 'import':
          this.importData(node)
          break
        case 'copy-name':
          this.copyName(node)
          break
        case 'hide':
          this.hideTable(node)
          break
        case 'sql-create':
          this.sqlCreate(node)
          break
        case 'rename':
          this.renameTable(node)
          break
        case 'drop':
          this.dropTable(node)
          break
        case 'truncate':
          this.truncateTable(node)
          break
        case 'duplicate':
          this.duplicateTable(node)
          break
        case 'view-erd':
          this.viewERD(node)
          break
        case 'design':
          this.designTable(node)
          break
        case 'script-view':
          this.scriptView(node)
          break
        case 'script-procedure':
          this.scriptProcedure(node)
          break
        case 'script-function':
          this.scriptFunction(node)
          break
        case 'execute':
          this.executeRoutine(node)
          break
        case 'modify':
          this.modifyRoutine(node)
          break
        case 'backup':
          this.backupDatabase(node)
          break
        case 'restore':
          this.restoreDatabase(node)
          break
        case 'properties':
          this.showProperties(node)
          break
        default:
          this.$noty.info(`Action "${action}" not yet implemented`)
      }
    },
    escapeSqlServerIdentifier(name) {
      return String(name).replace(/]/g, ']]')
    },
    async dropDatabase(node) {
      try {
        if (!node || node.type !== 'database') return
        const dbName = node.dbName
        if (!dbName || typeof dbName !== 'string') return

        const confirmed = await this.$confirm(`Really drop database "${dbName}"? This action cannot be undone.`)
        if (!confirmed) return

        if (this.connectionType !== 'sqlserver') {
          this.$noty.error('Drop database is only implemented for SQL Server right now')
          return
        }

        const safe = this.escapeSqlServerIdentifier(dbName)
        // Ensure we are not connected to the target database when dropping it
        await this.$store.dispatch('changeDatabase', 'master').catch(() => {})

        // Force disconnect active users then drop
        await this.connection.executeQuery(
          `ALTER DATABASE [${safe}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${safe}];`
        )

        this.$noty.success(`Database "${dbName}" dropped`)
        await this.refreshDatabases()
      } catch (e) {
        this.$noty.error(e?.message || String(e))
      }
    },
    async refreshNode(node) {
      try {
        if (node.type === 'database' || node.type === 'tables-folder' || node.type === 'views-folder') {
          await this.$store.dispatch('updateTables')
          await this.$store.dispatch('updateRoutines')
          this.buildTree()
        }
        this.$noty.success('Refreshed successfully')
      } catch (error) {
        this.$noty.error('Failed to refresh: ' + error.message)
      }
    },
    selectTopRows(node) {
      if (node.type === 'table') {
        const query = `SELECT TOP 1000 * FROM ${node.schema ? `[${node.schema}].[${node.tableName}]` : `[${node.tableName}]`}`
        this.$root.$emit(AppEvent.newTab, query)
      } else if (node.type === 'view') {
        const query = `SELECT TOP 1000 * FROM ${node.schema ? `[${node.schema}].[${node.viewName}]` : `[${node.viewName}]`}`
        this.$root.$emit(AppEvent.newTab, query)
      }
    },
    openTable(node) {
      if (node.type === 'table') {
        this.$emit('tableSelected', node.tableName, node.schema)
      }
    },
    openView(node) {
      if (node.type === 'view') {
        const query = `SELECT TOP 1000 * FROM ${node.schema ? `[${node.schema}].[${node.viewName}]` : `[${node.viewName}]`}`
        this.$root.$emit(AppEvent.newTab, query)
      }
    },
    newQuery() {
      this.$root.$emit(AppEvent.newTab)
    },
    exportData(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.beginExport, { table })
        }
      }
    },
    importData(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.beginImport, { table })
        }
      }
    },
    async designTable(node) {
      if (node.type === 'table') {
        const tableName = node.schema ? `[${node.schema}].[${node.tableName}]` : `[${node.tableName}]`
        try {
          const query = `SELECT 
    c.COLUMN_NAME,
    c.DATA_TYPE,
    c.CHARACTER_MAXIMUM_LENGTH,
    c.IS_NULLABLE,
    c.COLUMN_DEFAULT,
    c.ORDINAL_POSITION
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = '${node.tableName}'${node.schema ? `\n  AND c.TABLE_SCHEMA = '${node.schema}'` : ''}
ORDER BY c.ORDINAL_POSITION`
          
          const result = await this.$store.state.connection.executeQuery(query)
          
          if (result && result[0]?.rows?.length > 0) {
            // Generate CREATE TABLE script from the column information
            const columns = result[0].rows
            let createScript = `-- Design table: ${tableName}\nCREATE TABLE ${tableName} (\n`
            
            const columnDefs = columns.map(col => {
              let def = `    [${col.COLUMN_NAME}] ${col.DATA_TYPE}`
              if (col.CHARACTER_MAXIMUM_LENGTH && col.CHARACTER_MAXIMUM_LENGTH > 0) {
                def += `(${col.CHARACTER_MAXIMUM_LENGTH === -1 ? 'MAX' : col.CHARACTER_MAXIMUM_LENGTH})`
              }
              def += col.IS_NULLABLE === 'NO' ? ' NOT NULL' : ' NULL'
              if (col.COLUMN_DEFAULT) {
                def += ` DEFAULT ${col.COLUMN_DEFAULT}`
              }
              return def
            })
            
            createScript += columnDefs.join(',\n')
            createScript += '\n);'
            
            this.$root.$emit(AppEvent.newTab, createScript)
          } else {
            this.$noty.error('Could not retrieve table structure')
          }
        } catch (error) {
          this.$noty.error('Failed to design table: ' + error.message)
        }
      }
    },
    async scriptView(node) {
      if (node.type === 'view') {
        const viewName = node.schema ? `[${node.schema}].[${node.viewName}]` : `[${node.viewName}]`
        try {
          const result = await this.$store.state.connection.executeQuery(
            `SELECT OBJECT_DEFINITION(OBJECT_ID('${viewName}')) AS Definition`
          )
          const definition = result[0]?.rows[0]?.Definition
          if (definition) {
            let probe = String(definition)
            // Some databases return comments before the CREATE VIEW statement.
            // Strip leading whitespace + SQL comments before detecting full CREATE VIEW.
            while (true) {
              const next = probe.trimStart()
              if (next.startsWith('--')) {
                probe = next.replace(/^--.*(?:\r?\n|$)/, '')
                continue
              }
              if (next.startsWith('/*')) {
                const end = next.indexOf('*/')
                if (end >= 0) {
                  probe = next.slice(end + 2)
                  continue
                }
              }
              probe = next
              break
            }

            const isFullCreate = /^CREATE\s+VIEW\b/i.test(probe)
            const script = isFullCreate
              ? `-- Script for view: ${viewName}\n${definition}`
              : `-- Script for view: ${viewName}\nCREATE VIEW ${viewName}\nAS\n${definition}`
            this.$root.$emit(AppEvent.newTab, script)
          } else {
            this.$noty.error('Could not retrieve view definition')
          }
        } catch (error) {
          this.$noty.error('Failed to script view: ' + error.message)
        }
      }
    },
    async scriptProcedure(node) {
      if (node.type === 'procedure') {
        const procName = node.schema ? `[${node.schema}].[${node.procedureName}]` : `[${node.procedureName}]`
        try {
          const result = await this.$store.state.connection.executeQuery(
            `SELECT OBJECT_DEFINITION(OBJECT_ID('${procName}')) AS Definition`
          )
          let definition = result[0]?.rows[0]?.Definition
          if (definition) {
            // OBJECT_DEFINITION returns the full definition including CREATE PROCEDURE
            const script = `-- Script for procedure: ${procName}\n${definition}`
            this.$root.$emit(AppEvent.newTab, script)
          } else {
            this.$noty.error('Could not retrieve procedure definition')
          }
        } catch (error) {
          this.$noty.error('Failed to script procedure: ' + error.message)
        }
      }
    },
    async scriptFunction(node) {
      if (node.type === 'function') {
        const funcName = node.schema ? `[${node.schema}].[${node.functionName}]` : `[${node.functionName}]`
        try {
          const result = await this.$store.state.connection.executeQuery(
            `SELECT OBJECT_DEFINITION(OBJECT_ID('${funcName}')) AS Definition`
          )
          let definition = result[0]?.rows[0]?.Definition
          if (definition) {
            // OBJECT_DEFINITION returns the full definition including CREATE FUNCTION
            const script = `-- Script for function: ${funcName}\n${definition}`
            this.$root.$emit(AppEvent.newTab, script)
          } else {
            this.$noty.error('Could not retrieve function definition')
          }
        } catch (error) {
          this.$noty.error('Failed to script function: ' + error.message)
        }
      }
    },
    async executeRoutine(node) {
      if (node.type === 'procedure') {
        const procName = node.schema ? `[${node.schema}].[${node.procedureName}]` : `[${node.procedureName}]`
        
        try {
          // Get procedure parameters
          const result = await this.$store.state.connection.executeQuery(`
            SELECT 
              PARAMETER_NAME,
              DATA_TYPE,
              PARAMETER_MODE,
              CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.PARAMETERS
            WHERE SPECIFIC_NAME = '${node.procedureName}'
              ${node.schema ? `AND SPECIFIC_SCHEMA = '${node.schema}'` : ''}
            ORDER BY ORDINAL_POSITION
          `)
          
          const params = result[0]?.rows || []
          
          if (params.length > 0) {
            // Build EXEC statement with parameter placeholders
            let query = `-- Execute procedure: ${procName}\nEXEC ${procName}\n`
            const paramLines = params.map(p => {
              const paramName = p.PARAMETER_NAME
              const dataType = p.DATA_TYPE
              const maxLength = p.CHARACTER_MAXIMUM_LENGTH
              let typeInfo = dataType
              if (maxLength && maxLength > 0) {
                typeInfo += `(${maxLength === -1 ? 'MAX' : maxLength})`
              }
              return `    ${paramName} = NULL  -- ${typeInfo}`
            })
            query += paramLines.join(',\n')
            this.$root.$emit(AppEvent.newTab, query)
          } else {
            // No parameters, simple EXEC
            const query = `-- Execute procedure: ${procName}\nEXEC ${procName}`
            this.$root.$emit(AppEvent.newTab, query)
          }
        } catch (error) {
          // Fallback if parameter query fails
          const query = `-- Execute procedure: ${procName}\nEXEC ${procName}\n-- Add parameters if needed`
          this.$root.$emit(AppEvent.newTab, query)
        }
      } else if (node.type === 'function') {
        const funcName = node.schema ? `[${node.schema}].[${node.functionName}]` : `[${node.functionName}]`
        
        try {
          // Get function parameters
          const result = await this.$store.state.connection.executeQuery(`
            SELECT 
              PARAMETER_NAME,
              DATA_TYPE,
              CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.PARAMETERS
            WHERE SPECIFIC_NAME = '${node.functionName}'
              ${node.schema ? `AND SPECIFIC_SCHEMA = '${node.schema}'` : ''}
              AND PARAMETER_NAME IS NOT NULL
            ORDER BY ORDINAL_POSITION
          `)
          
          const params = result[0]?.rows || []
          
          if (params.length > 0) {
            // Build SELECT statement with parameter placeholders
            const paramPlaceholders = params.map(p => {
              const dataType = p.DATA_TYPE
              const maxLength = p.CHARACTER_MAXIMUM_LENGTH
              let typeInfo = dataType
              if (maxLength && maxLength > 0) {
                typeInfo += `(${maxLength === -1 ? 'MAX' : maxLength})`
              }
              return `NULL /* ${p.PARAMETER_NAME} - ${typeInfo} */`
            }).join(', ')
            const query = `-- Execute function: ${funcName}\nSELECT ${funcName}(${paramPlaceholders})`
            this.$root.$emit(AppEvent.newTab, query)
          } else {
            // No parameters
            const query = `-- Execute function: ${funcName}\nSELECT ${funcName}()`
            this.$root.$emit(AppEvent.newTab, query)
          }
        } catch (error) {
          // Fallback if parameter query fails
          const query = `-- Execute function: ${funcName}\nSELECT ${funcName}()\n-- Add parameters if needed`
          this.$root.$emit(AppEvent.newTab, query)
        }
      }
    },
    modifyRoutine(node) {
      if (node.type === 'procedure') {
        this.scriptProcedure(node)
      } else if (node.type === 'function') {
        this.scriptFunction(node)
      }
    },
    backupDatabase(node) {
      if (node.type === 'database') {
        this.$root.$emit(AppEvent.backupDatabase, { database: node.dbName })
      }
    },
    restoreDatabase(node) {
      if (node.type === 'database') {
        this.$root.$emit(AppEvent.restoreDatabase, { database: node.dbName })
      }
    },
    viewData(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.loadTable, { table })
        }
      }
    },
    viewStructure(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.openTableProperties, { table })
        }
      }
    },
    copyName(node) {
      if (node.type === 'table') {
        const tableName = node.tableName
        navigator.clipboard.writeText(tableName).then(() => {
          this.$noty.success(`Copied: ${tableName}`)
        }).catch(() => {
          this.$noty.error('Failed to copy table name')
        })
      }
    },
    hideTable(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.toggleHideEntity, table, true)
        }
      }
    },
    sqlCreate(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit('loadTableCreate', table)
        }
      }
    },
    renameTable(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.setDatabaseElementName, { 
            type: 'table', 
            item: table 
          })
        }
      }
    },
    dropTable(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.dropDatabaseElement, { 
            item: table, 
            action: 'drop' 
          })
        }
      }
    },
    truncateTable(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.dropDatabaseElement, { 
            item: table, 
            action: 'truncate' 
          })
        }
      }
    },
    duplicateTable(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit(AppEvent.duplicateDatabaseTable, { 
            item: table, 
            action: 'duplicate' 
          })
        }
      }
    },
    viewERD(node) {
      if (node.type === 'table') {
        const table = this.$store.state.tables.find(t => 
          t.name === node.tableName && (!node.schema || t.schema === node.schema)
        )
        if (table) {
          this.$root.$emit('show-erd', { table })
        }
      }
    },
    showProperties(node) {
      this.$noty.info('Properties view not yet implemented')
    },
    async refreshAll() {
      try {
        await this.$store.dispatch('updateTables')
        await this.$store.dispatch('updateRoutines')
        this.buildTree()
        this.$noty.success('Refreshed successfully')
      } catch (error) {
        this.$noty.error('Failed to refresh: ' + error.message)
      }
    },
    async disconnect() {
      await this.$store.dispatch('disconnect')
      this.$noty.success('Successfully Disconnected')
    }
  }
}
</script>

<style lang="scss" scoped>
.object-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-color);
  color: var(--text-color);
}

.explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-color-light);
}

.connection-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.connection-icon {
  font-size: 20px;
  color: var(--primary-color);
}

.connection-details {
  flex: 1;
  min-width: 0;
}

.connection-name {
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.connection-server {
  font-size: 11px;
  color: var(--text-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color);
  
  &:hover {
    background: var(--bg-color-hover);
  }
  
  .material-icons {
    font-size: 18px;
  }
}

.explorer-tree {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}
</style>
