import 'reflect-metadata'
import { Service } from '@forinda/kickjs-core'
import { QUEUE_METADATA, jobRegistry, type ProcessDefinition } from './types'

/**
 * Mark a class as a job processor for a specific BullMQ queue.
 *
 * The class is automatically registered in the DI container and will
 * be discovered by the QueueAdapter during startup.
 *
 * @param queueName - The name of the BullMQ queue this class processes
 *
 * @example
 * ```ts
 * @Job('email')
 * export class EmailJobProcessor {
 *   @Process('welcome')
 *   async sendWelcome(job: BullMQJob) {
 *     await sendEmail(job.data.to, 'Welcome!')
 *   }
 *
 *   @Process()
 *   async handleAll(job: BullMQJob) {
 *     console.log('Fallback handler for:', job.name)
 *   }
 * }
 * ```
 */
export function Job(queueName: string): ClassDecorator {
  return (target: any) => {
    Service()(target)
    Reflect.defineMetadata(QUEUE_METADATA.JOB, queueName, target)
    jobRegistry.add(target)
  }
}

/**
 * Mark a method as a job processor within a @Job class.
 *
 * @param jobName - Specific job name to handle. Omit to handle all jobs in the queue.
 *
 * @example
 * ```ts
 * @Job('notifications')
 * export class NotificationProcessor {
 *   @Process('push')
 *   async handlePush(job: BullMQJob) { ... }
 *
 *   @Process('sms')
 *   async handleSms(job: BullMQJob) { ... }
 *
 *   @Process()
 *   async handleDefault(job: BullMQJob) { ... }
 * }
 * ```
 */
export function Process(jobName?: string): MethodDecorator {
  return (target, propertyKey) => {
    const handlers: ProcessDefinition[] =
      Reflect.getMetadata(QUEUE_METADATA.PROCESS, target.constructor) || []
    handlers.push({
      handlerName: propertyKey as string,
      jobName,
    })
    Reflect.defineMetadata(QUEUE_METADATA.PROCESS, handlers, target.constructor)
  }
}
