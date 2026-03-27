/**
 * UI-layer types used by useWalletSession, WalletActions, and RequestLog.
 *
 * Wire-protocol types (RpcRequest, RpcResponse, WireEnvelope, SessionInfo,
 * SessionStatus) come from 'qr-lib/client' — no need to duplicate them here.
 *
 * TODO: Extend WalletMethod with any additional methods your app will call
 *       on the mobile wallet (e.g. 'createAction', 'signAction').
 *       Keep this in sync with the actions array in WalletActions.tsx.
 */

export type WalletMethod =
  | 'getPublicKey'
  // TODO: add more methods as needed, e.g.:
  // | 'listOutputs'
  // | 'createAction'
  // | 'signAction'

// ── Request log types ─────────────────────────────────────────────────────────
// These are UI-layer only — they track display state, not the wire protocol.

export interface WalletRequest {
  requestId: string
  method: string
  params: unknown
  timestamp: number
}

export interface WalletResponse {
  requestId: string
  result?: unknown
  error?: { code: number; message: string }
  timestamp: number
}

export interface RequestLogEntry {
  request: WalletRequest
  response?: WalletResponse
  pending: boolean
}
