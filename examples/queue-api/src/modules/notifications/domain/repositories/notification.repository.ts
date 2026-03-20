/**
 * Notification Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { NotificationResponseDTO } from '../../application/dtos/notification-response.dto'
import type { CreateNotificationDTO } from '../../application/dtos/create-notification.dto'
import type { UpdateNotificationDTO } from '../../application/dtos/update-notification.dto'
import type { ParsedQuery } from '@forinda/kickjs-http'

export interface INotificationRepository {
  findById(id: string): Promise<NotificationResponseDTO | null>
  findAll(): Promise<NotificationResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: NotificationResponseDTO[]; total: number }>
  create(dto: CreateNotificationDTO): Promise<NotificationResponseDTO>
  update(id: string, dto: UpdateNotificationDTO): Promise<NotificationResponseDTO>
  delete(id: string): Promise<void>
}

export const NOTIFICATION_REPOSITORY = Symbol('INotificationRepository')
