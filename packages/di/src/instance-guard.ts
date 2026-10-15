/**
 * Two installed copies of this package each keep their own container and
 * their own decorator registry, so half the app's registrations would be
 * missing from whichever copy resolves them — with no error. Warn when a
 * second copy loads. The same file evaluated again (HMR, a test re-import)
 * is one copy, not two.
 */
const KEY = Symbol.for('@forinda/kickjs-di:loaded-from')
const store = globalThis as { [KEY]?: string }
const here = import.meta.url

if (store[KEY] === undefined) {
  store[KEY] = here
} else if (store[KEY] !== here) {
  console.warn(
    `  @forinda/kickjs-di is loaded twice:\n    ${store[KEY]}\n    ${here}\n` +
      `  Each copy has its own container, so services registered in one are missing from the other.\n` +
      `  Install a single version (it comes with @forinda/kickjs; don't add it separately).`,
  )
}
