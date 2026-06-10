import { describe, it, expect } from 'vitest'
import { emitMysql } from '@forinda/kickjs-db'
import type { ChangeSet } from '@forinda/kickjs-db'

const col = (over: Partial<import('@forinda/kickjs-db').ColumnSnapshot> = {}) => ({
  name: 'c',
  type: 'text',
  nullable: true,
  default: null,
  primaryKey: false,
  ...over,
})

describe('emitMysql — CREATE TABLE', () => {
  it('maps PG types to MySQL + backtick idents + normalises defaults', () => {
    const cs: ChangeSet = [
      {
        kind: 'createTable',
        table: {
          name: 'tasks',
          columns: {
            id: col({
              name: 'id',
              type: 'uuid',
              nullable: false,
              primaryKey: true,
              default: 'gen_random_uuid()',
            }),
            title: col({ name: 'title', type: 'varchar(200)', nullable: false }),
            done: col({ name: 'done', type: 'boolean', nullable: false, default: 'false' }),
            createdAt: col({
              name: 'createdAt',
              type: 'timestamp',
              nullable: false,
              default: 'CURRENT_TIMESTAMP',
            }),
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    ]
    expect(emitMysql(cs)).toBe(
      'CREATE TABLE `tasks` (\n' +
        '  `id` CHAR(36) NOT NULL DEFAULT (UUID()),\n' +
        '  `title` VARCHAR(200) NOT NULL,\n' +
        '  `done` TINYINT(1) NOT NULL DEFAULT 0,\n' +
        '  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n' +
        '  PRIMARY KEY (`id`)\n' +
        ');',
    )
  })

  it('inlines a serial PK as AUTO_INCREMENT PRIMARY KEY', () => {
    const cs: ChangeSet = [
      {
        kind: 'createTable',
        table: {
          name: 'nums',
          columns: { id: col({ name: 'id', type: 'serial', nullable: false, primaryKey: true }) },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    ]
    expect(emitMysql(cs)).toBe(
      'CREATE TABLE `nums` (\n  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY\n);',
    )
  })
})

describe('emitMysql — ALTER (full support)', () => {
  it('add / drop / rename column', () => {
    expect(
      emitMysql([
        {
          kind: 'addColumn',
          table: 'tasks',
          column: col({ name: 'priority', type: 'integer', nullable: false, default: '0' }),
        },
      ]),
    ).toBe('ALTER TABLE `tasks` ADD COLUMN `priority` INT NOT NULL DEFAULT 0;')

    expect(
      emitMysql([{ kind: 'dropColumn', table: 'tasks', column: col({ name: 'priority' }) }]),
    ).toBe('ALTER TABLE `tasks` DROP COLUMN `priority`;')

    expect(emitMysql([{ kind: 'renameColumn', table: 'tasks', from: 'a', to: 'b' }])).toBe(
      'ALTER TABLE `tasks` RENAME COLUMN `a` TO `b`;',
    )
  })

  it('alterColumn restates the column via MODIFY COLUMN', () => {
    expect(
      emitMysql([
        {
          kind: 'alterColumn',
          table: 'tasks',
          column: 'title',
          before: col({ name: 'title', type: 'varchar(50)', nullable: true }),
          after: col({ name: 'title', type: 'varchar(200)', nullable: false }),
        },
      ]),
    ).toBe('ALTER TABLE `tasks` MODIFY COLUMN `title` VARCHAR(200) NOT NULL;')
  })

  it('index + foreign key statements use MySQL syntax', () => {
    expect(
      emitMysql([
        {
          kind: 'addIndex',
          table: 'tasks',
          index: { name: 'tasks_done_idx', columns: ['done'], unique: false },
        },
      ]),
    ).toBe('CREATE INDEX `tasks_done_idx` ON `tasks` (`done`);')

    expect(
      emitMysql([
        {
          kind: 'dropIndex',
          table: 'tasks',
          index: { name: 'tasks_done_idx', columns: ['done'], unique: false },
        },
      ]),
    ).toBe('DROP INDEX `tasks_done_idx` ON `tasks`;')

    expect(
      emitMysql([
        {
          kind: 'addForeignKey',
          table: 'posts',
          fk: {
            name: 'posts_author_fk',
            columns: ['authorId'],
            refTable: 'users',
            refColumns: ['id'],
            onDelete: 'cascade',
            onUpdate: 'no_action',
          },
        },
      ]),
    ).toBe(
      'ALTER TABLE `posts` ADD CONSTRAINT `posts_author_fk` FOREIGN KEY (`authorId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;',
    )

    expect(
      emitMysql([
        {
          kind: 'dropForeignKey',
          table: 'posts',
          fk: {
            name: 'posts_author_fk',
            columns: ['authorId'],
            refTable: 'users',
            refColumns: ['id'],
            onDelete: 'cascade',
            onUpdate: 'no_action',
          },
        },
      ]),
    ).toBe('ALTER TABLE `posts` DROP FOREIGN KEY `posts_author_fk`;')
  })
})
