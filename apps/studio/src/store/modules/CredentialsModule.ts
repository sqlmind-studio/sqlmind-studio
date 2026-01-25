import { IWorkspace, LocalWorkspace } from "@/common/interfaces/IWorkspace";
import { CloudClient, CloudClientOptions } from "@/lib/cloud/CloudClient";
import { sendUserContextToPlugin } from "@/lib/aiUserContext";
import { uuidv4 } from "@/lib/uuid";
import { Module } from "vuex";
import { State as RootState } from '../index'
import { upsert } from "./data/StoreHelpers";
import Vue from "vue";
import { TransportCloudCredential } from "@/common/transport";

function genAppId() {
  return `sqlmind-app-${uuidv4()}`
}

export interface WSWithClient {
  workspace: IWorkspace,
  client: CloudClient
}

export interface CredentialBlob {
  id: number
  credential: TransportCloudCredential
  error?: Error
  client: CloudClient
  workspaces: IWorkspace[]
}

interface State {
  credentials: CredentialBlob[]
  loading: boolean
}

const GUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function extractWorkspaceGuid(workspace?: any) {
  if (!workspace) return undefined;
  const candidate = workspace?.cloudId
    || workspace?.originalId
    || (typeof workspace?.id === 'string' ? workspace.id : undefined);
  if (typeof candidate === 'string' && GUID_REGEX.test(candidate)) {
    return candidate.toUpperCase();
  }
  return undefined;
}

function updateAIUserContext(token: string | null | undefined, email?: string | null, workspaces?: IWorkspace[]) {
  if (!token) return;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return;
    const payloadJson = atob(parts[1]);
    const payload = JSON.parse(payloadJson);

    localStorage.setItem('authToken', token);

    const effectiveTenantId = payload.ownerTenantId || payload.tenantId;
    if (effectiveTenantId) {
      localStorage.setItem('tenantId', effectiveTenantId);
      console.log('[AI Context] Stored tenantId:', effectiveTenantId);
    }

    if (payload.userId) {
      localStorage.setItem('userId', payload.userId);
      console.log('[AI Context] Stored userId:', payload.userId);
    }

    if (email) {
      localStorage.setItem('userEmail', email);
    }

    const firstWorkspace = workspaces?.[0];
    const workspaceGuid = extractWorkspaceGuid(firstWorkspace);
    if (workspaceGuid) {
      localStorage.setItem('workspaceId', workspaceGuid);
      console.log('[AI Context] Stored workspaceId:', workspaceGuid);
    }

    setTimeout(() => sendUserContextToPlugin(), 0);
  } catch (err) {
    console.warn('[AI Context] Failed to update context from token:', err);
  }
}

async function credentialToBlob(c: TransportCloudCredential): Promise<CredentialBlob> {
  const clientOptions: CloudClientOptions = {
    app: c.appId, email: c.email, token: c.token, baseUrl: window.platformInfo.cloudUrl
  }
  const client = new CloudClient(clientOptions)
  try {
    const workspaces = await client.workspaces.list()
    
    console.log('[CredentialsModule] Received workspaces from API:', workspaces)
    workspaces.forEach(ws => {
      console.log('[CredentialsModule] Workspace:', {
        id: ws.id,
        idType: typeof ws.id,
        name: ws.name,
        cloudId: ws.cloudId
      })
    })

    return {
      id: c.id,
      credential: c,
      client,
      workspaces,
      error: undefined
    }
  } catch (error) {
    return {
      id: c.id,
      credential: c,
      client,
      workspaces: [],
      error
    }
  }
}


