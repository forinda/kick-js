import { Service, Inject } from '@forinda/kickjs-core'
import { PRODUCTS_REPOSITORY, type IProductsRepository } from '../../domain/repositories/products.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class ListProductsUseCase {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: IProductsRepository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
