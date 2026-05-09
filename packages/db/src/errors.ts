export class KickDbError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = this.constructor.name
    this.code = code
  }
}

/**
 * Thrown by `kick db generate` when the diff would emit a
 * `removeEnumValue` change against a column whose default is one of
 * the values being removed. The rename-recreate dance preserves
 * column DEFAULTs through the type swap (M5.A.1), but it can't
 * preserve a default that's no longer in the enum's value list — the
 * `SET DEFAULT 'X'::"foo"` step would fail at apply time.
 *
 * The operator's options: change the column's default in the schema
 * to a value that survives the removal, or drop the default entirely.
 *
 * Spec: docs/db/spec-default-preservation.md.
 */
export class RemovedValueAsDefaultError extends KickDbError {
  readonly enum: string
  readonly table: string
  readonly column: string
  readonly value: string

  constructor(enumName: string, table: string, column: string, value: string) {
    super(
      'removed_value_as_default',
      `Cannot remove value '${value}' from enum '${enumName}': the column ` +
        `${table}.${column} declares it as the default. Update the column's ` +
        `default to a surviving enum value (or drop the default) before ` +
        `re-running \`kick db generate\`.`,
    )
    this.enum = enumName
    this.table = table
    this.column = column
    this.value = value
  }
}