export const CredentialsModule: Module<State, RootState> = {
  namespaced: true,
  state: {
    credentials: [],
    loading: false,
  },
  getters: {
    clients(state): CloudClient[] {
      return state.credentials.map((cred) => cred.client)
    },
    workspaces(state): WSWithClient[] {
      const c: CredentialBlob[] = state.credentials
      const result = c.flatMap((cred) => {
        return cred.workspaces.map((ws) => ({
          workspace: ws, client: cred.client
        }))
      })
      return [
        { workspace: LocalWorkspace, client: null },
        ...result
      ]
    },
    activeWorkspaces(state) {
      return state.credentials.flatMap((cred) => {
        return cred.workspaces.filter((ws: IWorkspace) => ws.active)
      })
    },
  },
  mutations: {
    loading(state, loading: boolean)  {
      state.loading = loading
    },
    replace(state, creds: CredentialBlob[]) {
      state.credentials = creds
    },
    add(state, cred: CredentialBlob) {
      upsert(state.credentials, cred)
    },
    pushWorkspace(state, payload: { blobId: number, workspace: IWorkspace }) {
      state.credentials
        .find((c) => c.id === payload.blobId)
        ?.workspaces.push(payload.workspace)
    },
    renameWorkspace(state, payload: { workspace: IWorkspace, name: string }) {
      state.credentials.forEach((c) => c.workspaces.forEach((ws) => {
        if (ws.id === payload.workspace.id) {
          ws.name = payload.name
        }
      }))
    },
  },

  actions: {
    async load(context) {
      context.commit('loading', true)
      try {
        const creds = await Vue.prototype.$util.send('appdb/credential/find');
        const results: CredentialBlob[] = []
        for (let index = 0; index < creds.length; index++) {
          const c = creds[index];
          const r = await credentialToBlob(c)
          results.push(r)
        }
        context.commit('replace', results)
        const firstWithToken = results.find(r => r?.credential?.token)
        if (firstWithToken?.credential?.token) {
          updateAIUserContext(firstWithToken.credential.token, firstWithToken.credential.email, firstWithToken.workspaces)
        }
      } finally {
        context.commit('loading', false)
        context.dispatch('setUserWorkspace')
      }
    },
    async login(context, { email, password }) {
      const existing = await Vue.prototype.$util.send('appdb/credential/findOne', { email })
      const appId = (await Vue.prototype.$util.send('appdb/credential/findOne', {}))?.appId || genAppId()
      let cred: TransportCloudCredential = existing || {
        appId: null,
        email: null,
        token: null
      };
      cred.appId = appId
      cred.email = email

      const token = await CloudClient.login(window.platformInfo.cloudUrl, email, password, appId )
      cred.token = token
      cred = await Vue.prototype.$util.send('appdb/credential/save', { obj: cred })
      const result = await credentialToBlob(cred)
      context.commit('add', result)
      context.dispatch('setUserWorkspace')
      updateAIUserContext(token, email, result.workspaces)
    },
    async logout(context, blob: CredentialBlob) {
      await Vue.prototype.$util.send('appdb/credential/remove', { obj: blob.credential });
      
      // Set logout flag to prevent fallback tenantId from being used
      localStorage.setItem('hasLoggedOut', 'true');
      
      // Clear AI context from localStorage
      localStorage.removeItem('authToken');
      localStorage.removeItem('tenantId');
      localStorage.removeItem('userId');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('workspaceId');
      console.log('[CredentialsModule] Cleared AI context from localStorage and set logout flag');
      
      await context.dispatch('load')
      await context.commit('workspaceId', -1, { root: true })
      
      // Send updated context to plugin (will now return undefined for tenantId)
      setTimeout(() => sendUserContextToPlugin(), 0);
    },
    async setUserWorkspace(context) {
      const settingsResponse = context.rootGetters['settings/lastUsedWorkspace']
      if (!settingsResponse) return
      const lastUsedWorkspace = settingsResponse.value
      const { workspaces } = context.getters

      if (lastUsedWorkspace !== -1 && workspaces.length > 1) {
        if (workspaces.filter(v => v?.workspace?.id === lastUsedWorkspace) != null) context.commit('workspaceId', lastUsedWorkspace, { root: true })
      }
    },
    async createWorkspace(context, payload: { blobId: number, name: string }) {
      const client = context.state.credentials.find((c) => c.id === payload.blobId).client
      const workspace = await client.workspaces.create({
        name: payload.name,
      } as IWorkspace)
      context.commit('pushWorkspace', { blobId: payload.blobId, workspace })
    },
    async renameWorkspace(context, payload: { client: CloudClient, workspace: IWorkspace, name: string }) {
      const workspace = await payload.client.workspaces.update({
        ...payload.workspace,
        name: payload.name,
      })
      context.commit('renameWorkspace', { workspace, name: payload.name })
    },
  }
}
