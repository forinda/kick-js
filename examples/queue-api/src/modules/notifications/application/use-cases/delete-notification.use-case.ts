import { Service, Inject } from '@forinda/kickjs-core'
import { NOTIFICATION_REPOSITORY, type INotificationRepository } from '../../domain/repositories/notification.repository'

@Service()
export class DeleteNotificationUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: INotificationRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
