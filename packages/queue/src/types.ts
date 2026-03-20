import 'reflect-metadata'

/** Options for configuring the QueueAdapter */
export interface QueueAdapterOptions {
  /** Redis connection configuration */
  redis: {
    host: string
    port: number
    password?: string
  }
  /** Queue names to pre-create (optional — queues are also created on-demand) */
  queues?: string[]
  /** Default worker concurrency (default: 1) */
  concurrency?: number
}

/** DI token for resolving the QueueService from the container */
export const QUEUE_MANAGER = Symbol('QueueManager')

/** Metadata keys for queue decorators */
export const QUEUE_METADATA = {
  JOB: Symbol('queue:job'),
  PROCESS: Symbol('queue:process'),
} as const

/** Metadata stored by @Process decorator */
export interface ProcessDefinition {
  /** Method name on the controller class */
  handlerName: string
  /** Job name to handle (undefined = handle all jobs in the queue) */
  jobName?: string
}

/** Global registry of @Job-decorated classes */
export const jobRegistry = new Set<any>()
