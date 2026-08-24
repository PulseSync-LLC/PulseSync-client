import { useRef } from 'react'

import type { DragEventHandler, MouseEventHandler, PointerEventHandler } from 'react'

type DragState = {
    pointerId: number
    startX: number
    scrollLeft: number
    moved: boolean
}

type CarouselDragOptions =
    | {
          mode: 'scroll'
          draggingClassName: string
      }
    | {
          mode: 'swipe'
          draggingClassName: string
          onSwipe: (direction: -1 | 1) => void
          swipeThreshold?: number
      }

type CarouselDragProps<T extends HTMLElement> = {
    onPointerDown: PointerEventHandler<T>
    onPointerMove: PointerEventHandler<T>
    onPointerUp: PointerEventHandler<T>
    onPointerCancel: PointerEventHandler<T>
    onClickCapture: MouseEventHandler<T>
    onDragStart: DragEventHandler<T>
}

export default function useCarouselDrag<T extends HTMLElement>(options: CarouselDragOptions): CarouselDragProps<T> {
    const dragRef = useRef<DragState | null>(null)
    const suppressClickRef = useRef(false)

    const onPointerDown: PointerEventHandler<T> = event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (event.target instanceof Element && event.target.closest('button, a')) return

        suppressClickRef.current = false
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            scrollLeft: event.currentTarget.scrollLeft,
            moved: false,
        }
    }

    const onPointerMove: PointerEventHandler<T> = event => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return

        const deltaX = event.clientX - drag.startX
        if (!drag.moved && Math.abs(deltaX) < 5) return

        if (!drag.moved) event.currentTarget.setPointerCapture(event.pointerId)
        drag.moved = true
        event.currentTarget.classList.add(options.draggingClassName)
        if (options.mode === 'scroll') event.currentTarget.scrollLeft = drag.scrollLeft - deltaX
        event.preventDefault()
    }

    const finishDrag = (event: Parameters<PointerEventHandler<T>>[0], cancelled: boolean) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return

        const deltaX = event.clientX - drag.startX
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        event.currentTarget.classList.remove(options.draggingClassName)
        dragRef.current = null
        suppressClickRef.current = drag.moved && !cancelled

        if (options.mode === 'swipe' && !cancelled && Math.abs(deltaX) >= (options.swipeThreshold ?? 50)) {
            options.onSwipe(deltaX < 0 ? 1 : -1)
        }

        if (suppressClickRef.current) {
            window.setTimeout(() => {
                suppressClickRef.current = false
            }, 0)
        }
    }

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp: event => finishDrag(event, false),
        onPointerCancel: event => finishDrag(event, true),
        onClickCapture: event => {
            if (!suppressClickRef.current) return
            suppressClickRef.current = false
            event.preventDefault()
            event.stopPropagation()
        },
        onDragStart: event => event.preventDefault(),
    }
}
