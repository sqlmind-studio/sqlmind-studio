<template>
  <div class="tree-node">
    <div
      class="tree-node-content"
      :class="{
        'is-selected': isSelected,
        'is-expanded': node.expanded,
        'has-children': hasChildren
      }"
      :style="{ paddingLeft: `${level * 16 + 8}px` }"
      @click="handleClick"
      @contextmenu.prevent="handleContextMenu"
    >
      <!-- Expand/Collapse Icon -->
      <span class="expand-icon" @click.stop="handleToggle">
        <i v-if="hasChildren" class="material-icons">
          {{ node.expanded ? 'expand_more' : 'chevron_right' }}
        </i>
        <span v-else class="spacer"></span>
      </span>

      <!-- Node Icon -->
      <span
        v-if="node.type === 'database'"
        class="bk-database node-icon node-icon-bk"
        :class="[`icon-${node.type}`, { 'is-offline': node.isOffline }]"
      />
      <i
        v-else
        class="material-icons node-icon"
        :class="[`icon-${node.type}`, { 'is-offline': node.isOffline }]"
      >
        {{ getIcon(node) }}
      </i>

      <!-- Node Label -->
      <span class="node-label">{{ node.label }}</span>

      <!-- Badge (for counts) -->
      <span v-if="node.badge" class="node-badge">{{ node.badge }}</span>
    </div>

    <!-- Children -->
    <div v-if="node.expanded && hasChildren" class="tree-node-children">
      <tree-node
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-id="selectedId"
        @toggle="$emit('toggle', $event)"
        @select="$emit('select', $event)"
        @contextmenu="handleChildContextMenu"
      />
    </div>
  </div>
</template>

<script>
export default {
  name: 'TreeNode',
  props: {
    node: {
      type: Object,
      required: true
    },
    level: {
      type: Number,
      default: 0
    },
    selectedId: {
      type: String,
      default: null
    }
  },
  computed: {
    hasChildren() {
      return this.node.children && this.node.children.length > 0
    },
    isSelected() {
      return this.selectedId === this.node.id
    }
  },
  methods: {
    getIcon(node) {
      // Use the icon from the node if provided, otherwise use type mapping
      if (node.icon) {
        return node.icon
      }
      
      const iconMap = {
        'folder': 'folder',
        'database': 'storage',
        'table': 'table_chart',
        'view': 'visibility',
        'procedure': 'code',
        'function': 'functions',
        'column': 'view_column',
        'key': 'vpn_key',
        'index': 'list',
        'security': 'security',
        'tables-folder': 'folder',
        'views-folder': 'folder',
        'procedures-folder': 'folder',
        'functions-folder': 'folder',
        'synonyms-folder': 'folder',
        'columns-folder': 'folder',
        'keys-folder': 'folder',
        'indexes-folder': 'folder'
      }
      return iconMap[node.type] || 'description'
    },
    handleToggle() {
      if (this.hasChildren) {
        this.$emit('toggle', this.node)
      }
    },
    handleClick() {
      this.$emit('select', this.node)
      if (this.hasChildren) {
        this.$emit('toggle', this.node)
      }
    },
    handleContextMenu(event) {
      this.$emit('contextmenu', this.node, event)
    },
    handleChildContextMenu(node, event) {
      // Propagate the contextmenu event from child nodes
      this.$emit('contextmenu', node, event)
    }
  }
}
</script>

<style lang="scss" scoped>
.tree-node {
  user-select: none;
}

.tree-node-content {
  display: flex;
  align-items: center;
  height: 24px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
  transition: background-color 0.15s;

  &:hover {
    background: var(--bg-color-hover, rgba(255, 255, 255, 0.05));
  }

  &.is-selected {
    background: var(--primary-color-trans, rgba(66, 133, 244, 0.2));
    
    .node-label {
      font-weight: 500;
    }
  }
}

.expand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: 2px;
  flex-shrink: 0;

  .material-icons {
    font-size: 18px;
    color: var(--text-light, #999);
    transition: transform 0.2s;
  }

  .spacer {
    width: 18px;
    height: 18px;
  }
}

.node-icon {
  font-size: 16px;
  margin-right: 6px;
  flex-shrink: 0;
  color: var(--text-color);

  &.node-icon-bk {
    font-size: 16px;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  &.icon-database {
    color: #4285f4;
    
    &.is-offline {
      color: #ea4335 !important; // Red color for offline databases
    }
  }

  &.icon-table {
    color: #34a853;
  }

  &.icon-view {
    color: #fbbc04;
  }

  &.icon-procedure,
  &.icon-function {
    color: #ea4335;
  }

  &.icon-folder,
  &.icon-tables-folder,
  &.icon-views-folder,
  &.icon-procedures-folder,
  &.icon-functions-folder,
  &.icon-synonyms-folder,
  &.icon-columns-folder,
  &.icon-keys-folder,
  &.icon-indexes-folder {
    color: #fbbc04;
  }
}

.node-label {
  flex: 1;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-color);
}

.node-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--bg-color-light);
  color: var(--text-light);
  margin-left: 4px;
  margin-right: 4px;
}

// Children are rendered with increased padding via the level prop
</style>
