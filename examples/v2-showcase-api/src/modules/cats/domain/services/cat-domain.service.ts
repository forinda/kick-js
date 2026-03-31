/**
 * Cat Domain Service
 *
 * Domain layer — contains business rules that don't belong to a single entity.
 * Use this for cross-entity logic, validation rules, and domain invariants.
 * Keep it free of HTTP/framework concerns.
 */
import { Service, Inject, HttpException } from '@forinda/kickjs'
import { CAT_REPOSITORY, type ICatRepository } from '../repositories/cat.repository'

@Service()
export class CatDomainService {
  constructor(
    @Inject(CAT_REPOSITORY) private readonly repo: ICatRepository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Cat not found')
    }
  }
}
