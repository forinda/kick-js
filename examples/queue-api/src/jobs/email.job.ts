import { Job, Process } from '@forinda/kickjs-queue'

@Job('email-queue')
export class EmailJob {
  @Process()
  async handle(job: { name: string; data: { to: string; subject: string }; id?: string }) {
    console.log(`Sending email to ${job.data.to}: ${job.data.subject}`)
  }
}
