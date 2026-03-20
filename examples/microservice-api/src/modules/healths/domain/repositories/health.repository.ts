/**
 * Health Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { HealthResponseDTO } from '../../application/dtos/health-response.dto'
import type { CreateHealthDTO } from '../../application/dtos/create-health.dto'
import type { UpdateHealthDTO } from '../../application/dtos/update-health.dto'
import type { ParsedQuery } from '@forinda/kickjs-http'

export interface IHealthRepository {
  findById(id: string): Promise<HealthResponseDTO | null>
  findAll(): Promise<HealthResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: HealthResponseDTO[]; total: number }>
  create(dto: CreateHealthDTO): Promise<HealthResponseDTO>
  update(id: string, dto: UpdateHealthDTO): Promise<HealthResponseDTO>
  delete(id: string): Promise<void>
}

export const HEALTH_REPOSITORY = Symbol('IHealthRepository')
