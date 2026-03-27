import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'

interface GenerateJobOptions {
  name: string
  outDir: string
  queue?: string
}

export async function generateJob(options: GenerateJobOptions): Promise<string[]> {
  const { name, outDir } = options
  const pascal = toPascalCase(name)
  const kebab = toKebabCase(name)
  const camel = toCamelCase(name)
  const queueName = options.queue ?? `${kebab}-queue`
  const files: string[] = []

  const write = async (relativePath: string, content: string) => {
    const fullPath = join(outDir, relativePath)
    await writeFileSafe(fullPath, content)
    files.push(fullPath)
  }

  await write(
    `${kebab}.job.ts`,
    `import { Inject } from '@forinda/kickjs-core'
import { Job, Process, QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue'

/**
 * ${pascal} Job Processor
 *
 * Decorators:
 *   @Job(queueName) — marks this class as a job processor for a queue
 *   @Process(jobName?) — marks a method as the handler for a specific job type
 *     - Without a name: handles all jobs in the queue
 *     - With a name: handles only jobs matching that name
 *
 * To add jobs to this queue from a service or controller:
 *   @Inject(QUEUE_MANAGER) private queue: QueueService
 *   await this.queue.add('${queueName}', '${camel}', { ... })
 */
@Job('${queueName}')
export class ${pascal}Job {
  @Process()
  async handle(job: { name: string; data: any; id?: string }) {
    console.log(\`Processing \${job.name} (id: \${job.id})\`, job.data)

    // TODO: Implement job logic here
    // Example:
    // await this.emailService.send(job.data.to, job.data.subject, job.data.body)
  }

  @Process('${camel}.priority')
  async handlePriority(job: { name: string; data: any; id?: string }) {
    console.log(\`Priority job: \${job.name}\`, job.data)
    // Handle high-priority variant of this job
  }
}
`,
  )

  return files
}
