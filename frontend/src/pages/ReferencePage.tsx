import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const SECTION_HINTS: Record<string, Record<string, string>> = {
  log: {
    retentionDays: '로그 파일 보존 기간 (일)',
    maxSizeGb: '로그 디렉터리 최대 용량 (GB). 초과 시 오래된 파일부터 삭제',
    directory: '로그 저장 디렉터리 경로',
    cleanupIntervalHours: '정리 작업 실행 주기 (시간)',
  },
  history: {
    maxVersions: '워크플로우 편집 이력 최대 보관 버전 수. 초과 시 오래된 버전 자동 삭제',
  },
  deadLetter: {
    enabled: '처리 실패 메시지를 Dead Letter로 보관할지 여부',
    retentionDays: 'Dead Letter 파일 보존 기간 (일)',
    directory: 'Dead Letter 저장 디렉터리 경로',
    cleanupIntervalHours: '정리 작업 실행 주기 (시간)',
  },
  mongoQueue: {
    doneRetentionHours: '처리 완료 메시지 보존 시간 (시간)',
    failedRetentionDays: '처리 실패 메시지 보존 기간 (일)',
    cleanupIntervalMinutes: '큐 정리 작업 실행 주기 (분)',
  },
  tcpServer: {
    idleTimeoutSeconds: '마지막 수신 후 이 시간 동안 데이터가 없으면 연결을 종료합니다. 0 = 비활성화. 모든 TCP_SERVER 유닛에 공통 적용',
  },
  webSocketServer: {
    pingEnabled: 'WebSocket Ping/Pong 활성화 여부. 비활성화 시 좀비 세션이 남을 수 있음',
    pingIntervalSeconds: '클라이언트에게 Ping을 보내는 간격 (초)',
    pongTimeoutSeconds: 'Pong 응답 대기 시간 (초). 초과 시 좀비 연결로 판단하고 세션 종료',
  },
}

export default function ReferencePage() {
  const { canWrite } = useAuthStore()
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
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-white">기준정보 설정</h1>
          {canWrite() && (
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              {saveStatus ?? '저장'}
            </button>
          )}
        </div>

        <div className="space-y-4">
          {renderSection('로그', 'log', config, setConfig)}
          {renderSection('히스토리', 'history', config, setConfig)}
          {renderSection('Dead Letter', 'deadLetter', config, setConfig)}
          {renderSection('MongoDB 큐', 'mongoQueue', config, setConfig)}
          {renderSection('TCP 서버', 'tcpServer', config, setConfig)}
          {renderSection('WebSocket 서버', 'webSocketServer', config, setConfig)}
          {renderGrpcServerSection(config, setConfig)}
          {renderLlmSection(config, setConfig)}
        </div>
      </div>
    </div>
  )
}

function renderFields(
  obj: Record<string, any>,
  sectionKey: string,
  subKey: string | undefined,
  setConfig: React.Dispatch<React.SetStateAction<Record<string, any>>>,
  hints?: Record<string, string>
): React.ReactNode[] {
  return Object.entries(obj).map(([field, value]) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return (
        <div key={field}>
          <div className="text-xs text-slate-500 mt-1 mb-1.5">{field}</div>
          <div className="pl-3 border-l border-slate-600/60 space-y-2">
            {renderFields(value as Record<string, any>, sectionKey, field, setConfig, hints)}
          </div>
        </div>
      )
    }

    const isBool = typeof value === 'boolean'
    const isNum = typeof value === 'number'
    const hint = hints?.[field]

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
        <div key={`${subKey ?? ''}-${field}`} className="space-y-0.5">
          <div className="flex items-center gap-3">
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
          {hint && <p className="text-[11px] text-slate-500 pl-44">{hint}</p>}
        </div>
      )
    }

    return (
      <div key={`${subKey ?? ''}-${field}`} className="space-y-0.5">
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400 w-40 shrink-0">{field}</label>
          <input
            type={isNum ? 'number' : 'text'}
            value={String(value)}
            onChange={(e) => handleChange(isNum ? Number(e.target.value) : e.target.value)}
            className="flex-1 px-2 py-1 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        {hint && <p className="text-[11px] text-slate-500 pl-44">{hint}</p>}
      </div>
    )
  })
}

