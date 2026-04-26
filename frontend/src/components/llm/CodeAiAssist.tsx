import { useState } from 'react'
import { useLlmStream } from '../../hooks/useLlmStream'

interface Props {
  nodeType: 'NODE2' | 'NODE3'
  codeType: 'CUSTOM_CODE' | 'LIST_ITEM_CODE' | 'FILTER_CODE' | 'EXPR' | 'ADD_CONDITION'
  existingCode?: string
  unitId?: string
  fieldKey?: string   // 현재 편집 중인 필드 키 — LLM에 {$fieldKey} 힌트 제공
  onApply: (code: string) => void
}

const CODE_TYPE_LABELS: Record<string, string> = {
  CUSTOM_CODE: '커스텀 코드',
  LIST_ITEM_CODE: '원소 변환 코드',
  FILTER_CODE: '필터 코드',
  EXPR: '표현식',
  ADD_CONDITION: '추가 조건',
}

/** JS 코드 블록 추출: ```js ... ``` 또는 ``` ... ```, 없으면 전체 반환 */
function extractCode(text: string): string {
  const match = text.match(/```(?:js|javascript)?\n?([\s\S]*?)```/)
  if (match) return match[1].trim()
  return text.trim()
}

export default function CodeAiAssist({ nodeType, codeType, existingCode, unitId, fieldKey, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const { streaming, output, streamCode, stop, reset } = useLlmStream()

  const hasOutput = output.length > 0
  const isError = output.startsWith('[LLM_DISABLED]') || output.startsWith('[LLM_UNAVAILABLE]') || output.startsWith('[LLM_ERROR]')

  const handleGenerate = () => {
    if (!prompt.trim() || streaming) return
    streamCode({ prompt, nodeType, codeType, existingCode: existingCode || undefined, unitId, fieldKey: fieldKey || undefined })
  }

  const handleApply = () => {
    if (!hasOutput || isError) return
    onApply(extractCode(output))
  }

  const handleToggle = () => {
    if (open) { reset(); setPrompt('') }
    setOpen(!open)
  }

  return (
    <div className="mt-1">
      <button
        onClick={handleToggle}
        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${
          open ? 'bg-violet-700 text-white' : 'bg-slate-700 text-violet-400 hover:bg-slate-600'
        }`}
      >
        <span className="text-[10px]">✦</span>
        AI {CODE_TYPE_LABELS[codeType]} 추천
      </button>

      {open && (
        <div className="mt-1.5 rounded border border-violet-700/50 bg-slate-900 p-2.5 space-y-2">
          {/* Prompt input */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide">원하는 동작 설명</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate() }}
              placeholder={PLACEHOLDER[codeType]}
              rows={2}
              className="w-full px-2 py-1.5 text-xs font-mono rounded bg-slate-800 border border-slate-600 text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 resize-none"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5">
            {!streaming ? (
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="px-3 py-1 text-xs rounded bg-violet-600 hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors"
              >
                생성 (Ctrl+Enter)
              </button>
            ) : (
              <button
                onClick={stop}
                className="px-3 py-1 text-xs rounded bg-red-700 hover:bg-red-600 text-white"
              >
                중지
              </button>
            )}
            <button
              onClick={reset}
              className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-400"
            >
              초기화
            </button>
          </div>

          {/* Output */}
          {hasOutput && (
            <div className="space-y-1.5">
              <div className={`rounded p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto ${
                isError ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-slate-800 text-green-300'
              }`}>
                {output}
                {streaming && <span className="inline-block w-1.5 h-3 bg-green-400 animate-pulse ml-0.5 align-text-bottom" />}
              </div>
              {!isError && !streaming && (
                <button
                  onClick={handleApply}
                  className="w-full py-1 text-xs rounded bg-green-700 hover:bg-green-600 text-white font-medium"
                >
                  코드에 적용
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const PLACEHOLDER: Record<string, string> = {
  CUSTOM_CODE:    '예: body.status가 200이면 "SUCCESS", 아니면 "FAIL"',
  LIST_ITEM_CODE: '예: id 필드를 문자열로 변환, price에 10% 세율 적용',
  FILTER_CODE:    '예: qty가 0보다 크고 active가 true인 항목만',
  EXPR:           '예: body.userId와 현재 timestamp를 합친 객체',
  ADD_CONDITION:  '예: items 배열이 비어 있을 때만 추가',
}
