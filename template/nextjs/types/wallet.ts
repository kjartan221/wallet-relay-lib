/**
 * UI-layer types used by useWalletSession, WalletActions, and RequestLog.
 *
 * Wire-protocol types (RpcRequest, RpcResponse, SessionInfo, SessionStatus)
 * come from 'qr-lib/client'.
 *
 * TODO: Extend WalletMethod with any additional methods your app will call.
 *       Keep this in sync with the actions array in components/WalletActions.tsx.
 */

export type WalletMethod =
  | 'getPublicKey'
  // TODO: add more methods as needed, e.g.:
  // | 'listOutputs'
  // | 'createAction'
  // | 'signAction'

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
