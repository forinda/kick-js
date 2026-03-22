import type { PaginationQuery, PaginatedResponse } from '@/shared/application/pagination.dto';

export interface IBaseRepository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  findPaginated(query: PaginationQuery): Promise<PaginatedResponse<T>>;
}
