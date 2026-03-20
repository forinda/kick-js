/**
 * Create Notification Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs-core'
import { NOTIFICATION_REPOSITORY, type INotificationRepository } from '../../domain/repositories/notification.repository'
import type { CreateNotificationDTO } from '../dtos/create-notification.dto'
import type { NotificationResponseDTO } from '../dtos/notification-response.dto'

@Service()
export class CreateNotificationUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: INotificationRepository,
  ) {}

  async execute(dto: CreateNotificationDTO): Promise<NotificationResponseDTO> {
    return this.repo.create(dto)
  }
}
