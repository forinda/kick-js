import { Inject, Injectable } from '../../../../src/utils/injection';
import { ReactiveAnalyticsDatabase } from '../db/reactive-db';
import { ANALYTICS_TYPES } from '../domain/analytics.types';

@Injectable()
export class EventService {
  constructor(@Inject(ANALYTICS_TYPES.Database) private readonly db: ReactiveAnalyticsDatabase) {}

  record(type: string, payload: Record<string, unknown>) {
    return this.db.insert(type, payload);
  }

  metrics() {
    return this.db.aggregations();
  }

  history(filter?: { type?: string; since?: number }) {
    return this.db.query(filter);
  }
}
