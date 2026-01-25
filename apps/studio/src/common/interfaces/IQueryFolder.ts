import { Transport } from "@/common/transport";

export interface IFolder extends Transport {
  id: number | null
  name: string
  description?: string | null
  workspaceId?: number
  createdAt: Date
  updatedAt: Date
  version: number
}

export type IQueryFolder = IFolder

export type IConnectionFolder = IFolder