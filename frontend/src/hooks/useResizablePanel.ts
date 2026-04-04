import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag-to-resize hook for sidebar panels.
 * @param defaultWidth  Initial width in px
 * @param direction     'right' = handle on right edge (left panel), 'left' = handle on left edge (right panel)
 * @param storageKey    localStorage key to persist width across sessions
 * @param min / max     Clamp limits in px
 */
export function useResizablePanel(
  defaultWidth: number,
  {
    direction = 'right',
    storageKey,
    min = 160,
    max = 700,
  }: {
    direction?: 'right' | 'left'
    storageKey?: string
    min?: number
    max?: number
  } = {}
) {
  const getInitial = () => {
    if (storageKey) {
      const stored = Number(localStorage.getItem(storageKey))
      if (stored >= min && stored <= max) return stored
    }
    return defaultWidth
  }

  const [width, setWidth] = useState<number>(getInitial)
  const widthRef = useRef(width)
  widthRef.current = width

  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = widthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta =
        direction === 'right'
          ? e.clientX - startX.current
          : startX.current - e.clientX
      const next = Math.min(max, Math.max(min, startWidth.current + delta))
      setWidth(next)
    }

    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (storageKey) {
        localStorage.setItem(storageKey, String(widthRef.current))
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [direction, min, max, storageKey])

  return { width, onHandleMouseDown }
}
