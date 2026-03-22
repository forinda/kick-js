import { Service, Inject } from '@forinda/kickjs-core'
import {
  ACTIVITY_REPOSITORY,
  type IActivityRepository,
} from '../../domain/repositories/activity.repository'
import type { CreateActivityDTO } from '../dtos/create-activity.dto'

@Service()
export class CreateActivityUseCase {
  constructor(@Inject(ACTIVITY_REPOSITORY) private readonly repo: IActivityRepository) {}

  async execute(dto: CreateActivityDTO, actorId: string) {
    return this.repo.create({ ...dto, actorId })
  }
}
