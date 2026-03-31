/**
 * Cat Repository Interface
 *
 * Defines the contract for data access.
 * The interface declares what operations are available;
 * implementations (in-memory, Drizzle, Prisma) fulfill the contract.
 *
 * To swap implementations, change the factory in the module's register() method.
 */
import type { CatResponseDTO } from '../../application/dtos/cat-response.dto'
import type { CreateCatDTO } from '../../application/dtos/create-cat.dto'
import type { UpdateCatDTO } from '../../application/dtos/update-cat.dto'
import type { ParsedQuery } from '@forinda/kickjs'

export interface ICatRepository {
  findById(id: string): Promise<CatResponseDTO | null>
  findAll(): Promise<CatResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: CatResponseDTO[]; total: number }>
  create(dto: CreateCatDTO): Promise<CatResponseDTO>
  update(id: string, dto: UpdateCatDTO): Promise<CatResponseDTO>
  delete(id: string): Promise<void>
}

export const CAT_REPOSITORY = Symbol('ICatRepository')
