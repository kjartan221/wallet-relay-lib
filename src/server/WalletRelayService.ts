import type { Express, Request, Response } from 'express'
import type { Server } from 'http'
import type { WalletLike } from '../types.js'
import { WebSocketRelay } from './WebSocketRelay.js'
import { QRSessionManager } from './QRSessionManager.js'
import { WalletRequestHandler } from './WalletRequestHandler.js'
import { buildPairingUri } from '../shared/pairingUri.js'
import { encryptEnvelope, decryptEnvelope } from '../shared/crypto.js'
import { PROTOCOL_ID } from '../types.js'
import type { WireEnvelope, RpcResponse } from '../types.js'

interface WalletRelayServiceOptions {
  /** Express app — REST routes are registered on init. */
  app: Express
  /** HTTP server — WebSocket upgrade handler is attached here. */
  server: Server
  /** Backend wallet used to encrypt/decrypt messages with mobile. */
  wallet: WalletLike
  /** ws(s):// base URL of this server (used in the QR pairing URI). */
  relayUrl: string
  /** http(s):// URL of the desktop frontend (CORS origin + pairing URI). */
  origin: string
}

interface PendingRequest {
  resolve: (response: RpcResponse) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 30_000

/**
 * High-level facade that wires together the relay, session manager,
 * and RPC handler into a ready-to-use Express + WebSocket service.
 *
 * Usage:
 * ```ts
 * const relay = new WalletRelayService({ app, server, wallet, relayUrl, origin })
 * // REST routes and WS upgrade are registered automatically.
 * ```
 *
 * Registered routes:
 *   GET  /api/session        — create session, return { sessionId, status, qrDataUrl }
 *   GET  /api/session/:id    — return { sessionId, status }
 *   POST /api/request/:id    — body { method, params } — relay to mobile, return RpcResponse
 */
export class WalletRelayService {
  private sessions: QRSessionManager
  private relay: WebSocketRelay
  private handler = new WalletRequestHandler()
  private pending = new Map<string, PendingRequest>()

  constructor(private opts: WalletRelayServiceOptions) {
    this.sessions = new QRSessionManager()
    this.relay = new WebSocketRelay(opts.server)

    // B6: clean up relay topic when a session is GC'd
    this.sessions.onSessionExpired(id => this.relay.removeTopic(id))

    // B5: reject WS connections for unknown/expired sessions
    this.relay.onValidateTopic(topic => {
      const s = this.sessions.getSession(topic)
      return s !== null && s.status !== 'expired'
    })

    this.relay.onIncoming((topic, envelope, role) => {
      if (role === 'mobile') void this.handleMobileMessage(topic, envelope)
    })

    this.registerRoutes(opts.app)
  }

  /** Create a session and return its QR data URL. */
  async createSession(): Promise<{ sessionId: string; status: string; qrDataUrl: string }> {
    const session = this.sessions.createSession()
    const { publicKey: backendIdentityKey } = await this.opts.wallet.getPublicKey({ identityKey: true })
    const uri = buildPairingUri({
      sessionId: session.id,
      relayURL: this.opts.relayUrl,
      backendIdentityKey,
      protocolID: JSON.stringify(PROTOCOL_ID),
      origin: this.opts.origin,
    })
    const qrDataUrl = await this.sessions.generateQRCode(uri)
    return { sessionId: session.id, status: session.status, qrDataUrl }
  }

  /** Return session status, or null if not found. */
  getSession(id: string): { sessionId: string; status: string } | null {
    const s = this.sessions.getSession(id)
    return s ? { sessionId: s.id, status: s.status } : null
  }

