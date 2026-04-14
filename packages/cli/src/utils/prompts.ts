import * as clack from '@clack/prompts'
import { colors } from './colors'

export const symbols = {
  success: colors.green('✓'),
  error: colors.red('✖'),
  warning: colors.yellow('⚠'),
  info: colors.blue('ℹ'),
}

/** Show branded intro banner */
export function intro(title: string): void {
  clack.intro(colors.bgCyan(colors.black(` ${title} `)))
}

/** Show closing message */
export function outro(message: string): void {
  clack.outro(message)
}

/** Handle cancellation — print message and exit */
function handleCancel(value: unknown): void {
  if (clack.isCancel(value)) {
    clack.cancel('Operation cancelled.')
    process.exit(0)
  }
}

/** Text input prompt */
export async function text(opts: {
  message: string
  placeholder?: string
  defaultValue?: string
  validate?: (value: string) => string | void
}): Promise<string> {
  const value = await clack.text(opts)
  handleCancel(value)
  return value as string
}

/** Single select prompt */
export async function select<T>(opts: {
  message: string
  options: { value: T; label: string; hint?: string }[]
  initialValue?: T
}): Promise<T> {
  const value = await clack.select(opts)
  handleCancel(value)
  return value as T
}

/** Multi-select prompt with checkboxes */
export async function multiSelect<T>(opts: {
  message: string
  options: { value: T; label: string; hint?: string }[]
  required?: boolean
  initialValues?: T[]
}): Promise<T[]> {
  const value = await clack.multiselect(opts)
  handleCancel(value)
  return value as T[]
}

/** Yes/no confirmation prompt */
export async function confirm(opts: {
  message: string
  active?: string
  inactive?: string
  initialValue?: boolean
}): Promise<boolean> {
  const value = await clack.confirm(opts)
  handleCancel(value)
  return value as boolean
}

/** Create a spinner for progress indication */
export function spinner() {
  return clack.spinner()
}

/** Log utilities for styled messages inside clack flow */
export const log = clack.log
