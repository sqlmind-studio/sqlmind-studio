export interface IWorkspace {
  id: number
  type: 'local' | 'cloud'
  name: string,
  logo?: string
  icon?: string
  trialEndsAt?: number
  trialEndsIn?: string
  active: boolean
  isOwner?: boolean
  level: string
  isAdmin?: boolean
  role?: string
}

export const LocalWorkspace: IWorkspace = {
  // can never exist in a real database
  id: -1,
  level: 'local',
  type: 'local',
  name: 'Local Workspace',
  icon: 'laptop',
  active: true

}