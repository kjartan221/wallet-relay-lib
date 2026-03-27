'use client'

import type { SessionInfo } from 'qr-lib/client'

interface Props {
  session: SessionInfo | null
  onRefresh: () => void
}

const statusLabel: Record<string, string> = {
  pending:      'Waiting for mobile...',
  connected:    'Mobile connected',
  disconnected: 'Mobile disconnected',
  expired:      'Session expired',
}

const statusColor: Record<string, string> = {
  pending:      'bg-yellow-100 text-yellow-800',
  connected:    'bg-green-100 text-green-800',
  disconnected: 'bg-gray-100 text-gray-600',
  expired:      'bg-red-100 text-red-700',
}

export function QRDisplay({ session, onRefresh }: Props) {
  if (!session) {
    return (
      <div className="flex items-center justify-center w-64 h-64 bg-gray-100 rounded-xl animate-pulse">
        <span className="text-gray-400 text-sm">Generating QR...</span>
      </div>
    )
  }

  const status    = session.status
  const isExpired = status === 'expired'

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-64 h-64 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
        {session.qrDataUrl ? (
          <img src={session.qrDataUrl} alt="Scan to connect mobile wallet" className="w-full h-full" />
        ) : (
          <div className="flex items-center justify-center w-full h-full bg-gray-100">
            <span className="text-gray-400 text-sm">No QR available</span>
          </div>
        )}
        {isExpired && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
            <span className="text-gray-500 text-sm font-medium">Expired</span>
          </div>
        )}
      </div>

      <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {statusLabel[status] ?? status}
      </span>

      {isExpired && (
        <button onClick={onRefresh} className="text-sm text-blue-600 hover:underline">
          Generate new QR
        </button>
      )}
    </div>
  )
}
