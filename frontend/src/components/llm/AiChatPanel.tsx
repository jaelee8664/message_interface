import { useState, useRef, useEffect } from 'react'
import { useLlmStream, ChatMessage } from '../../hooks/useLlmStream'

// ── Lightweight Markdown renderer ─────────────────────────────────────────────

function InlineText({ text }: { text: string }) {
  // **bold**, `code`, *italic* 처리
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} className="bg-slate-700 px-1 rounded text-green-300 font-mono text-[10px]">{part.slice(1, -1)}</code>
        if (part.startsWith('*') && part.endsWith('*'))
          return <em key={i} className="italic text-slate-300">{part.slice(1, -1)}</em>
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

function MarkdownBlock({ text, showCursor }: { text: string; showCursor?: boolean }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let key = 0

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const isLast = idx === lines.length - 1

    const h3 = line.match(/^###\s*(.+)/)
    if (h3) {
      elements.push(
        <p key={key++} className="font-bold text-violet-300 mt-2.5 mb-0.5 text-[11px] uppercase tracking-wide">
          <InlineText text={h3[1]} />{isLast && showCursor && <Cursor />}
        </p>
      )
      continue
    }

    const h2 = line.match(/^##\s*(.+)/)
    if (h2) {
      elements.push(
        <p key={key++} className="font-semibold text-violet-200 mt-3 mb-1 text-[12px] border-b border-slate-700 pb-0.5">
          <InlineText text={h2[1]} />{isLast && showCursor && <Cursor />}
        </p>
      )
      continue
    }

    const h1 = line.match(/^#\s*(.+)/)
    if (h1) {
      elements.push(
        <p key={key++} className="font-bold text-white mt-3 mb-1 text-[13px]">
          <InlineText text={h1[1]} />{isLast && showCursor && <Cursor />}
        </p>
      )
      continue
    }

    const bullet = line.match(/^[-*]\s+(.+)/)
    if (bullet) {
      elements.push(
        <div key={key++} className="flex gap-1.5 pl-1 my-0.5">
          <span className="text-violet-400 shrink-0 leading-5">•</span>
          <span className="text-slate-200 leading-5">
            <InlineText text={bullet[1]} />{isLast && showCursor && <Cursor />}
          </span>
        </div>
      )
      continue
    }

    const numbered = line.match(/^(\d+)\.\s+(.+)/)
    if (numbered) {
      elements.push(
        <div key={key++} className="flex gap-1.5 pl-1 my-0.5">
          <span className="text-slate-400 shrink-0 font-mono text-[10px] min-w-[14px] leading-5">{numbered[1]}.</span>
          <span className="text-slate-200 leading-5">
            <InlineText text={numbered[2]} />{isLast && showCursor && <Cursor />}
          </span>
        </div>
      )
      continue
    }

    if (line.trim() === '') {
      elements.push(<div key={key++} className="h-1" />)
      continue
    }

    elements.push(
      <p key={key++} className="text-slate-200 leading-5">
        <InlineText text={line} />{isLast && showCursor && <Cursor />}
      </p>
    )
  }

  return <div className="space-y-0.5 text-xs">{elements}</div>
}

function Cursor() {
  return <span className="inline-block w-1.5 h-3 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />
}

// ── Main component ─────────────────────────────────────────────────────────────

const PANEL_W = 340
const PANEL_H = 500

interface Props {
  onClose: () => void
}

export default function AiChatPanel({ onClose }: Props) {
  // ── 드래그 이동 ────────────────────────────────────────────────────────────
  const [pos, setPos] = useState(() => ({
    left: Math.max(0, window.innerWidth - PANEL_W - 16),
    top: Math.max(0, window.innerHeight - PANEL_H - 16),
  }))
  const isDragging = useRef(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, panelLeft: 0, panelTop: 0 })

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const dx = e.clientX - dragStart.current.mouseX
      const dy = e.clientY - dragStart.current.mouseY
      setPos({
        left: Math.max(0, Math.min(window.innerWidth - PANEL_W, dragStart.current.panelLeft + dx)),
        top: Math.max(0, Math.min(window.innerHeight - PANEL_H, dragStart.current.panelTop + dy)),
      })
    }
    const onUp = () => { isDragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── 채팅 ───────────────────────────────────────────────────────────────────
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const { streaming, output, streamChat } = useLlmStream()
  const bottomRef = useRef<HTMLDivElement>(null)

  // 스트리밍 중 output을 history의 마지막 assistant 메시지에 실시간 반영
  useEffect(() => {
    if (!streaming) return
    setHistory(prev => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = { role: 'assistant', content: output }
      }
      return updated
    })
  }, [output, streaming])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newHistory = [...history, userMsg]
    setHistory([...newHistory, { role: 'assistant', content: '' }])

    const result = await streamChat({ prompt: text, history: newHistory })

    setHistory(prev => {
      const updated = [...prev]
      if (updated[updated.length - 1]?.role === 'assistant') {
        updated[updated.length - 1] = { role: 'assistant', content: result ?? '' }
      }
      return updated
    })
  }

  const isError = (content: string) =>
    content.startsWith('[LLM_DISABLED]') || content.startsWith('[LLM_UNAVAILABLE]') || content.startsWith('[LLM_ERROR]')

  return (
    <div
      className="fixed z-50 flex flex-col bg-slate-900 border border-slate-700 rounded-xl shadow-2xl"
      style={{ width: PANEL_W, height: PANEL_H, left: pos.left, top: pos.top }}
    >
      {/* Header — 드래그 핸들 */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700 rounded-t-xl bg-slate-800 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          e.preventDefault()
          isDragging.current = true
          dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, panelLeft: pos.left, panelTop: pos.top }
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-violet-400 text-sm">✦</span>
          <span className="text-sm font-semibold text-white">AI 도우미</span>
          <span className="text-[10px] text-slate-500 mt-0.5">UI 기능 안내</span>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <button
              onClick={() => setHistory([])}
              className="text-[10px] text-slate-500 hover:text-slate-300 px-1"
              title="대화 초기화"
            >
              초기화
            </button>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {history.length === 0 && (
          <div className="text-center text-xs text-slate-600 mt-8 space-y-1">
            <p className="text-slate-500">UI 기능이나 설정 방법을 물어보세요.</p>
            <p>예: "NODE2 커스텀 코드는 어떻게 쓰나요?"</p>
            <p>예: "조건은 어떻게 설정하나요?"</p>
          </div>
        )}
        {history.map((msg, i) => {
          const isLastAssistant = i === history.length - 1 && msg.role === 'assistant'
          return (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' ? (
                <div className={`max-w-[92%] rounded-lg rounded-bl-sm px-3 py-2 ${
                  isError(msg.content)
                    ? 'bg-red-950 text-red-400 border border-red-800 text-xs'
                    : 'bg-slate-800'
                }`}>
                  {isError(msg.content)
                    ? <span className="text-xs">{msg.content}</span>
                    : <MarkdownBlock text={msg.content || ' '} showCursor={streaming && isLastAssistant} />
                  }
                </div>
              ) : (
                <div className="max-w-[85%] rounded-lg rounded-br-sm px-3 py-2 text-xs bg-blue-700 text-white whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-slate-700">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send() }}
            placeholder="질문 입력 (Ctrl+Enter 전송)"
            rows={2}
            disabled={streaming}
            className="flex-1 px-2 py-1.5 text-xs rounded bg-slate-800 border border-slate-600 text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 resize-none disabled:opacity-50"
          />
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <button
              onClick={send}
              disabled={!input.trim() || streaming}
              className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors w-full"
            >
              {streaming ? '...' : '전송'}
            </button>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">Ctrl+Enter</span>
          </div>
        </div>
      </div>
    </div>
  )
}
