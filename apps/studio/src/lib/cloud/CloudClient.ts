import { ConnectionsController } from '@/lib/cloud/controllers/ConnectionsController';
import { AxiosInstance, AxiosRequestTransformer, AxiosResponseTransformer } from 'axios'
import axios from 'axios'
import _ from 'lodash';
import rawLog from '@bksLogger'
import axiosRetry from 'axios-retry'

import { res } from './ClientHelpers';
import { QueriesController } from "./controllers/QueriesController";
import { WorkspacesController } from './controllers/WorkspacesController';
import { ConnectionFoldersController } from '@/lib/cloud/controllers/ConnectionFoldersController';
import { QueryFoldersController } from '@/lib/cloud/controllers/QueryFoldersController';
import { UsedQueriesController } from '@/lib/cloud/controllers/UsedQueriesController';
import { LicenseKeyController } from './controllers/LicenseKeyController';
import { camelCaseObjectKeys, snakeCaseObjectKeys } from '@/common/utils';
import { CloudConfig } from './config';

import { IPlatformInfo } from '@/common/IPlatformInfo';

const log = rawLog.scope('cloudClient')

const ad = axios.defaults

const defaultTransformRequest = ad.transformRequest as AxiosRequestTransformer[]
const defaultTransformResponse = ad.transformResponse as AxiosResponseTransformer[]

const snakeCaseData: AxiosRequestTransformer = (data) => {
  return snakeCaseObjectKeys(data)
}

const camelCaseData: AxiosResponseTransformer = (data) => {
  return camelCaseObjectKeys(data)
}


export interface CloudClientOptions {
  token: string,
  app: string,
  email: string
  baseUrl: string,
  workspace?: number
}


const staticAxios = (baseUrl) => axios.create({
  baseURL: baseUrl,
  timeout: 5000,
  transformRequest: [snakeCaseData, ...defaultTransformRequest],
  transformResponse: [...defaultTransformResponse, camelCaseData],
  validateStatus: (status) => status < 500
})


export class CloudClient {
  static async login(baseUrl, email, password, app): Promise<string> {
    const cli = staticAxios(baseUrl)

    try {
      // Use the new authentication endpoint
      const response = await cli.post('/api/auth/signin', {
        email, 
        password
      }, {
        headers: {
          'X-Plugin-Secret': CloudConfig.getPluginSecret()
        }
      })

      // Check if response is successful
      if (response.status === 200 && response.data?.success) {
        // Return the JWT token directly from your API response
        return response.data.token
      }

      // Handle error responses
      const errorMsg = response.data?.error || response.data?.message || 'Authentication failed'
      throw new Error(errorMsg)
    } catch (error) {
      // Handle network errors or API errors
      if (error.response) {
        // API returned an error response
        const errorMsg = error.response.data?.error || error.response.data?.message || 'Authentication failed'
        throw new Error(errorMsg)
      } else if (error.request) {
        // Request was made but no response received
        throw new Error('Network error: Unable to connect to authentication server')
      } else {
        // Something else happened
        throw error
      }
    }
  }


  public static async getLicense(baseUrl: string, email: string, key: string, installationId = "", platformInfo: IPlatformInfo, deviceId = "", deviceName = "", deviceOS = "") {
    const controller = new LicenseKeyController(staticAxios(baseUrl))
    log.info("Fetching license info! Installation id", installationId, "Device id", deviceId)
    return await controller.get(email, key, installationId, platformInfo, deviceId, deviceName, deviceOS)
  }

  axios: AxiosInstance
  public queries: QueriesController
  public connections: ConnectionsController
  public connectionFolders: ConnectionFoldersController
  public queryFolders: QueryFoldersController
  public usedQueries: UsedQueriesController
  public workspaces: WorkspacesController
  public workspaceId: number
  constructor(public options: CloudClientOptions) {
    this.axios = axios.create({
      baseURL: `${options.baseUrl}/api`,
      timeout: 5000,
      transformRequest: [snakeCaseData, ...defaultTransformRequest],
      transformResponse: [...defaultTransformResponse, camelCaseData],
      headers: {
        email: options.email,
        token: options.token,
        app: options.app
      },
      validateStatus: (status) => status < 500
    })

    axiosRetry(this.axios, { retries: 3, retryDelay: () => 2000, shouldResetTimeout: true})

    this.queries = new QueriesController(this.axios)
    this.connections = new ConnectionsController(this.axios)
    this.connectionFolders = new ConnectionFoldersController(this.axios)
    this.queryFolders = new QueryFoldersController(this.axios)
    this.workspaces = new WorkspacesController(this.axios)
    this.usedQueries = new UsedQueriesController(this.axios)

    this.axios.interceptors.request.use(request => {
      log.debug('REQ', JSON.stringify(request, null, 2))
      return request
    })

    this.axios.interceptors.response.use(response => {
      log.debug('RES:', JSON.stringify(response, null, 2))
      return response
    })

    if (options.workspace) {
      this.setWorkspace(options.workspace)
    }
  }

  cloneWithWorkspace(workspace: number): CloudClient {
    return new CloudClient({...this.options, workspace})
  }

  setWorkspace(workspaceId: number) {
    this.workspaceId = workspaceId
    if (!this.axios.defaults.params) this.axios.defaults.params = {}
    this.axios.defaults.params['workspace_id'] = workspaceId
  }

  async validateToken() {
    const response = await this.axios.get('/check')
    return res(response, 'valid')
  }

}
