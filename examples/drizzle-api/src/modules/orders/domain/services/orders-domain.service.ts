/**
 * Orders Domain Service
 *
 * Domain layer — contains business rules that don't belong to a single entity.
 * Use this for cross-entity logic, validation rules, and domain invariants.
 * Keep it free of HTTP/framework concerns.
 */
import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { ORDERS_REPOSITORY, type IOrdersRepository } from '../repositories/orders.repository'

@Service()
export class OrdersDomainService {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: IOrdersRepository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Orders not found')
    }
  }
}
