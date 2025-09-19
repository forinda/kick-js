export const TYPES = {
  AppState: Symbol.for('kick:AppState'),
  Config: Symbol.for('kick:Config'),
  Diagnostics: Symbol.for('kick:Diagnostics'),
  Logger: Symbol.for('kick:Logger'),
  StateRegistry: Symbol.for('kick:StateRegistry'),
  RequestTracker: Symbol.for('kick:RequestTracker')
} as const;

export interface AppState extends Record<string, unknown> {
  bootedAt: number;
  metadata: Record<string, unknown>;
}

export interface RequestLogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface RequestState extends Record<string, unknown> {
  id: string;
  method: string;
  path: string;
  status?: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
  errorCode?: string;
  response?: unknown;
  logs: RequestLogEntry[];
  metadata: Record<string, unknown>;
}
