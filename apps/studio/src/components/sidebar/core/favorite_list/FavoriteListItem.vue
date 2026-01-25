<template>
  <div
    class="list-item"
    @contextmenu.prevent.stop="openContextMenu($event, item)"
  >
    <a
      class="list-item-btn"
      :title="truncatedText"
      @click.prevent="$emit('select', item)"
      @dblclick.prevent="$emit('open', item)"
      :class="{active, selected}"
    >
      <i class="item-icon query material-icons">code</i>
      <div class="list-title flex-col">
        <span class="item-text title truncate expand">{{ item.title }}</span>
        <span class="database subtitle"><span>{{ subtitle }}</span></span>
      </div>
    </a>
  </div>
</template>
<script lang="ts">
import _ from 'lodash'
import { IQueryFolder } from '@/common/interfaces/IQueryFolder'
import Vue from 'vue'
import { mapState } from 'vuex'
import TimeAgo from 'javascript-time-ago'

export default Vue.extend({
  props: ['item', 'selected', 'active'],
  data: () => ({
    timeAgo: new TimeAgo('en-US')
  }),
  computed: {
    ...mapState('data/queryFolders', {'folders': 'items'}),
    workspace() {
      return this.$store.getters.workspace
    },
    workspaces() {
      return this.$store.getters.workspaces || []
    },
    personalWorkspace() {
      // Get user's personal workspace (level = 'workspace' or first workspace)
      if (!this.workspaces || this.workspaces.length === 0) return null
      return this.workspaces.find(ws => ws.level === 'workspace') || this.workspaces[0]
    },
    teamWorkspace() {
      // Get team workspace (level = 'team')
      if (!this.workspaces || this.workspaces.length === 0) return null
      return this.workspaces.find(ws => ws.level === 'team')
    },
    isPersonalQuery() {
      if (!this.personalWorkspace) return false
      return this.item.workspaceId === this.personalWorkspace.cloudId || 
             this.item.workspaceId === this.personalWorkspace.id
    },
    isTeamQuery() {
      // If no team workspace found, assume all queries are team queries as fallback
      if (!this.teamWorkspace) {
        console.warn('[FavoriteListItem] No team workspace found, assuming query is in Team')
        return true
      }
      return this.item.workspaceId === this.teamWorkspace.cloudId || 
             this.item.workspaceId === this.teamWorkspace.id
    },
    truncatedText() {
      return _.truncate(this.item.text, { length: 100});
    },
    moveToOptions() {
      console.log('[FavoriteListItem] All folders:', this.folders)
      console.log('[FavoriteListItem] Current query folder:', this.item.queryFolderId)
      console.log('[FavoriteListItem] Current query workspace:', this.item.workspaceId)
      
      // Filter folders: same workspace AND different from current folder
      const normalizeId = (v) => (v === null || v === undefined ? '' : String(v).toLowerCase())
      const workspaceFolders = this.folders
        .filter((folder) => normalizeId(folder.workspaceId) === normalizeId(this.item.workspaceId))

      const candidateFolders = workspaceFolders.length ? workspaceFolders : this.folders

      const availableFolders = candidateFolders
        .filter((folder) => {
          const differentFolder = normalizeId(folder.id) !== normalizeId(this.item.queryFolderId)
          console.log(`[FavoriteListItem] Folder "${folder.name}": different=${differentFolder}`)
          return differentFolder
        })
        .map((folder: IQueryFolder) => {
          return {
            name: `Move to ${folder.name}`,
            handler: this.moveItem,
            folder
          }
        })
      
      console.log('[FavoriteListItem] Available move options:', availableFolders.length)
      return availableFolders
    },
    subtitle() {
      const result = []
      if (this.item.user?.name) result.push(`${this.item.user.name}`)
      if (this.item.createdAt) {
        if (_.isNumber(this.item.createdAt)) {
          result.push(this.timeAgo.format(new Date(this.item.createdAt * 1000)))
        } else {
          result.push(this.timeAgo.format(this.item.createdAt))
        }
      }
      return result.join(" ")
    }
  },
  methods: {
    async moveItem({ item, option }) {
      try {
        const folder = option.folder
        console.log("moving item!", folder)
        if (!folder || !folder.id) return
        const updated = _.clone(item)
        updated.queryFolderId = folder.id
        await this.$store.dispatch('data/queries/save', updated)
        
        // Reload queries to update the UI immediately
        await this.$store.dispatch('data/queries/load')
        await this.$store.dispatch('data/queryFolders/load')
        this.$noty.success(`Moved to ${folder.name}`)
      } catch (ex) {
        this.$noty.error(`Move Error: ${ex.message}`)
        console.error(ex)
      }
    },
    async moveToWorkspace({ item, workspaceId }) {
      try {
        // Determine if moving to personal or team
        const isMovingToPersonal = workspaceId === 0 || workspaceId === '0'
        
        // Get the actual workspace GUID or numeric ID
        let finalWorkspaceId
        if (isMovingToPersonal) {
          // For Personal workspace, we'll use 0 as a special marker
          // The backend will handle creating the Personal workspace if it doesn't exist
          // or finding the existing one
          finalWorkspaceId = 0
        } else {
          // For team workspace, use the provided ID (could be GUID or numeric)
          // If it's a GUID, use it directly; if numeric, use it directly
          finalWorkspaceId = workspaceId
        }
        
        console.log("moving query to workspace!", {
          original: workspaceId,
          final: finalWorkspaceId,
          isPersonal: isMovingToPersonal,
          personalWorkspace: this.personalWorkspace,
          teamWorkspace: this.teamWorkspace
        })
        
        const updated = _.clone(item)
        updated.workspaceId = finalWorkspaceId
        await this.$store.dispatch('data/queries/save', updated)
        
        // Switch to the target workspace
        const targetWorkspace = isMovingToPersonal ? this.personalWorkspace : this.teamWorkspace
        if (targetWorkspace) {
          console.log('[FavoriteListItem] Switching to workspace:', targetWorkspace.name, targetWorkspace.id)
          await this.$store.dispatch('setWorkspace', targetWorkspace.id)
        }
        
        // Reload queries and folders to update the UI immediately
        await this.$store.dispatch('data/queries/load')
        await this.$store.dispatch('data/queryFolders/load')
        this.$noty.success(`Moved to ${isMovingToPersonal ? 'Personal' : 'Team'} workspace`)
      } catch (ex) {
        this.$noty.error(`Move Error: ${ex.message}`)
        console.error(ex)
      }
    },
    openContextMenu(event, item) {
      console.log('[FavoriteListItem] Context menu opened for query:', item.title)
      console.log('[FavoriteListItem] All folders:', this.folders)
      console.log('[FavoriteListItem] Current query folder:', item.queryFolderId)
      console.log('[FavoriteListItem] Query workspace:', item.workspaceId)
      
      // Get folders in the same workspace
      const normalizeId = (v) => (v === null || v === undefined ? '' : String(v).toLowerCase())
      const sameworkspaceFolders = this.folders.filter(f => normalizeId(f.workspaceId) === normalizeId(item.workspaceId))
      console.log('[FavoriteListItem] Folders in same workspace:', sameworkspaceFolders)

      const candidateFolders = sameworkspaceFolders.length ? sameworkspaceFolders : this.folders
      
      // Log each folder name for debugging
      candidateFolders.forEach(f => {
        console.log(`[FavoriteListItem] Folder: "${f.name}" (id: ${f.id})`)
        console.log(`[FavoriteListItem] Lowercase: "${f.name.toLowerCase()}"`)
      })
      
      // Find Personal and Team folders
      const personalFolder = candidateFolders.find(f => f.name.toLowerCase().trim() === 'personal')
      const teamFolder = candidateFolders.find(f => f.name.toLowerCase().trim() === 'team')
      
      console.log('[FavoriteListItem] Personal folder:', personalFolder)
      console.log('[FavoriteListItem] Team folder:', teamFolder)
      
      const folderOptions = []
      
      // Add "Move to Team" if query is NOT in Team folder
      if (teamFolder && normalizeId(item.queryFolderId) !== normalizeId(teamFolder.id)) {
        console.log('[FavoriteListItem] Adding "Move to Team" option')
        folderOptions.push({
          name: "Move to Team",
          handler: ({ item }) => this.moveItem({ item, option: { folder: teamFolder } })
        })
      }
      
      // Add "Move to Personal" if query is NOT in Personal folder
      if (personalFolder && normalizeId(item.queryFolderId) !== normalizeId(personalFolder.id)) {
        console.log('[FavoriteListItem] Adding "Move to Personal" option')
        folderOptions.push({
          name: "Move to Personal",
          handler: ({ item }) => this.moveItem({ item, option: { folder: personalFolder } })
        })
      }
      
      console.log('[FavoriteListItem] Total folder options:', folderOptions.length)

      this.$bks.openMenu({
        item, event,
        options: [
          {
            name: "Open",
            handler: ({ item }) => this.$emit('open', item)
          },
          {
            name: "Rename",
            handler: ({ item }) => this.$emit('rename', item)
            
          },
          {
            name: "Delete",
            handler: ({ item }) => this.$emit('remove', item)
          },
          {
            type: 'divider'
          },
          {
            name: "Export",
            handler: ({ item }) => this.$emit('export', item)
          },
          ...(folderOptions.length > 0 ? [{ type: 'divider' }, ...folderOptions] : []),
        ]
      })
    },
  }
  
})
</script>