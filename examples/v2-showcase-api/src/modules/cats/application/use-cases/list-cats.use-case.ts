import { Service, Inject } from '@forinda/kickjs'
import { CAT_REPOSITORY, type ICatRepository } from '../../domain/repositories/cat.repository'
import type { ParsedQuery } from '@forinda/kickjs'

@Service()
export class ListCatsUseCase {
  constructor(
    @Inject(CAT_REPOSITORY) private readonly repo: ICatRepository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
