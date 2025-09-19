import { Container } from 'inversify';
import { AppDiagnostics } from '../core/diagnostics';
import { RequestTracker } from '../core/request-tracker';
import { createReactive, ReactiveRegistry, type Reactive } from '../utils/reactive';
import { createLogger } from '../utils/logger';
import { TYPES, type AppState } from '../shared/types';
import type { ResolvedAppConfig } from '../shared/config';

export function buildContainer(resolvedConfig: ResolvedAppConfig) {
  const container = new Container({ defaultScope: 'Singleton' });

  const registry = new ReactiveRegistry();
  container.bind<ReactiveRegistry>(TYPES.StateRegistry).toConstantValue(registry);
  container.bind(TYPES.Config).toConstantValue(resolvedConfig);
  container.bind(TYPES.Logger).toConstantValue(createLogger(resolvedConfig.logging));

  const appState = createReactive<AppState>(
    {
      bootedAt: Date.now(),
      metadata: {}
    },
    {
      id: 'app:state',
      label: 'application:state',
      registry,
      trackHistory: resolvedConfig.telemetry.trackReactiveHistory,
      maxHistory: resolvedConfig.telemetry.requestHistoryLimit
    }
  );

  container.bind<Reactive<AppState>>(TYPES.AppState).toConstantValue(appState);
  container.bind<RequestTracker>(TYPES.RequestTracker).to(RequestTracker).inSingletonScope();
  container.bind<AppDiagnostics>(TYPES.Diagnostics).to(AppDiagnostics).inSingletonScope();

  return container;
}
