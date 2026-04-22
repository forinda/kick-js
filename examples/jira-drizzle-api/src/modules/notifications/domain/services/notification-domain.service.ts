import { Service, Inject, HttpException } from '@forinda/kickjs'
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../repositories/notification.repository'

@Service()
export class NotificationDomainService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  async ensureExists(id: string) {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Notification not found')
    }
    return entity
  }
}