  /**
   * Encrypt an RPC call, relay it to the mobile, and await the response.
   * Resolves with the decrypted RpcResponse or rejects after 30 s.
   */
  async sendRequest(sessionId: string, method: string, params: unknown): Promise<RpcResponse> {
    const session = this.sessions.getSession(sessionId)
    if (!session || session.status !== 'connected' || !session.mobileIdentityKey) {
      return { id: 'unknown', seq: 0, error: { code: 400, message: `Session is not connected` } }
    }

    const rpc = this.handler.createRequest(method, params)
    const ciphertext = await encryptEnvelope(
      this.opts.wallet,
      { protocolID: PROTOCOL_ID, keyID: sessionId, counterparty: session.mobileIdentityKey },
      JSON.stringify(rpc)
    )
    this.relay.sendToMobile(sessionId, { topic: sessionId, ciphertext })

    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rpc.id)
        reject(new Error('Request timed out'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(rpc.id, { resolve, reject, timer })
    })
  }

  /** Stop the GC timer and close the WebSocket server. */
  stop(): void {
    this.sessions.stop()
    this.relay.close()
  }

  // ── Route registration ────────────────────────────────────────────────────────

  private registerRoutes(app: Express): void {
    app.get('/api/session', (req: Request, res: Response) => {
      void this.createSession()
        .then(info => res.json(info))
        .catch(err => res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' }))
    })

    app.get('/api/session/:id', (req: Request, res: Response) => {
      const info = this.getSession(req.params['id'] as string)
      if (!info) { res.status(404).json({ error: 'Session not found' }); return }
      res.json(info)
    })

    app.post('/api/request/:id', (req: Request, res: Response) => {
      const { method, params } = req.body as { method: string; params: unknown }
      if (!method) { res.status(400).json({ error: 'method is required' }); return }
      void this.sendRequest(req.params['id'] as string, method, params)
        .then(response => res.json(response))
        .catch(err => res.status(504).json({ error: err instanceof Error ? err.message : 'Request failed' }))
    })
  }

  // ── Inbound message handling ──────────────────────────────────────────────────

  private async handleMobileMessage(topic: string, envelope: WireEnvelope): Promise<void> {
    const session = this.sessions.getSession(topic)
    if (!session) return

    // pairing_approved — mobileIdentityKey in outer envelope (bootstrap)
    if (envelope.mobileIdentityKey && session.status !== 'expired') {
      // B3: lock session to the first device that paired
      if (session.mobileIdentityKey && session.mobileIdentityKey !== envelope.mobileIdentityKey) return
      await this.handlePairingApproved(topic, envelope)
      return
    }

    if (!session.mobileIdentityKey) return

    // RPC response from mobile
    let plaintext: string
    try {
      plaintext = await decryptEnvelope(
        this.opts.wallet,
        { protocolID: PROTOCOL_ID, keyID: topic, counterparty: session.mobileIdentityKey },
        envelope.ciphertext
      )
    } catch { return }

    const msg = this.handler.parseMessage(plaintext)
    if (this.handler.isResponse(msg)) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(msg.id)
        pending.resolve(msg)
      }
    }
  }

  private async handlePairingApproved(topic: string, envelope: WireEnvelope): Promise<void> {
    const mobileIdentityKey = envelope.mobileIdentityKey!

    // Decrypt and verify inner payload
    let plaintext: string
    try {
      plaintext = await decryptEnvelope(
        this.opts.wallet,
        { protocolID: PROTOCOL_ID, keyID: topic, counterparty: mobileIdentityKey },
        envelope.ciphertext
      )
    } catch { return }

    const msg = this.handler.parseMessage(plaintext) as { params?: { mobileIdentityKey?: string } }
    if (msg.params?.mobileIdentityKey && msg.params.mobileIdentityKey !== mobileIdentityKey) return

    this.sessions.setMobileIdentityKey(topic, mobileIdentityKey)
    this.sessions.setStatus(topic, 'connected')

    // Send pairing_ack to confirm the session is live
    const ack = this.handler.createProtocolMessage('pairing_ack', { topic })
    const ciphertext = await encryptEnvelope(
      this.opts.wallet,
      { protocolID: PROTOCOL_ID, keyID: topic, counterparty: mobileIdentityKey },
      JSON.stringify(ack)
    )
    this.relay.sendToMobile(topic, { topic, ciphertext })
  }
}
