import { useState, useEffect, useCallback } from 'react'
import { scanUrl, getStats } from './api'
import { ScanHistory } from './components/ScanHistory'
import { StatsChart } from './components/StatsChart'
import { Shield, Search, AlertTriangle, CheckCircle, History, BarChart3 } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import { useDebounce } from 'use-debounce'
import { format } from 'date-fns'

function App() {
  const [url, setUrl] = useState('')
  const [debouncedUrl] = useDebounce(url, 500)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('scan')
  const [stats, setStats] = useState({ totalScanned: 0, blockedCount: 0, cacheSize: 0 })
  const [scanHistory, setScanHistory] = useState([])

  // Auto-scan on paste (when debounced URL changes)
  useEffect(() => {
    if (debouncedUrl && debouncedUrl.trim().startsWith('http')) {
      handleScan(debouncedUrl.trim())
    }
  }, [debouncedUrl])

  // Load stats on mount
  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      const data = await getStats()
      if (data.success) {
        setStats(data.data)
      }
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }

  const handleScan = useCallback(async (scanUrlText = null) => {
    const targetUrl = scanUrlText || url.trim()
    if (!targetUrl) {
      toast.error('Please enter a URL')
      return
    }

    // Basic URL validation
    try {
      new URL(targetUrl)
    } catch {
      toast.error('Invalid URL format')
      return
    }

    setLoading(true)
    setResult(null)
    setError(null)

    const toastId = toast.loading('Scanning URL...')

    try {
      const data = await scanUrl(targetUrl)
      
      if (!data.success) {
        throw new Error(data.error || 'Scan failed')
      }

      setResult(data.data)
      
      // Add to history
      setScanHistory(prev => [{
        url: targetUrl,
        prediction: data.data.prediction,
        confidence: data.data.confidence,
        timestamp: new Date(),
        cached: data.data.cached
      }, ...prev.slice(0, 49)]) // Keep last 50

      toast.success(
        data.data.prediction === 'phishing' 
          ? '⚠️ Phishing detected!' 
          : '✅ URL is safe',
        { id: toastId }
      )

      // Refresh stats
      loadStats()
      
    } catch (err) {
      setError(err.message)
      toast.error(err.message, { id: toastId })
    } finally {
      setLoading(false)
    }
  }, [url])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleScan()
    }
  }

  const handlePaste = (e) => {
    // Auto-scan will trigger via debounce
    toast.success('URL pasted - scanning...', { duration: 1500 })
  }

  const getThreatLevel = (confidence) => {
    if (confidence >= 0.9) return { level: 'Critical', color: 'text-danger-600', bg: 'bg-danger-50' }
    if (confidence >= 0.8) return { level: 'High', color: 'text-danger-500', bg: 'bg-danger-50' }
    if (confidence >= 0.7) return { level: 'Medium', color: 'text-yellow-600', bg: 'bg-yellow-50' }
    return { level: 'Low', color: 'text-green-600', bg: 'bg-green-50' }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-r from-primary-500 to-primary-600 p-2 rounded-lg">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Secure Browse Guard</h1>
                <p className="text-sm text-gray-500">ML-Powered Phishing Detection</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                {stats.totalScanned.toLocaleString()} scanned
              </span>
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-4 h-4 text-danger-500" />
                {stats.blockedCount.toLocaleString()} blocked
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white p-1 rounded-lg shadow-sm inline-flex">
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'scan' 
                ? 'bg-primary-100 text-primary-700' 
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Search className="w-4 h-4" />
            Scan URL
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'history' 
                ? 'bg-primary-100 text-primary-700' 
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <History className="w-4 h-4" />
            History
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'stats' 
                ? 'bg-primary-100 text-primary-700' 
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Analytics
          </button>
        </div>

        {/* Scan Tab */}
        {activeTab === 'scan' && (
          <div className="max-w-2xl">
            <div className="card p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter URL to Scan
              </label>
              <div className="flex gap-3">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="https://example.com"
                  className="input flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <button
                  onClick={() => handleScan()}
                  disabled={loading}
                  className="btn-primary px-6 py-3 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Scanning...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Search className="w-4 h-4" />
                      Scan
                    </span>
                  )}
                </button>
              </div>

              {error && (
                <div className="mt-4 p-4 bg-danger-50 border border-danger-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-danger-500" />
                    <p className="text-danger-700 font-medium">{error}</p>
                  </div>
                </div>
              )}

              {result && (
                <div className={`mt-6 p-6 rounded-xl border-2 ${
                  result.prediction === 'phishing' 
                    ? 'border-danger-500 bg-danger-50' 
                    : 'border-green-500 bg-green-50'
                }`}>
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full ${
                      result.prediction === 'phishing' 
                        ? 'bg-danger-100' 
                        : 'bg-green-100'
                    }`}>
                      {result.prediction === 'phishing' ? (
                        <AlertTriangle className="w-8 h-8 text-danger-600" />
                      ) : (
                        <CheckCircle className="w-8 h-8 text-green-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className={`text-2xl font-bold ${
                        result.prediction === 'phishing' 
                          ? 'text-danger-700' 
                          : 'text-green-700'
                      }`}>
                        {result.prediction === 'phishing' ? '⚠️ PHISHING DETECTED' : '✅ SAFE'}
                      </h3>
                      
                      <div className="mt-4 space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-200">
                          <span className="text-gray-600">URL</span>
                          <span className="font-medium text-gray-900 truncate max-w-xs">{result.url}</span>
                        </div>
                        
                        <div className="flex justify-between items-center py-2 border-b border-gray-200">
                          <span className="text-gray-600">Confidence</span>
                          <span className="font-bold text-lg">
                            {(result.confidence * 100).toFixed(1)}%
                          </span>
                        </div>
                        
                        <div className="flex justify-between items-center py-2 border-b border-gray-200">
                          <span className="text-gray-600">Threat Level</span>
                          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                            getThreatLevel(result.confidence).bg
                          } ${getThreatLevel(result.confidence).color}`}>
                            {getThreatLevel(result.confidence).level}
                          </span>
                        </div>
                        
                        {result.cached && (
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" />
                            </svg>
                            Cached result
                          </div>
                        )}
                        
                        {result.latency && (
                          <div className="text-sm text-gray-500">
                            Scan latency: {result.latency}ms
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <ScanHistory history={scanHistory} />
        )}

        {/* Stats Tab */}
        {activeTab === 'stats' && (
          <StatsChart 
            stats={stats} 
            history={scanHistory}
          />
        )}
      </main>
    </div>
  )
}

export default App
