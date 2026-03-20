import { Job, Process } from '@forinda/kickjs-queue'

@Job('report-queue')
export class ReportJob {
  @Process()
  async handle(job: { name: string; data: { type: string }; id?: string }) {
    console.log(`Generating report: ${job.data.type}`)
  }
}
