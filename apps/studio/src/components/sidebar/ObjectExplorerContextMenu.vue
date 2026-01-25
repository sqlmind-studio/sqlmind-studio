<template>
  <div
    v-if="visible"
    class="context-menu"
    :style="{ top: `${position.y}px`, left: `${position.x}px` }"
    @click.stop
  >
    <div class="context-menu-item" v-for="item in menuItems" :key="item.id">
      <div
        v-if="!item.divider"
        class="menu-item-content"
        :class="{ disabled: item.disabled }"
        @click="handleItemClick(item)"
      >
        <i v-if="item.icon" class="material-icons">{{ item.icon }}</i>
        <span>{{ item.label }}</span>
        <span v-if="item.shortcut" class="shortcut">{{ item.shortcut }}</span>
      </div>
      <div v-else class="menu-divider"></div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ObjectExplorerContextMenu',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    position: {
      type: Object,
      default: () => ({ x: 0, y: 0 })
    },
    node: {
      type: Object,
      default: null
    }
  },
  computed: {
    menuItems() {
      if (!this.node) return []
      
      switch (this.node.type) {
        case 'database':
          return [
            { id: 'refresh', label: 'Refresh', icon: 'refresh' },
            { id: 'new-query', label: 'New Query', icon: 'add' },
            { divider: true },
            { id: 'backup', label: 'Backup Database', icon: 'backup' },
            { id: 'restore', label: 'Restore Database', icon: 'restore' },
            { divider: true },
            { id: 'drop-database', label: 'Drop Database...', icon: 'delete' },
            { divider: true },
            { id: 'properties', label: 'Properties', icon: 'info' }
          ]
        
        case 'table':
          return [
            { id: 'view-data', label: 'View Data', icon: 'table_view' },
            { id: 'view-structure', label: 'View Structure', icon: 'account_tree' },
            { id: 'export', label: 'Export To File', icon: 'download' },
            { id: 'import', label: 'Import from File', icon: 'upload' },
            { divider: true },
            { id: 'copy-name', label: 'Copy Name', icon: 'content_copy' },
            { id: 'hide', label: 'Hide', icon: 'visibility_off' },
            { divider: true },
            { id: 'sql-create', label: 'SQL: Create', icon: 'add_circle' },
            { id: 'rename', label: 'Rename', icon: 'edit' },
            { id: 'drop', label: 'Drop', icon: 'delete' },
            { id: 'truncate', label: 'Truncate', icon: 'clear_all' },
            { id: 'duplicate', label: 'Duplicate', icon: 'content_copy' },
            { divider: true },
            { id: 'view-erd', label: 'View ERD', icon: 'schema' },
            { divider: true },
            { id: 'refresh', label: 'Refresh', icon: 'refresh' }
          ]
        
        case 'view':
          return [
            { id: 'select-top', label: 'Select Top 1000', icon: 'visibility' },
            { id: 'open-view', label: 'Open View', icon: 'open_in_new' },
            { divider: true },
            { id: 'script-view', label: 'Script View', icon: 'code' },
            { id: 'refresh', label: 'Refresh', icon: 'refresh' },
            { id: 'properties', label: 'Properties', icon: 'info' }
          ]
        
        case 'procedure':
          return [
            { id: 'execute', label: 'Execute Procedure', icon: 'play_arrow' },
            { id: 'modify', label: 'Modify Procedure', icon: 'edit' },
            { divider: true },
            { id: 'script-procedure', label: 'Script Procedure', icon: 'code' },
            { id: 'refresh', label: 'Refresh', icon: 'refresh' },
            { id: 'properties', label: 'Properties', icon: 'info' }
          ]
        
        case 'function':
          return [
            { id: 'execute', label: 'Execute Function', icon: 'play_arrow' },
            { id: 'modify', label: 'Modify Function', icon: 'edit' },
            { divider: true },
            { id: 'script-function', label: 'Script Function', icon: 'code' },
            { id: 'refresh', label: 'Refresh', icon: 'refresh' },
            { id: 'properties', label: 'Properties', icon: 'info' }
          ]
        
        case 'tables-folder':
        case 'views-folder':
        case 'procedures-folder':
        case 'functions-folder':
          return [
            ...(this.node.type === 'tables-folder' ? [
              { id: 'create-table', label: 'New Table', icon: 'add' },
              { id: 'create-table-from-file', label: 'New Table from File', icon: 'upload' },
              { divider: true },
            ] : []),
            { id: 'refresh', label: 'Refresh', icon: 'refresh' },
            { id: 'new-query', label: 'New Query', icon: 'add' }
          ]
        
        default:
          return [
            { id: 'refresh', label: 'Refresh', icon: 'refresh' }
          ]
      }
    }
  },
  methods: {
    handleItemClick(item) {
      if (item.disabled) return
      this.$emit('action', { action: item.id, node: this.node })
      this.$emit('close')
    }
  }
}
</script>

<style lang="scss" scoped>
.context-menu {
  position: fixed;
  background: #ffffff;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  min-width: 200px;
  padding: 4px 0;
  z-index: 10000;
}

.context-menu-item {
  .menu-item-content {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    color: #1a1a1a;
    transition: background-color 0.15s;
    font-weight: 400;
    
    &:hover:not(.disabled) {
      background: #e8f0fe;
    }
    
    &.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .material-icons {
      font-size: 18px;
      margin-right: 8px;
      color: #5f6368;
    }
    
    span {
      flex: 1;
      font-size: 13px;
      color: #1a1a1a;
    }
    
    .shortcut {
      font-size: 11px;
      color: #5f6368;
      margin-left: 16px;
    }
  }
  
  .menu-divider {
    height: 1px;
    background: #e0e0e0;
    margin: 4px 0;
  }
}

/* Dark theme support */
@media (prefers-color-scheme: dark) {
  .context-menu {
    background: #2d2d2d;
    border-color: #454545;
  }
  
  .context-menu-item .menu-item-content {
    color: #e8e8e8;
    
    &:hover:not(.disabled) {
      background: #3d3d3d;
    }
    
    .material-icons {
      color: #b0b0b0;
    }
    
    span {
      color: #e8e8e8;
    }
    
    .shortcut {
      color: #b0b0b0;
    }
  }
  
  .menu-divider {
    background: #454545;
  }
}
</style>
