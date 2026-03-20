import { Service, Inject } from '@forinda/kickjs-core'
import { NOTIFICATION_REPOSITORY, type INotificationRepository } from '../../domain/repositories/notification.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class ListNotificationsUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: INotificationRepository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
