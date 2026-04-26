import { useState, useRef, useCallback } from 'react'
import { authFetch } from '../utils/authFetch'

export interface CodeSuggestReq {
  prompt: string
  nodeType: string
  codeType: string
  existingCode?: string
  unitId?: string
  fieldKey?: string   // 현재 편집 중인 출력 필드 키 (모델에 플레이스홀더 힌트 제공)
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface ChatReq {
  prompt: string
  history: ChatMessage[]
}

// SSE spec: "data:" 뒤에 공백이 있으면 제거, 없으면 그대로.
// Spring WebFlux는 "data:content" (공백 없음) 형식으로 전송한다.
// 토큰에 \n이 포함되면 Spring이 "data:\ndata:\n\n"으로 인코딩하므로
// 하나의 이벤트(빈 줄 사이) 내 data: 라인들을 \n으로 합쳐야 \n이 보존된다.
function processEvent(event: string): string | null {
  const dataLines: string[] = []
  for (const line of event.split('\n')) {
    if (!line.startsWith('data:')) continue
    // Spring WebFlux는 "data:" + raw content 형식으로 전송한다.
    // LLM 토크나이저는 공백을 토큰 앞에 붙이므로 (예: " NODE0"),
    // Spring이 "data: NODE0"으로 보낼 때 SSE 스펙의 "선행 공백 1개 제거" 규칙을
    // 적용하면 실제 공백이 소실된다. Spring은 구분자 공백을 따로 추가하지 않으므로
    // 제거하지 않고 그대로 사용한다.
    dataLines.push(line.slice(5))
  }
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const event of events) {
      const token = processEvent(event)
      if (token !== null) yield token
    }
  }
  // flush remaining buffer
  if (buf.trim()) {
    const token = processEvent(buf)
    if (token !== null) yield token
  }
}

export function useLlmStream() {
  const [streaming, setStreaming] = useState(false)
  const [output, setOutput] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setOutput('')
    setStreaming(false)
  }, [])

  const streamCode = useCallback(async (req: CodeSuggestReq) => {
    reset()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)
    try {
      const res = await authFetch('/synapse/llm/code-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      })
      if (!res.body) return
      for await (const token of readSSE(res.body)) {
        setOutput((prev) => prev + token)
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setOutput((prev) => prev + '\n[연결 오류]')
    } finally {
      setStreaming(false)
    }
  }, [reset])

  const streamChat = useCallback(async (req: ChatReq) => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setOutput('')
    setStreaming(true)
    let result = ''
    try {
      const res = await authFetch('/synapse/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      })
      if (!res.body) return result
      for await (const token of readSSE(res.body)) {
        result += token
        setOutput(result)
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') result += '\n[연결 오류]'
    } finally {
      setStreaming(false)
    }
    return result
  }, [])

  return { streaming, output, streamCode, streamChat, stop, reset, setOutput }
}
