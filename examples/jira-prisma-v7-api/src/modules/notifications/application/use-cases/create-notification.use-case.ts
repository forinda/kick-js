import { Service, Inject } from '@forinda/kickjs'
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../../domain/repositories/notification.repository'
import type { CreateNotificationDTO } from '../dtos/create-notification.dto'

@Service()
export class CreateNotificationUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  async execute(dto: CreateNotificationDTO) {
    return this.repo.create(dto)
  }
}
