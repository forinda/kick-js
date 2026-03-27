import { Service, Inject } from '@forinda/kickjs-core'
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../../domain/repositories/notification.repository'

@Service()
export class MarkNotificationReadUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  async execute(id: string) {
    await this.repo.markRead(id)
  }
}
