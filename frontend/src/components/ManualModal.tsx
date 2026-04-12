import { useState } from 'react'
import axios from 'axios'

type ManualFormat = 'MARKDOWN' | 'WORD'

interface Props {
  unitIds: string[]
  onClose: () => void
}

export default function ManualModal({ unitIds, onClose }: Props) {
  const [format, setFormat] = useState<ManualFormat>('MARKDOWN')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.post(
        '/synapse/manual',
        { unitIds, format },
        { responseType: 'blob' }
      )
      const filename = format === 'MARKDOWN' ? 'protocol-manual.md' : 'protocol-manual.docx'
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (e: any) {
      setError('프로토콜 정의서 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-80 bg-slate-900 rounded-xl border border-slate-700 shadow-2xl pointer-events-auto p-5 space-y-5">
          <div className="text-base font-semibold text-white">프로토콜 정의서 생성</div>

          <div className="text-sm text-slate-400">
            {unitIds.length}개 워크플로우 단위의 매뉴얼을 생성합니다.
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-400 font-medium mb-1">출력 형식</div>
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              format === 'MARKDOWN'
                ? 'border-blue-500 bg-blue-900/30'
                : 'border-slate-700 hover:border-slate-500'
            }`}>
              <input
                type="radio"
                name="format"
                value="MARKDOWN"
                checked={format === 'MARKDOWN'}
                onChange={() => setFormat('MARKDOWN')}
                className="accent-blue-500"
              />
              <div>
                <div className="text-sm font-medium text-white">Markdown</div>
                <div className="text-xs text-slate-400">개발자 친화적, .md 파일</div>
              </div>
            </label>
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              format === 'WORD'
                ? 'border-blue-500 bg-blue-900/30'
                : 'border-slate-700 hover:border-slate-500'
            }`}>
              <input
                type="radio"
                name="format"
                value="WORD"
                checked={format === 'WORD'}
                onChange={() => setFormat('WORD')}
                className="accent-blue-500"
              />
              <div>
                <div className="text-sm font-medium text-white">Word</div>
                <div className="text-xs text-slate-400">범용적, .docx 파일</div>
              </div>
            </label>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white"
            >
              취소
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex-1 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '생성 중...' : '다운로드'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
