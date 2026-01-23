import { ref } from 'vue';

/**
 * User context for AI usage logging
 * This should be set by the main app via postMessage
 */

const tenantId = ref<string | undefined>(undefined);
const userId = ref<string | undefined>(undefined);
const workspaceId = ref<string | undefined>(undefined);
const connectionId = ref<string | undefined>(undefined);

export function useUserContext() {
  const setUserContext = (context: {
    tenantId?: string;
    userId?: string;
    workspaceId?: string;
    connectionId?: string;
  }) => {
    if (context.tenantId) tenantId.value = context.tenantId;
    if (context.userId) userId.value = context.userId;
    if (context.workspaceId) workspaceId.value = context.workspaceId;
    if (context.connectionId) connectionId.value = context.connectionId;
    
    console.log('[UserContext] Updated:', {
      tenantId: tenantId.value,
      userId: userId.value,
      workspaceId: workspaceId.value,
      connectionId: connectionId.value,
    });
  };

  const getUserContext = () => ({
    tenantId: tenantId.value,
    userId: userId.value,
    workspaceId: workspaceId.value,
    connectionId: connectionId.value,
  });

  return {
    tenantId,
    userId,
    workspaceId,
    connectionId,
    setUserContext,
    getUserContext,
  };
}
