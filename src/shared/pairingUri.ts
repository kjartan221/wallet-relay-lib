import type { PairingParams, ParseResult } from '../types.js'

/**
 * Parse and validate a wallet://pair?… QR code URI.
 *
 * Checks performed:
 *   - protocol is wallet:
 *   - all required fields present
 *   - expiry not passed
 *   - relay is ws:// or wss://
 *   - origin is http:// or https://
 *   - M1: for wss://, relay hostname must match origin hostname
 *   - backendIdentityKey is a compressed secp256k1 public key
 *   - protocolID is a valid [number, string] JSON tuple
 *   - keyID equals topic (per protocol spec)
 */
export function parsePairingUri(raw: string): ParseResult {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'wallet:') return { params: null, error: 'Not a wallet:// URI' }

    const g = (k: string) => url.searchParams.get(k) ?? ''
    const topic            = g('topic')
    const relay            = g('relay')
    const backendIdentityKey = g('backendIdentityKey')
    const protocolID       = g('protocolID')
    const keyID            = g('keyID')
    const origin           = g('origin')
    const expiry           = g('expiry')

    if (!topic || !relay || !backendIdentityKey || !protocolID || !keyID || !origin || !expiry) {
      return { params: null, error: 'QR code is missing required fields' }
    }

    if (Date.now() / 1000 > Number(expiry)) {
      return { params: null, error: 'This QR code has expired — ask the desktop to generate a new one' }
    }

    let relayUrl: URL
    try { relayUrl = new URL(relay) } catch { return { params: null, error: 'Relay URL is not valid' } }
    if (relayUrl.protocol !== 'ws:' && relayUrl.protocol !== 'wss:') {
      return { params: null, error: 'Relay must use ws:// or wss://' }
    }

    let originUrl: URL
    try { originUrl = new URL(origin) } catch { return { params: null, error: 'Origin URL is not valid' } }
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
      return { params: null, error: 'Origin must use http:// or https://' }
    }

    // M1: wss:// relay must share hostname with origin.
    // ws:// is local/dev only — browsers already block ws:// from https:// via mixed content rules.
    if (relayUrl.protocol === 'wss:' && relayUrl.hostname !== originUrl.hostname) {
      return {
        params: null,
        error: `Relay host "${relayUrl.hostname}" doesn't match origin host "${originUrl.hostname}" — this QR may be malicious`,
      }
    }

    if (!/^0[23][0-9a-fA-F]{64}$/.test(backendIdentityKey)) {
      return { params: null, error: 'Backend identity key is not a valid compressed public key' }
    }

    let proto: unknown
    try { proto = JSON.parse(protocolID) } catch { return { params: null, error: 'protocolID is not valid JSON' } }
    if (!Array.isArray(proto) || proto.length !== 2 || typeof proto[0] !== 'number' || typeof proto[1] !== 'string') {
      return { params: null, error: 'protocolID must be a [number, string] tuple' }
    }

    if (keyID !== topic) {
      return { params: null, error: 'keyID must match topic — malformed QR code' }
    }

    return { params: { topic, relay, backendIdentityKey, protocolID, keyID, origin, expiry }, error: null }
  } catch {
    return { params: null, error: 'Could not read QR code' }
  }
}

/**
 * Build a wallet://pair?… URI from session parameters.
 * `pairingTtlMs` controls how long the QR code is valid (default 120 s).
 */
export function buildPairingUri(params: {
  sessionId: string
  relayURL: string
  backendIdentityKey: string
  protocolID: string  // JSON.stringify(PROTOCOL_ID)
  origin: string
  pairingTtlMs?: number
}): string {
  const ttl = params.pairingTtlMs ?? 120_000
  const expiry = Math.floor((Date.now() + ttl) / 1000)
  const p = new URLSearchParams({
    topic: params.sessionId,
    relay: params.relayURL,
    backendIdentityKey: params.backendIdentityKey,
    protocolID: params.protocolID,
    keyID: params.sessionId,  // sessionId doubles as keyID per protocol spec
    origin: params.origin,
    expiry: String(expiry),
  })
  return `wallet://pair?${p.toString()}`
}
