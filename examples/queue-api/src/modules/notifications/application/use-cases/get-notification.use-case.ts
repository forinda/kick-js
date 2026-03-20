import { Service, Inject } from '@forinda/kickjs-core'
import { NOTIFICATION_REPOSITORY, type INotificationRepository } from '../../domain/repositories/notification.repository'
import type { NotificationResponseDTO } from '../dtos/notification-response.dto'

@Service()
export class GetNotificationUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: INotificationRepository,
  ) {}

  async execute(id: string): Promise<NotificationResponseDTO | null> {
    return this.repo.findById(id)
  }
}
