import { Inject, Injectable } from '../utils/injection';
import { ReactiveRegistry } from '../utils/reactive';
import { TYPES, type RequestState } from '../shared/types';
import type { ResolvedAppConfig } from '../shared/config';

export interface StoreSnapshot {
  id: string;
  label?: string;
  snapshot: Record<string, unknown>;
  history: ReadonlyArray<unknown>;
}

export interface RequestSnapshot extends RequestState {}

@Injectable()
export class AppDiagnostics {
  constructor(
    @Inject(TYPES.StateRegistry) private readonly registry: ReactiveRegistry,
    @Inject(TYPES.Config) private readonly config: ResolvedAppConfig
  ) {}

  settings() {
    return this.config;
  }

  stores(): StoreSnapshot[] {
    return this.registry.list().map((entry) => ({
      id: entry.id,
      label: entry.label,
      snapshot: entry.snapshot as Record<string, unknown>,
      history: entry.history
    }));
  }

  requests(): RequestSnapshot[] {
    return this.registry
      .list()
      .filter((entry) => entry.label?.startsWith('request:'))
      .map((entry) => entry.snapshot as RequestSnapshot);
  }
}
