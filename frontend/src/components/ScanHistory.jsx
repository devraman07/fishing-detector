import { AlertTriangle, CheckCircle, Clock, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'

export function ScanHistory({ history }) {
  if (history.length === 0) {
    return (
      <div className="card p-12 text-center">
        <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No scan history</h3>
        <p className="text-gray-500">Scan some URLs to see your history here</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-lg font-semibold text-gray-900">
          Scan History ({history.length} items)
        </h3>
      </div>
      <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
        {history.map((item, index) => (
          <div key={index} className="p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-full ${
                item.prediction === 'phishing' ? 'bg-danger-100' : 'bg-green-100'
              }`}>
                {item.prediction === 'phishing' ? (
                  <AlertTriangle className="w-5 h-5 text-danger-600" />
                ) : (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.url}
                  </p>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    item.prediction === 'phishing' 
                      ? 'bg-danger-100 text-danger-700' 
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {item.prediction.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                  <span>Confidence: {(item.confidence * 100).toFixed(1)}%</span>
                  <span>{format(item.timestamp, 'MMM d, h:mm a')}</span>
                  {item.cached && (
                    <span className="text-primary-600">cached</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
