import { Service, Inject } from '@forinda/kickjs'
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../../domain/repositories/notification.repository'

@Service()
export class MarkAllNotificationsReadUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  async execute(recipientId: string) {
    await this.repo.markAllRead(recipientId)
  }
}