function renderGrpcServerSection(
  config: Record<string, any>,
  setConfig: React.Dispatch<React.SetStateAction<Record<string, any>>>
) {
  const grpc = config['grpcServer'] ?? {}
  const set = (field: string, value: any) =>
    setConfig((prev) => ({ ...prev, grpcServer: { ...prev['grpcServer'], [field]: value } }))

  const numFields: { key: string; hint: string }[] = [
    { key: 'keepAliveIntervalSeconds', hint: '서버→클라이언트 ping 전송 간격 (초). 300 이상 권장' },
    { key: 'keepAliveTimeoutSeconds',  hint: 'pong 응답 대기 시간 (초). 초과 시 스트림 강제 종료' },
    { key: 'permitKeepAliveTime',      hint: '클라이언트 ping 허용 최소 간격 (초). 이보다 짧으면 거부. 기본 300초' },
  ]

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">gRPC 서버 keepAlive</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{grpc.keepAliveEnabled ? '활성화' : '비활성화'}</span>
          <button
            onClick={() => set('keepAliveEnabled', !grpc.keepAliveEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors ${grpc.keepAliveEnabled ? 'bg-blue-600' : 'bg-slate-600'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${grpc.keepAliveEnabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {numFields.map(({ key, hint }) => (
          <div key={key} className="space-y-0.5">
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400 w-48 shrink-0">{key}</label>
              <input
                type="number"
                value={grpc[key] ?? ''}
                onChange={(e) => set(key, Number(e.target.value))}
                className="flex-1 px-2 py-1 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <p className="text-[11px] text-slate-500 pl-52">{hint}</p>
          </div>
        ))}
        <div className="space-y-0.5">
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-400 w-48 shrink-0">permitKeepAliveWithoutCalls</label>
            <button
              onClick={() => set('permitKeepAliveWithoutCalls', !grpc.permitKeepAliveWithoutCalls)}
              className={`relative w-10 h-5 rounded-full transition-colors ${grpc.permitKeepAliveWithoutCalls ? 'bg-blue-600' : 'bg-slate-600'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${grpc.permitKeepAliveWithoutCalls ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
            <span className="text-xs text-slate-400">{grpc.permitKeepAliveWithoutCalls ? 'ON' : 'OFF'}</span>
          </div>
          <p className="text-[11px] text-slate-500 pl-52">활성 스트림이 없는 클라이언트의 ping 허용 여부</p>
        </div>
      </div>
    </div>
  )
}

function renderLlmSection(
  config: Record<string, any>,
  setConfig: React.Dispatch<React.SetStateAction<Record<string, any>>>
) {
  const llm = config['llm'] ?? {}
  const set = (field: string, value: any) =>
    setConfig((prev) => ({ ...prev, llm: { ...prev['llm'], [field]: value } }))

  const fields: { key: string; type: 'text' | 'number'; hint: string }[] = [
    { key: 'ollamaBaseUrl',  type: 'text',   hint: 'Ollama 서버 주소 (기본: http://localhost:11434)' },
    { key: 'codeModel',      type: 'text',   hint: 'Node2 코드 자동생성에 사용할 모델명' },
    { key: 'chatModel',      type: 'text',   hint: 'UI 설명 및 조건 제안에 사용할 모델명' },
    { key: 'timeoutSeconds', type: 'number', hint: 'LLM 요청 최대 대기 시간 (초)' },
  ]

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">로컬 LLM (Ollama)</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{llm.enabled ? '활성화' : '비활성화'}</span>
          <button
            onClick={() => set('enabled', !llm.enabled)}
            className={`relative w-10 h-5 rounded-full transition-colors ${llm.enabled ? 'bg-blue-600' : 'bg-slate-600'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${llm.enabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {fields.map(({ key, type, hint }) => (
          <div key={key} className="space-y-0.5">
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400 w-40 shrink-0">{key}</label>
              <input
                type={type}
                value={llm[key] ?? ''}
                onChange={(e) => set(key, type === 'number' ? Number(e.target.value) : e.target.value)}
                className="flex-1 px-2 py-1 text-sm rounded bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <p className="text-[11px] text-slate-500 pl-44">{hint}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-slate-700 pt-4 space-y-3">
        <p className="text-xs font-semibold text-slate-300">Ollama 설치 및 실행 방법</p>

        <div className="space-y-1">
          <p className="text-xs text-slate-400">
            <span className="text-yellow-400 font-mono mr-1">1.</span>
            아래 주소에서 Ollama를 다운로드하여 설치합니다.
          </p>
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-blue-400 hover:text-blue-300 underline font-mono ml-4"
          >
            https://ollama.com/download
          </a>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-slate-400">
            <span className="text-yellow-400 font-mono mr-1">2.</span>
            설치 후 CMD / Terminal에서 모델을 다운로드합니다.
          </p>
          <div className="ml-4 space-y-1">
            {[
              { label: '코드 생성 (codeModel 권장)', cmd: 'ollama pull qwen2.5-coder:7b' },
              { label: 'UI 도우미 (chatModel 권장)', cmd: 'ollama pull qwen2.5:7b' },
            ].map(({ label, cmd }) => (
              <div key={cmd}>
                <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
                <code className="block bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-green-300 font-mono">
                  {cmd}
                </code>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-slate-400">
            <span className="text-yellow-400 font-mono mr-1">3.</span>
            Ollama API 서버를 실행합니다.
          </p>
          <div className="ml-4 space-y-1.5">
            <code className="block bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-green-300 font-mono">
              ollama serve
            </code>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Windows / Mac은 설치 시 트레이 앱이 자동으로 서버를 실행하므로 별도 실행 불필요.<br />
              서버는 API 데몬만 띄우며 모델은 메모리에 올리지 않습니다.<br />
              모델은 첫 요청 시 자동 로드되고, 일정 시간 미사용 시 자동 언로드됩니다.<br />
              <span className="text-slate-400">종료:</span> 터미널에서 실행한 경우 <kbd className="bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-[9px] text-slate-300">Ctrl+C</kbd>,
              트레이 앱은 트레이 아이콘 우클릭 → <span className="text-slate-300">Quit Ollama</span>
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs text-slate-400">
            <span className="text-yellow-400 font-mono mr-1">4.</span>
            위 설정에서 <span className="text-white font-semibold">활성화</span> 토글을 켜고 모델명을 입력한 뒤 저장합니다.
          </p>
        </div>

        <p className="text-[11px] text-slate-600">
          * 기본 포트는 11434이며, 다른 포트를 사용한다면 ollamaBaseUrl을 수정하세요.
        </p>
      </div>
    </div>
  )
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
        {renderFields(section, key, undefined, setConfig, SECTION_HINTS[key])}
      </div>
    </div>
  )
}
