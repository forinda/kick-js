import { Service, Inject } from '@forinda/kickjs'
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../../domain/repositories/notification.repository'

@Service()
export class UnreadCountUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  async execute(recipientId: string) {
    return this.repo.unreadCount(recipientId)
  }
}
