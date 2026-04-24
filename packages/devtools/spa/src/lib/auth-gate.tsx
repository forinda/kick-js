/**
 * Auth gate modal — shown when every devtools endpoint returns
 * 401/403 because the server requires a token the SPA doesn't have
 * yet (e.g. user opened the dashboard without `?token=...` and
 * doesn't have the cookie).
 *
 * Recovers the legacy Vue dashboard's auth gate. Mounted once in
 * App.tsx alongside DetailModalHost; renders nothing when
 * `store.authRequired()` is false so it's invisible in the happy
 * path.
 */

import { createSignal, Show, type Component } from 'solid-js'
import { rpc, setToken } from './rpc'
import { store, storeActions } from './store'

export const AuthGate: Component = () => {
  const [input, setInput] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  const submit = async (): Promise<void> => {
    const trimmed = input().trim()
    if (!trimmed) {
      storeActions.setAuthError('Token is required')
      return
    }
    setBusy(true)
    storeActions.setAuthError(null)
    try {
      // Stash the token then probe /health — same endpoint as the
      // legacy Vue gate uses to validate.
      setToken(trimmed)
      await rpc.health()
      // Success — drop the gate. The unified-stream's next refetch
      // (already in flight on the polling cadence) will repopulate
      // every slice.
      storeActions.setAuthRequired(false)
      storeActions.setAuthError(null)
      setInput('')
    } catch {
      storeActions.setAuthError('Invalid token — request was rejected.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={store.authRequired()}>
      <div class="fixed inset-0 z-[60] bg-slate-950/90 flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl">
          <div class="text-center mb-6">
            <h2 class="text-xl font-bold text-kick-500 mb-2">⚡ KickJS DevTools</h2>
            <p class="text-sm text-slate-400">
              Enter your DevTools token to continue.
            </p>
            <p class="text-xs text-slate-600 mt-1">
              The token is printed in the server console on startup, e.g.{' '}
              <code class="font-mono text-slate-500">[token: abc123…]</code>
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <input
              type="text"
              autofocus
              placeholder="Paste your token here…"
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm
                     text-slate-200 placeholder-slate-500 focus:outline-none focus:border-kick-500
                     font-mono mb-3"
            />
            <Show when={store.authError()}>
              {(msg) => <p class="text-red-400 text-sm mb-3">{msg()}</p>}
            </Show>
            <button
              type="submit"
              disabled={busy()}
              class="w-full bg-kick-500 hover:bg-kick-600 text-white font-semibold py-2.5 rounded-lg
                     transition-colors disabled:opacity-50"
            >
              {busy() ? 'Verifying…' : 'Authenticate'}
            </button>
          </form>
        </div>
      </div>
    </Show>
  )
}
