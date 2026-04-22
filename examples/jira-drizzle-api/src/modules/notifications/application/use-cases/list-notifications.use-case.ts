import { Service, Inject } from '@forinda/kickjs'
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../../domain/repositories/notification.repository'
import type { ParsedQuery } from '@forinda/kickjs'

@Service()
export class ListNotificationsUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  async execute(parsed: ParsedQuery, recipientId: string) {
    return this.repo.findPaginated(parsed, recipientId)
  }
}
