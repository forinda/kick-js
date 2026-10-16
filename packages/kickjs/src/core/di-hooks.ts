/**
 * Connects the DI core (`@forinda/kickjs-di`) to
 * the framework: catalogued errors, the logger, and `@Asset` injection.
 * Imported by `./container` and `./decorators`, so every kickjs entry that
 * reaches the container installs them.
 */
import { Container, type DiErrorCode } from '@forinda/kickjs-di'
// Slot indirection, NOT `./assets` — that module's eager node:fs import
// would poison the edge-safe web entry graph (see asset-resolver-slot.ts).
import { resolveAssetViaSlot } from './asset-resolver-slot'
import { METADATA } from './interfaces'
import {
  envValueMissingError,
  fallbackAlreadyResolvedError,
  noProviderError,
  requestScopeMiddlewareMissingError,
  requestScopeOutsideRequestError,
} from './kick-errors'
import { createLogger } from './logger'

const CATALOGUE: Record<DiErrorCode, (subject: string) => Error> = {
  KICK001: noProviderError,
  KICK002: requestScopeMiddlewareMissingError,
  KICK003: requestScopeOutsideRequestError,
  KICK004: envValueMissingError,
  KICK010: fallbackAlreadyResolvedError,
}

Container._error = (code, subject) => CATALOGUE[code](subject)
Container._logger = createLogger('Container')
Container._propertyInjectors.set(METADATA.ASSET, ({ assetKey }: { assetKey: string }) => {
  const slash = assetKey.indexOf('/')
  if (slash === -1) {
    throw new Error(
      `@Asset('${assetKey}'): asset key must include a '/' separator (e.g. 'mails/welcome').`,
    )
  }
  const namespace = assetKey.slice(0, slash)
  const key = assetKey.slice(slash + 1)
  return () => resolveAssetViaSlot(namespace, key)
})
