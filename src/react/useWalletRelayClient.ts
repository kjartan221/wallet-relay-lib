import { useCallback, useEffect, useRef, useState } from 'react'
import { WalletRelayClient, type WalletRelayClientOptions } from '../client/WalletRelayClient.js'
import type { SessionInfo, RequestLogEntry, WalletResponse, WalletMethodName } from '../types.js'

export type UseWalletRelayClientOptions = Omit<
  WalletRelayClientOptions,
  'onSessionChange' | 'onLogChange' | 'onError'
> & {
  /**
   * Set to `false` to prevent automatically creating a session on mount.
   * Default: `true`
   */
  autoCreate?: boolean
}

/**
 * React hook that wraps WalletRelayClient with React state.
 *
 * Replaces the template's `useWalletSession` hook — drop-in with a cleaner API.
 *
 * ```tsx
 * const { session, log, error, createSession, sendRequest } = useWalletRelayClient()
 *
 * // With options:
 * const { session } = useWalletRelayClient({ apiUrl: 'https://api.example.com', autoCreate: false })
 * ```
 */
export function useWalletRelayClient(options?: UseWalletRelayClientOptions) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [log, setLog]         = useState<RequestLogEntry[]>([])
  const [error, setError]     = useState<string | null>(null)

  // Stable ref to the client instance — persists across StrictMode remounts
  const clientRef  = useRef<WalletRelayClient | null>(null)
  const createdRef = useRef(false)

  // Lazily create the client once, wiring React state setters as callbacks
  function ensureClient(): WalletRelayClient {
    if (!clientRef.current) {
      clientRef.current = new WalletRelayClient({
        apiUrl:          options?.apiUrl,
        pollInterval:    options?.pollInterval,
        onSessionChange: setSession,
        onLogChange:     setLog,
        onError:         setError,
      })
    }
    return clientRef.current
  }

  const createSession = useCallback(async () => {
    setError(null)
    return ensureClient().createSession()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sendRequest = useCallback(
    async (method: WalletMethodName, params?: unknown): Promise<WalletResponse> =>
      ensureClient().sendRequest(method, params),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    if (options?.autoCreate === false) return
    // Guard against React StrictMode double-invocation — the ref persists across
    // the simulated unmount/remount, so the second call is skipped.
    if (createdRef.current) return
    createdRef.current = true
    void createSession()
    return () => ensureClient().destroy()
  }, [createSession]) // eslint-disable-line react-hooks/exhaustive-deps

  return { session, log, error, createSession, sendRequest }
}
