<template>
  <div class="workspace-avatar">
    <img
      class="workspace-logo"
      v-if="workspace.logo"
      :src="workspace.logo"
      :alt="workspace.name"
    >
    <i
      v-else-if="workspace.icon"
      class="material-icons workspace-icon"
    >{{ workspace.icon }}</i>
    <span
      v-else
      class="workspace-letter"
    >{{ workspaceLetter }}</span>
  </div>
</template>
<script lang="ts">
import Vue from 'vue'
export default Vue.extend({
  props: ['workspace'],
  computed: {
    workspaceLetter() {
      // Handle different possible field names from the API
      const name = this.workspace?.name || this.workspace?.WorkspaceName || this.workspace?.workspaceName || 'W'
      return name.toString().toUpperCase()[0]
    }
  }
})
</script>