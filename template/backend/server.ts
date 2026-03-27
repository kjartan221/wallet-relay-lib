/**
 * BSV Mobile Wallet — Backend Entry Point
 *
 * ── EXISTING EXPRESS APP? ─────────────────────────────────────────────────────
 *
 * If you already have an Express app and HTTP server, you only need the wallet
 * + WalletRelayService lines. Delete the boilerplate below and pass your
 * existing instances instead:
 *
 *   import { WalletClient } from '@bsv/sdk'
 *   import { WalletRelayService } from 'qr-lib'
 *
 *   // TODO: replace with your actual wallet (see Wallet section below)
 *   const wallet = new WalletClient('auto')
 *
 *   new WalletRelayService({
 *     app,        // your existing Express app
 *     server,     // your existing http.Server (the one passed to server.listen)
 *     wallet,
 *     relayUrl: process.env['RELAY_URL'] ?? 'ws://localhost:3000',
 *     origin:   process.env['ORIGIN']    ?? 'http://localhost:5173',
 *   })
 *
 *   // No extra routes needed — WalletRelayService registers /api/session,
 *   // /api/session/:id, /api/request/:id, and the /ws WebSocket endpoint.
 *
 * ── NEW APP? ──────────────────────────────────────────────────────────────────
 *
 * Continue reading — the full server setup is below.
 * Copy .env.example → .env and fill in your values, then follow the TODO comments.
 */

import http from 'http'
import express from 'express'
import cors from 'cors'
import { WalletClient } from '@bsv/sdk'
import { WalletRelayService } from 'qr-lib'

// ── Configuration ─────────────────────────────────────────────────────────────
//
// RELAY_URL must use ws:// or wss:// (not http://). It should match the
// public address of this server so the mobile QR deeplink points correctly.

const PORT      = Number(process.env['PORT']      ?? 3000)
const RELAY_URL = process.env['RELAY_URL']         ?? 'ws://localhost:3000'
const ORIGIN    = process.env['ORIGIN']            ?? 'http://localhost:5173'

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()

app.use(cors({ origin: ORIGIN }))
app.use(express.json())

const server = http.createServer(app)

// ── Wallet ────────────────────────────────────────────────────────────────────
//
// TODO: Replace this with the BSV wallet your backend should use for
//       encrypting/decrypting messages with the mobile device.
//
// WalletClient('auto') auto-detects a running MetaNet Client or BabbageSDK
// instance on localhost. For a fully server-side context without a MetaNet
// Client, use ProtoWallet with a private key instead:
//
//   import { ProtoWallet, PrivateKey } from '@bsv/sdk'
//   const wallet = new ProtoWallet(PrivateKey.fromWif(process.env['WALLET_WIF']!))

const wallet = new WalletClient('auto')

// ── Relay service ─────────────────────────────────────────────────────────────
//
// Registers /api/session, /api/session/:id, /api/request/:id, and the
// /ws WebSocket endpoint. No further route setup is needed.

new WalletRelayService({
  app,
  server,
  wallet,
  relayUrl: RELAY_URL,
  origin:   ORIGIN,

  // TODO (optional): hook into session lifecycle events for logging,
  // analytics, or custom business logic.
  onSessionConnected: (sessionId) => {
    console.log(`[relay] mobile connected — session ${sessionId}`)
  },
  onSessionDisconnected: (sessionId) => {
    console.log(`[relay] mobile disconnected — session ${sessionId}`)
  },
})

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server    → http://0.0.0.0:${PORT}`)
  console.log(`WebSocket → ws://0.0.0.0:${PORT}/ws`)
})
