import { useState, useEffect } from 'react'
import axios from 'axios'

export default function ReferencePage() {
  const [config, setConfig] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  useEffect(() => {
    axios.get('/synapse/reference')
      .then((res) => { setConfig(res.data.data); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [])

  const handleSave = async () => {
    try {
      await axios.put('/synapse/reference', config)
      setSaveStatus('저장 완료')
      setTimeout(() => setSaveStatus(null), 2000)
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (loading) return <div className="p-6 text-slate-400">로딩 중...</div>
  if (error) return <div className="p-6 text-red-400">{error}</div>

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">기준정보 설정</h1>
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
        >
          {saveStatus ?? '저장'}
        </button>
      </div>

      <div className="space-y-4">
        {renderSection('로그', 'log', config, setConfig)}
        {renderSection('히스토리', 'history', config, setConfig)}
        {renderSection('Dead Letter', 'deadLetter', config, setConfig)}
        {renderSection('MongoDB 큐', 'mongoQueue', config, setConfig)}
      </div>
    </div>
  )
}

function renderFields(
  obj: Record<string, any>,
  sectionKey: string,
  subKey: string | undefined,
  setConfig: React.Dispatch<React.SetStateAction<Record<string, any>>>
): React.ReactNode[] {
  return Object.entries(obj).map(([field, value]) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return (
        <div key={field}>
          <div className="text-xs text-slate-500 mt-1 mb-1.5">{field}</div>
          <div className="pl-3 border-l border-slate-600/60 space-y-2">
            {renderFields(value as Record<string, any>, sectionKey, field, setConfig)}
          </div>
        </div>
      )
    }

    const isBool = typeof value === 'boolean'
    const isNum = typeof value === 'number'

    const handleChange = (newVal: any) => {
      setConfig((prev) => {
        if (subKey) {
          return {
            ...prev,
            [sectionKey]: {
              ...prev[sectionKey],
              [subKey]: { ...(prev[sectionKey]?.[subKey] ?? {}), [field]: newVal },
            },
          }
        }
        return { ...prev, [sectionKey]: { ...prev[sectionKey], [field]: newVal } }
      })
    }

    if (isBool) {
      return (
        <div key={`${subKey ?? ''}-${field}`} className="flex items-center gap-3">
          <label className="text-xs text-slate-400 w-40 shrink-0">{field}</label>
          <button
            onClick={() => handleChange(!value)}
            className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-slate-600'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-xs text-slate-400">{value ? 'ON' : 'OFF'}</span>
        </div>
      )
    }

    return (
      <div key={`${subKey ?? ''}-${field}`} className="flex items-center gap-3">
        <label className="text-xs text-slate-400 w-40 shrink-0">{field}</label>
        <input
          type={isNum ? 'number' : 'text'}
          value={String(value)}
          onChange={(e) => handleChange(isNum ? Number(e.target.value) : e.target.value)}
          className="flex-1 px-2 py-1 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
        />
      </div>
    )
  })
}

function renderSection(
  title: string,
  key: string,
  config: Record<string, any>,
  setConfig: React.Dispatch<React.SetStateAction<Record<string, any>>>
) {
  const section = config[key]
  if (!section) return null
  return (
    <div key={key} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <h2 className="text-sm font-semibold text-white mb-3">{title}</h2>
      <div className="space-y-2">
        {renderFields(section, key, undefined, setConfig)}
      </div>
    </div>
  )
}
