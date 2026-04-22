import { Service, Logger, Autowired } from '@forinda/kickjs';
import { Job, Process } from '@forinda/kickjs-queue';
import type { Job as BullMQJob } from 'bullmq';
import { MAILER, type MailerService } from '@forinda/kickjs-mailer';

const logger = Logger.for('EmailProcessor');

@Service()
@Job('email')
export class EmailProcessor {
  @Autowired(MAILER) private mailer!: MailerService;


  @Process('send-welcome-email')
  async sendWelcome(job: BullMQJob<{ email: string; firstName: string }>) {
    logger.info(`Sending welcome email to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `Welcome to Vibed, ${job.data.firstName}!`,
      html: `<h1>Welcome to Vibed!</h1><p>Hi ${job.data.firstName}, your account is ready.</p>`,
    });
  }

  @Process('send-task-assigned')
  async sendTaskAssigned(job: BullMQJob<{ email: string; taskKey: string; taskTitle: string; assignerName: string }>) {
    logger.info(`Sending task assigned email to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `You were assigned to ${job.data.taskKey}: ${job.data.taskTitle}`,
      html: `<p>${job.data.assignerName} assigned you to <strong>${job.data.taskKey}</strong>: ${job.data.taskTitle}</p>`,
    });
  }

  @Process('send-mentioned')
  async sendMentioned(job: BullMQJob<{ email: string; taskKey: string; mentionedBy: string }>) {
    logger.info(`Sending mention email to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `You were mentioned in ${job.data.taskKey}`,
      html: `<p>${job.data.mentionedBy} mentioned you in a comment on <strong>${job.data.taskKey}</strong></p>`,
    });
  }

  @Process('send-overdue-reminder')
  async sendOverdueReminder(job: BullMQJob<{ email: string; taskKey: string; taskTitle: string; dueDate: string }>) {
    logger.info(`Sending overdue reminder to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `Overdue: ${job.data.taskKey} - ${job.data.taskTitle}`,
      html: `<p>Task <strong>${job.data.taskKey}</strong>: ${job.data.taskTitle} was due on ${job.data.dueDate}</p>`,
    });
  }

  @Process('send-password-reset')
  async sendPasswordReset(job: BullMQJob<{ email: string; resetUrl: string }>) {
    logger.info(`Sending password reset to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: 'Reset your password',
      html: `<p>Click <a href="${job.data.resetUrl}">here</a> to reset your password.</p>`,
    });
  }

  @Process('send-workspace-invite')
  async sendWorkspaceInvite(job: BullMQJob<{ email: string; workspaceName: string; inviterName: string }>) {
    logger.info(`Sending workspace invite to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `You've been invited to ${job.data.workspaceName}`,
      html: `<p>${job.data.inviterName} invited you to join <strong>${job.data.workspaceName}</strong> on Vibed.</p>`,
    });
  }

  @Process('send-daily-digest')
  async sendDailyDigest(job: BullMQJob<{ email: string; summary: string }>) {
    logger.info(`Sending daily digest to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: 'Your Daily Vibed Digest',
      html: job.data.summary,
    });
  }
}
