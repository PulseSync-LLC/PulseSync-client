import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import cn from 'clsx'
import * as styles from './Scrollbar.module.scss'

interface ScrollbarProps {
    children: React.ReactNode
    className?: string
    classNameInner?: string
    duration?: number
    onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
}

const Scrollbar = forwardRef<HTMLDivElement, ScrollbarProps>(({ children, className, classNameInner, duration = 400, onScroll }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const thumbRef = useRef<HTMLDivElement>(null)
    const trackRef = useRef<HTMLDivElement>(null)
    const [thumbHeight, setThumbHeight] = useState(3)

    const isDragging = useRef(false)
    const dragStartY = useRef(0)
    const scrollStartTop = useRef(0)

    useImperativeHandle(ref, () => containerRef.current!)

    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

    const updateThumbSize = () => {
        const container = containerRef.current!
        const ratio = container.clientHeight / container.scrollHeight
        const maxThumbHeight = container.clientHeight
        const size = Math.min(Math.max(ratio * container.clientHeight, 20), maxThumbHeight)
        setThumbHeight(size)
    }

    const updateThumbPosition = () => {
        const container = containerRef.current!
        const thumb = thumbRef.current!
        const scrollTop = container.scrollTop
        const scrollHeight = container.scrollHeight
        const clientHeight = container.clientHeight
        const thumbH = thumb.offsetHeight

        if (scrollHeight <= clientHeight) {
            thumb.style.display = 'none'
            return
        }

        const ratio = scrollTop / (scrollHeight - clientHeight)
        const maxThumbTop = clientHeight - thumbH - 10
        const top = Math.min(ratio * maxThumbTop, maxThumbTop)
        thumb.style.transform = `translateY(${top}px)`
        thumb.style.display = 'block'
    }

    const smoothScrollTo = (target: number) => {
        const container = containerRef.current!
        const start = container.scrollTop
        const distance = target - start
        const startTime = performance.now()

        const step = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1)
            container.scrollTop = start + distance * ease(progress)
            if (progress < 1) requestAnimationFrame(step)
        }

        requestAnimationFrame(step)
    }

    useEffect(() => {
        const container = containerRef.current!
        const thumb = thumbRef.current!
        const track = trackRef.current!

        const hovered = { current: false }

        const updateTrackOpacity = () => {
            track.style.opacity = hovered.current || isDragging.current ? '1' : '0'
        }

        updateThumbSize()
        updateThumbPosition()

        const onThumbMouseDown = (e: MouseEvent) => {
            isDragging.current = true
            dragStartY.current = e.clientY
            scrollStartTop.current = container.scrollTop
            document.body.style.userSelect = 'none'
            track.className = `${styles.scrollbarTrack} ${styles.scrollbarTrackHover}`
            updateTrackOpacity()
        }

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return
            const deltaY = e.clientY - dragStartY.current
            const maxScroll = container.scrollHeight - container.clientHeight
            container.scrollTop = Math.max(
                0,
                Math.min(scrollStartTop.current + (deltaY / container.clientHeight) * container.scrollHeight, maxScroll),
            )
        }

        const onMouseUp = () => {
            if (isDragging.current) {
                isDragging.current = false
                document.body.style.userSelect = ''
                track.className = `${styles.scrollbarTrack}`
                updateTrackOpacity()
            }
        }

        const onClickAnchor = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('#')) {
                e.preventDefault()
                const id = target.getAttribute('href')!.substring(1)
                const el = document.getElementById(id)
                if (el) smoothScrollTo(el.offsetTop)
            }
        }

        const onMouseEnter = () => {
            hovered.current = true
            updateTrackOpacity()
        }
        const onMouseLeave = () => {
            hovered.current = false
            updateTrackOpacity()
        }

        const onResize = () => {
            updateThumbSize()
            updateThumbPosition()
        }

        const observer = new MutationObserver(() => {
            updateThumbSize()
            updateThumbPosition()
        })

        observer.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
        })

        thumb.addEventListener('mousedown', onThumbMouseDown)
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
        container.addEventListener('click', onClickAnchor)

        container.addEventListener('mouseenter', onMouseEnter)
        container.addEventListener('mouseleave', onMouseLeave)
        track.addEventListener('mouseenter', onMouseEnter)
        track.addEventListener('mouseleave', onMouseLeave)

        window.addEventListener('resize', onResize)

        return () => {
            observer.disconnect()
            thumb.removeEventListener('mousedown', onThumbMouseDown)
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            container.removeEventListener('click', onClickAnchor)

            container.removeEventListener('mouseenter', onMouseEnter)
            container.removeEventListener('mouseleave', onMouseLeave)
            track.removeEventListener('mouseenter', onMouseEnter)
            track.removeEventListener('mouseleave', onMouseLeave)

            window.removeEventListener('resize', onResize)
        }
    }, [duration])

    return (
        <div className={cn(className, styles.scrollWrapper)} style={className ? {} : { height: '100%', width: '100%' }}>
            <div
                className={cn(classNameInner, styles.scrollContent)}
                style={className ? {} : { height: '100%', width: '100%' }}
                ref={containerRef}
                onScroll={e => {
                    updateThumbPosition()
                    onScroll && onScroll(e)
                }}
            >
                {children}
            </div>
            <div className={styles.scrollbarTrack} ref={trackRef}>
                <div className={styles.scrollbarThumb} ref={thumbRef} style={{ height: `${thumbHeight}px` }} />
            </div>
        </div>
    )
})

export default Scrollbar
