import { Service, Inject } from '@forinda/kickjs-core'
import { NOTIFICATION_REPOSITORY, type INotificationRepository } from '../../domain/repositories/notification.repository'
import type { UpdateNotificationDTO } from '../dtos/update-notification.dto'
import type { NotificationResponseDTO } from '../dtos/notification-response.dto'

@Service()
export class UpdateNotificationUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: INotificationRepository,
  ) {}

  async execute(id: string, dto: UpdateNotificationDTO): Promise<NotificationResponseDTO> {
    return this.repo.update(id, dto)
  }
}
