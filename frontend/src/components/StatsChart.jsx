import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { Shield, AlertTriangle, TrendingUp, Activity } from 'lucide-react'

export function StatsChart({ stats, history }) {
  // Calculate stats from history
  const phishingCount = history.filter(h => h.prediction === 'phishing').length
  const safeCount = history.filter(h => h.prediction === 'safe').length

  const pieData = [
    { name: 'Safe', value: safeCount, color: '#10b981' },
    { name: 'Phishing', value: phishingCount, color: '#ef4444' }
  ]

  // Mock data for daily scans (in production, this would come from API)
  const barData = [
    { day: 'Mon', scans: 12, blocked: 2 },
    { day: 'Tue', scans: 19, blocked: 4 },
    { day: 'Wed', scans: 15, blocked: 1 },
    { day: 'Thu', scans: 25, blocked: 5 },
    { day: 'Fri', scans: 22, blocked: 3 },
    { day: 'Sat', scans: 8, blocked: 0 },
    { day: 'Sun', scans: 10, blocked: 1 }
  ]

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-100 rounded-lg">
              <Activity className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Scanned</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalScanned.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-danger-100 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-danger-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Threats Blocked</p>
              <p className="text-2xl font-bold text-gray-900">{stats.blockedCount.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <Shield className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Safe Sites</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats.totalScanned > 0 
                  ? ((stats.totalScanned - stats.blockedCount) / stats.totalScanned * 100).toFixed(1)
                  : 0}%
              </p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <TrendingUp className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Cache Size</p>
              <p className="text-2xl font-bold text-gray-900">{stats.cacheSize.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart - Distribution */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Scan Results Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => value > 0 ? `${name}: ${value}` : ''}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bar Chart - Weekly Activity */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Weekly Activity</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="scans" name="Total Scans" fill="#14b8a6" />
                <Bar dataKey="blocked" name="Blocked" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
