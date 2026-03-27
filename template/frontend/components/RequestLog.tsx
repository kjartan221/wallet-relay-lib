import type { RequestLogEntry } from '../types/wallet'

interface Props {
  entries: RequestLogEntry[]
}

export function RequestLog({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="text-xs text-gray-400 text-center py-6">
        No requests yet
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-72">
      {entries.map((entry) => (
        <div
          key={entry.request.requestId}
          className={`rounded-lg border p-3 text-xs font-mono ${
            entry.pending
              ? 'border-yellow-200 bg-yellow-50'
              : entry.response?.error
              ? 'border-red-200 bg-red-50'
              : 'border-green-200 bg-green-50'
          }`}
        >
          <div className="flex justify-between items-center mb-1">
            <span className="font-semibold text-gray-700">{entry.request.method}</span>
            <span className="text-gray-400">
              {entry.pending ? '⏳ pending' : entry.response?.error ? '✗ error' : '✓ ok'}
            </span>
          </div>
          {!entry.pending && entry.response && (
            <pre className="text-gray-600 whitespace-pre-wrap break-all">
              {JSON.stringify(entry.response.error ?? entry.response.result, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
