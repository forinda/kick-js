import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '../../../../src/utils/injection';
import { createReactive, type Reactive, type ReactiveRegistry } from '../../../../src/utils/reactive';
import { TYPES } from '../../../../src/shared/types';
import type { AnalyticsEvent, Aggregations } from '../domain/analytics.types';

interface DatabaseState extends Record<string, unknown> {
  events: AnalyticsEvent[];
  aggregations: Aggregations;
}

@Injectable()
export class ReactiveAnalyticsDatabase {
  private readonly store: Reactive<DatabaseState>;

  constructor(@Inject(TYPES.StateRegistry) registry: ReactiveRegistry) {
    this.store = createReactive<DatabaseState>(
      {
        events: [],
        aggregations: { total: 0, byType: {} }
      },
      {
        id: 'sample:analytics-db',
        label: 'sample:analytics-db',
        registry,
        trackHistory: true,
        maxHistory: 500
      }
    );

    this.store.watch((_state, change) => {
      if (change.property === 'events') {
        this.recalculateAggregations();
      }
    });
  }

  insert(type: string, payload: Record<string, unknown>) {
    const event: AnalyticsEvent = {
      id: randomUUID(),
      type,
      payload,
      receivedAt: Date.now()
    };

    this.store.state.events = [...this.store.state.events.slice(-499), event];
    return event;
  }

  query(filter?: { type?: string; since?: number }) {
    return this.store.state.events.filter((event) => {
      if (filter?.type && event.type !== filter.type) {
        return false;
      }
      if (filter?.since && event.receivedAt < filter.since) {
        return false;
      }
      return true;
    });
  }

  aggregations() {
    return { ...this.store.state.aggregations };
  }

  private recalculateAggregations() {
    const events = this.store.state.events;
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    const aggregations: Aggregations = {
      total: events.length,
      byType: {},
      lastEvent
    };

    events.forEach((event) => {
      aggregations.byType[event.type] = (aggregations.byType[event.type] ?? 0) + 1;
    });

    this.store.state.aggregations = aggregations;
  }
}
