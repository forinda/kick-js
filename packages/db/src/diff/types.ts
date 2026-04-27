import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  TableSnapshot,
} from '../snapshot/types'

export interface CreateTable {
  kind: 'createTable'
  table: TableSnapshot
}

export interface DropTable {
  kind: 'dropTable'
  table: TableSnapshot
}

export interface RenameTable {
  kind: 'renameTable'
  from: string
  to: string
}

export interface AddColumn {
  kind: 'addColumn'
  table: string
  column: ColumnSnapshot
}

export interface DropColumn {
  kind: 'dropColumn'
  table: string
  column: ColumnSnapshot
}

export interface RenameColumn {
  kind: 'renameColumn'
  table: string
  from: string
  to: string
}

export interface AlterColumn {
  kind: 'alterColumn'
  table: string
  column: string
  before: ColumnSnapshot
  after: ColumnSnapshot
}

export interface AddIndex {
  kind: 'addIndex'
  table: string
  index: IndexSnapshot
}

export interface DropIndex {
  kind: 'dropIndex'
  table: string
  index: IndexSnapshot
}

export interface AddForeignKey {
  kind: 'addForeignKey'
  table: string
  fk: ForeignKeySnapshot
}

export interface DropForeignKey {
  kind: 'dropForeignKey'
  table: string
  fk: ForeignKeySnapshot
}

export type Change =
  | CreateTable
  | DropTable
  | RenameTable
  | AddColumn
  | DropColumn
  | RenameColumn
  | AlterColumn
  | AddIndex
  | DropIndex
  | AddForeignKey
  | DropForeignKey

export type ChangeSet = Change[]
