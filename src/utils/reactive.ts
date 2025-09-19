import { randomUUID } from 'node:crypto';

export interface ReactiveChangeDetails<TState> {
  property: keyof TState;
  value: TState[keyof TState];
  previous: TState[keyof TState];
  timestamp: number;
}

export type ReactiveWatcher<TState> = (state: TState, details: ReactiveChangeDetails<TState>) => void;

export interface Reactive<TState> {
  readonly id: string;
  readonly label?: string;
  state: TState;
  watch(watcher: ReactiveWatcher<TState>): () => void;
  snapshot(): TState;
  history(): ReactiveChangeDetails<TState>[];
}

export interface CreateReactiveOptions {
  id?: string;
  label?: string;
  registry?: ReactiveRegistry;
  trackHistory?: boolean;
  maxHistory?: number;
}

export class ReactiveRegistry {
  private readonly stores = new Map<string, Reactive<unknown>>();

  register<TState>(store: Reactive<TState>) {
    this.stores.set(store.id, store as Reactive<unknown>);
  }

  unregister(id: string) {
    this.stores.delete(id);
  }

  get<TState>(id: string): Reactive<TState> | undefined {
    return this.stores.get(id) as Reactive<TState> | undefined;
  }

  list() {
    return Array.from(this.stores.values()).map((store) => ({
      id: store.id,
      label: store.label,
      snapshot: store.snapshot(),
      history: store.history()
    }));
  }
}

export function createReactive<TState extends Record<string, unknown>>(
  initial: TState,
  options: CreateReactiveOptions = {}
): Reactive<TState> {
  const listeners = new Set<ReactiveWatcher<TState>>();
  const target = { ...initial } as TState;
  const history: ReactiveChangeDetails<TState>[] = [];
  const historyEnabled = options.trackHistory ?? true;
  const maxHistory = options.maxHistory ?? 100;
  const reactiveId = options.id ?? randomUUID();

  const proxy = new Proxy(target, {
    set(current, prop: string | symbol, value) {
      if (typeof prop === 'symbol') {
        return Reflect.set(current, prop, value);
      }

      const typedProp = prop as keyof TState;
      const previous = current[typedProp];
      const didChange = previous !== value;
      const result = Reflect.set(current, typedProp, value);

      if (didChange) {
        const change: ReactiveChangeDetails<TState> = {
          property: typedProp,
          value: value as TState[keyof TState],
          previous,
          timestamp: Date.now()
        };

        if (historyEnabled) {
          history.push(change);
          if (history.length > maxHistory) {
            history.shift();
          }
        }

        listeners.forEach((listener) => listener(proxy, change));
      }

      return result;
    }
  });

  const store: Reactive<TState> = {
    id: reactiveId,
    label: options.label,
    state: proxy,
    watch(watcher) {
      listeners.add(watcher);
      return () => listeners.delete(watcher);
    },
    snapshot() {
      return structuredClone(target);
    },
    history() {
      return historyEnabled ? [...history] : [];
    }
  };

  options.registry?.register(store);

  return store;
}
