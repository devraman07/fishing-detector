const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export async function scanUrl(url) {
  const res = await fetch(`${API_URL}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Server error ${res.status}`)
  }
  
  return res.json()
}

export async function getStats() {
  const res = await fetch(`${API_URL}/api/stats`)
  
  if (!res.ok) {
    throw new Error(`Failed to get stats: ${res.status}`)
  }
  
  return res.json()
}

export async function checkHealth() {
  const res = await fetch(`${API_URL}/health`)
  return res.json()
}
