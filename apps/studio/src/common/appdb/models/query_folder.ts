import { IQueryFolder } from '@/common/interfaces/IQueryFolder'
import { Entity, Column } from 'typeorm'
import { ApplicationEntity } from './application_entity'

@Entity({ name: 'query_folder' })
export class QueryFolder extends ApplicationEntity implements IQueryFolder {
  withProps(props?: any): QueryFolder {
    if (props) QueryFolder.merge(this, props);
    return this;
  }

  @Column({ type: "varchar", nullable: false })
  name!: string

  @Column({ type: "varchar", nullable: true })
  description?: string | null

  @Column({ type: "int", nullable: false, default: -1 })
  workspaceId!: number
}
