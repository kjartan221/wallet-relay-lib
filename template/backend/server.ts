/**
 * BSV Mobile Wallet — Backend Entry Point
 *
 * ── EXISTING EXPRESS APP? ─────────────────────────────────────────────────────
 *
 * If you already have an Express app and HTTP server, you only need to add:
 *
 *   import { ProtoWallet, PrivateKey } from '@bsv/sdk'
 *   import { WalletRelayService } from 'qr-lib'
 *
 *   const wallet = new ProtoWallet(PrivateKey.fromWif(process.env['WALLET_WIF']!))
 *   new WalletRelayService({ app, server, wallet })
 *
 *   // Registers /api/session, /api/session/:id, /api/request/:id, and /ws.
 *   // Set RELAY_URL and ORIGIN env vars, or they default to localhost.
 *
 * ── NEW APP? ──────────────────────────────────────────────────────────────────
 *
 * Copy .env.example → .env, add a WALLET_WIF, and run.
 */

import http from 'http'
import express from 'express'
import cors from 'cors'
import { ProtoWallet, PrivateKey } from '@bsv/sdk'
import { WalletRelayService } from 'qr-lib'

const PORT   = Number(process.env['PORT']   ?? 3000)
const ORIGIN = process.env['ORIGIN']        ?? 'http://localhost:5173'

// ── Wallet ────────────────────────────────────────────────────────────────────
//
// The backend needs a stable private key — the mobile derives its ECDH shared
// secret from the backend identity key embedded in the QR code, so the same key
// must be used across restarts.
//
// Generate a key once and store it in .env as WALLET_WIF:
//   node -e "const {PrivateKey}=require('@bsv/sdk'); console.log(PrivateKey.fromRandom().toWif())"

if (!process.env['WALLET_WIF']) throw new Error('WALLET_WIF environment variable is required')
const wallet = new ProtoWallet(PrivateKey.fromWif(process.env['WALLET_WIF']))

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(cors({ origin: ORIGIN }))
app.use(express.json())

const server = http.createServer(app)

// ── Relay service ─────────────────────────────────────────────────────────────
//
// relayUrl defaults to process.env.RELAY_URL ?? 'ws://localhost:3000'
// origin   defaults to process.env.ORIGIN   ?? 'http://localhost:5173'

new WalletRelayService({ app, server, wallet })

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server    → http://0.0.0.0:${PORT}`)
  console.log(`WebSocket → ws://0.0.0.0:${PORT}/ws`)
})
