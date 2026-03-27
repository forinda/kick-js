/**
 * Products Domain Service
 *
 * Domain layer — contains business rules that don't belong to a single entity.
 * Use this for cross-entity logic, validation rules, and domain invariants.
 * Keep it free of HTTP/framework concerns.
 */
import { Service, Inject, HttpException } from '@forinda/kickjs'
import { PRODUCTS_REPOSITORY, type IProductsRepository } from '../repositories/products.repository'

@Service()
export class ProductsDomainService {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: IProductsRepository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Products not found')
    }
  }
}
