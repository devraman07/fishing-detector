import { useState } from "react"
import { scanUrl } from "./api"

function App() {
  const [url, setUrl] = useState("")
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleScan = async () => {
    if (!url.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const data = await scanUrl(url.trim())
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleScan()
  }

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 480, margin: "60px auto", padding: "0 16px" }}>
      <h1>🛡️ Secure Browse Guard</h1>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://example.com"
          style={{ flex: 1, padding: "8px 12px", fontSize: 14 }}
        />
        <button onClick={handleScan} disabled={loading} style={{ padding: "8px 16px" }}>
          {loading ? "Scanning…" : "Scan"}
        </button>
      </div>

      {error && (
        <p style={{ color: "red", marginTop: 12 }}>⚠️ {error}</p>
      )}

      {result && (
        <div style={{
          marginTop: 16,
          padding: 16,
          border: `2px solid ${result.result === "suspicious" ? "red" : "green"}`,
          borderRadius: 8
        }}>
          <p style={{ margin: 0, fontWeight: "bold", color: result.result === "suspicious" ? "red" : "green" }}>
            {result.result === "suspicious" ? "⚠️ SUSPICIOUS" : "✅ SAFE"}
          </p>
          <p style={{ margin: "8px 0 0" }}>Confidence: {(result.confidence * 100).toFixed(1)}%</p>
        </div>
      )}
    </div>
  )
}

export default App
