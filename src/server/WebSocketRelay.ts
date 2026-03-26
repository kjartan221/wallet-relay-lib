import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'http'
import type { WireEnvelope } from '../types.js'

const HEARTBEAT_INTERVAL_MS = 30_000
const BUFFER_TTL_MS = 60_000
const BUFFER_MAX_PER_TOPIC = 50

interface TopicEntry {
  desktop: WebSocket | null
  mobile: WebSocket | null
  buffer: BufferedMessage[]
}

interface BufferedMessage {
  envelope: WireEnvelope
  expiresAt: number
}

type Role = 'desktop' | 'mobile'
type MessageHandler = (topic: string, envelope: WireEnvelope, role: Role) => void
type TopicValidator = (topic: string) => boolean

/**
 * Topic-keyed WebSocket relay. Mounts at /ws.
 *
 * Connections: ws://host/ws?topic=<sessionId>&role=desktop|mobile
 *
 * - Messages from mobile  → forwarded to desktop (or buffered)
 * - Messages from desktop → forwarded to mobile  (or buffered)
 * - Buffered messages are flushed when the other side connects
 * - Heartbeat pings every 30 s; non-responsive sockets are terminated
 */
export class WebSocketRelay {
  private wss: WebSocketServer
  private topics = new Map<string, TopicEntry>()
  private onMessage: MessageHandler | null = null
  private validateTopic: TopicValidator | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 })
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), HEARTBEAT_INTERVAL_MS)
  }

  /** Register a callback for every inbound message from either side. */
  onIncoming(handler: MessageHandler): void {
    this.onMessage = handler
  }

  /** Register a validator called on each new connection to verify the topic exists. */
  onValidateTopic(validator: TopicValidator): void {
    this.validateTopic = validator
  }

  /** Remove a topic entry — call when its session is garbage-collected. */
  removeTopic(topic: string): void {
    this.topics.delete(topic)
  }

  /** Push an envelope to the mobile socket (or buffer if disconnected). */
  sendToMobile(topic: string, envelope: WireEnvelope): void {
    const entry = this.topics.get(topic)
    if (entry?.mobile?.readyState === WebSocket.OPEN) {
      entry.mobile.send(JSON.stringify(envelope))
    } else {
      this.buffer(topic, envelope)
    }
  }

  /** Push an envelope to the desktop socket (or buffer if disconnected). */
  sendToDesktop(topic: string, envelope: WireEnvelope): void {
    const entry = this.topics.get(topic)
    if (entry?.desktop?.readyState === WebSocket.OPEN) {
      entry.desktop.send(JSON.stringify(envelope))
    } else {
      this.buffer(topic, envelope)
    }
  }

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.wss.close()
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '', 'http://localhost')
    const topic = url.searchParams.get('topic')
    const role = url.searchParams.get('role') as Role | null

    if (!topic || !role || (role !== 'desktop' && role !== 'mobile')) {
      ws.close(1008, 'Missing or invalid topic/role')
      return
    }

    if (this.validateTopic && !this.validateTopic(topic)) {
      ws.close(1008, 'Unknown or expired session')
      return
    }

    const entry = this.getOrCreateTopic(topic)
    entry[role] = ws

    // Flush any messages buffered while this side was disconnected
    const now = Date.now()
    const toFlush = entry.buffer.filter(m => m.expiresAt > now)
    entry.buffer = []
    for (const { envelope } of toFlush) {
      ws.send(JSON.stringify(envelope))
    }

    ;(ws as WebSocket & { isAlive: boolean }).isAlive = true
    ws.on('pong', () => { (ws as WebSocket & { isAlive: boolean }).isAlive = true })

    ws.on('message', (data) => {
      try {
        const envelope = JSON.parse(data.toString()) as WireEnvelope
        if (!envelope.topic || !envelope.ciphertext) return

        // Route to the other side
        const other = role === 'mobile' ? entry.desktop : entry.mobile
        if (other?.readyState === WebSocket.OPEN) {
          other.send(JSON.stringify(envelope))
        } else {
          this.buffer(topic, envelope)
        }

        // Notify service layer (e.g. to process pairing_approved)
        this.onMessage?.(topic, envelope, role)
      } catch {
        // Malformed message — drop silently
      }
    })

    ws.on('close', () => {
      if (entry[role] === ws) entry[role] = null
    })
  }

  private getOrCreateTopic(topic: string): TopicEntry {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, { desktop: null, mobile: null, buffer: [] })
    }
    return this.topics.get(topic)!
  }

  private buffer(topic: string, envelope: WireEnvelope): void {
    const entry = this.getOrCreateTopic(topic)
    const now = Date.now()
    entry.buffer = entry.buffer.filter(m => m.expiresAt > now)
    if (entry.buffer.length >= BUFFER_MAX_PER_TOPIC) {
      entry.buffer.shift()
    }
    entry.buffer.push({ envelope, expiresAt: now + BUFFER_TTL_MS })
  }

  private runHeartbeat(): void {
    for (const ws of this.wss.clients) {
      const ext = ws as WebSocket & { isAlive: boolean }
      if (!ext.isAlive) { ws.terminate(); continue }
      ext.isAlive = false
      ws.ping()
    }
  }
}
