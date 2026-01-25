import { IQueryFolder } from "@/common/interfaces/IQueryFolder";
import { DataState, DataStore, mutationsFor } from "@/store/modules/data/DataModuleBase";
import { safely } from "@/store/modules/data/StoreHelpers";
import Vue from "vue";

interface State extends DataState<IQueryFolder> {
  unsupported: boolean
}

export const LocalQueryFolderModule: DataStore<IQueryFolder, State> = {
  namespaced: true,
  state: {
    items: [],
    loading: false,
    error: null,
    unsupported: false, // Enable query folders for local workspace
    pollError: null
  },
  mutations: mutationsFor<IQueryFolder>({}),
  actions: {
    async load(context) {
      context.commit("error", null);
      await safely(context, async () => {
        // Load folders from local SQLite database
        const items = await Vue.prototype.$util.send(`appdb/query_folder/find`, {});
        
        // If no folders exist, create default Personal and Team folders
        if (!items || items.length === 0) {
          console.log('[LocalQueryFolderModule] No folders found, creating defaults');
          const workspaceId = context.rootState.workspaceId;
          
          const personalFolder = await Vue.prototype.$util.send(`appdb/query_folder/save`, {
            obj: {
              id: null,
              name: 'Personal',
              workspaceId: workspaceId,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });
          
          const teamFolder = await Vue.prototype.$util.send(`appdb/query_folder/save`, {
            obj: {
              id: null,
              name: 'Team',
              workspaceId: workspaceId,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });
          
          context.commit('upsert', [personalFolder, teamFolder]);
          console.log('[LocalQueryFolderModule] Created default folders:', { personalFolder, teamFolder });
        } else {
          context.commit('upsert', items);
          console.log('[LocalQueryFolderModule] Loaded folders:', items.length);
        }
      });
    },
    async poll() {
      // Local storage doesn't need polling
    },
    async save(context, item) {
      const updated = await Vue.prototype.$util.send(`appdb/query_folder/save`, { obj: item });
      context.commit('upsert', updated);
      return updated.id;
    },
    async remove(context, item) {
      await Vue.prototype.$util.send(`appdb/query_folder/remove`, { obj: item });
      context.commit('remove', item);
    },
    async clone(_c, item) {
      const cloned = { ...item, id: null, createdAt: null };
      return cloned;
    },
    async reload(context, id) {
      const items = await Vue.prototype.$util.send(`appdb/query_folder/find`, {});
      const item = items.find((i: IQueryFolder) => i.id === id);
      if (item) {
        context.commit('upsert', item);
      }
      return item || null;
    },
    async clearError(context) {
      context.commit('error', null);
    }
  }
}
