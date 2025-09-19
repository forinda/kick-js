export interface AnalyticsEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  receivedAt: number;
}

export interface Aggregations {
  total: number;
  byType: Record<string, number>;
  lastEvent?: AnalyticsEvent;
}

export const ANALYTICS_TYPES = {
  Database: Symbol.for('sample:AnalyticsDatabase'),
  EventService: Symbol.for('sample:EventService')
} as const;
