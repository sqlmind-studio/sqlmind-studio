import { OpenTab } from "@/common/appdb/models/OpenTab";
import { TransportOpenTab } from "@/common/transport/TransportOpenTab";

interface ConnectionIds {
  connectionId: number,
  workspaceId: number
}

export interface ITabHistoryHandlers {
  'appdb/tabhistory/get': (connectionIds: ConnectionIds, limit?: number) => Promise<TransportOpenTab[]>
  'appdb/tabhistory/getLastDeletedTab': (connectionIds: ConnectionIds) => Promise<TransportOpenTab>
  'appdb/tabhistory/clearDeletedTabs': (connectionIds: ConnectionIds, xDays?: number) => Promise<void>
}

export const TabHistoryHandlers: ITabHistoryHandlers = {
  'appdb/tabhistory/get': async (connectionIds, limit = 10): Promise<TransportOpenTab[]> => {
    return await OpenTab.getHistory(connectionIds, limit) 
  },
  'appdb/tabhistory/getLastDeletedTab': async (connectionIds): Promise<TransportOpenTab> => {
    return await OpenTab.getClosedHistory(connectionIds) 
  },
  'appdb/tabhistory/clearDeletedTabs': async (connectionIds: ConnectionIds, xDays = 7): Promise<void> => {
    return await OpenTab.clearOldDeletedTabs(connectionIds, xDays) 
  }
}