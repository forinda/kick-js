import type { ServiceIdentifier as InversifyServiceIdentifier } from 'inversify';
import {
  inject as inversifyInject,
  injectable as inversifyInjectable,
  multiInject as inversifyMultiInject,
  named as inversifyNamed,
  optional as inversifyOptional,
  tagged as inversifyTagged,
  unmanaged as inversifyUnmanaged
} from 'inversify';

export type BindingIdentifier<T = unknown> = InversifyServiceIdentifier<T>;

export function Injectable(): ClassDecorator;
export function Injectable(): ClassDecorator {
  return inversifyInjectable();
}

export function Inject<T = unknown>(identifier: BindingIdentifier<T>) {
  return inversifyInject(identifier);
}

export function Optional() {
  return inversifyOptional();
}

export function MultiInject<T = unknown>(identifier: BindingIdentifier<T>) {
  return inversifyMultiInject(identifier);
}

export function Named(name: string | number | symbol) {
  return inversifyNamed(name);
}

export function Tagged(metadataKey: string | number | symbol, metadataValue: unknown) {
  return inversifyTagged(metadataKey, metadataValue);
}

export function Unmanaged() {
  return inversifyUnmanaged();
}
