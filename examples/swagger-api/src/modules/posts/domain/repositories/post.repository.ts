/**
 * Post Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { PostResponseDTO } from '../../application/dtos/post-response.dto'
import type { CreatePostDTO } from '../../application/dtos/create-post.dto'
import type { UpdatePostDTO } from '../../application/dtos/update-post.dto'

export interface IPostRepository {
  findById(id: string): Promise<PostResponseDTO | null>
  findAll(): Promise<PostResponseDTO[]>
  create(dto: CreatePostDTO): Promise<PostResponseDTO>
  update(id: string, dto: UpdatePostDTO): Promise<PostResponseDTO>
  delete(id: string): Promise<void>
}

export const POST_REPOSITORY = Symbol('IPostRepository')
