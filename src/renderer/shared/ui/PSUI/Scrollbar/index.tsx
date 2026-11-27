import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import cn from 'clsx'

import * as styles from '@shared/ui/PSUI/Scrollbar/Scrollbar.module.scss'

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
    const geometryFrame = useRef<number | undefined>(undefined)
    const scrollFrame = useRef<number | undefined>(undefined)

    const isDragging = useRef(false)
    const dragStartY = useRef(0)
    const scrollStartTop = useRef(0)

    useImperativeHandle(ref, () => containerRef.current!, [])

    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

    const updateThumbGeometry = () => {
        const container = containerRef.current
        const thumb = thumbRef.current
        if (!container || !thumb) return
        const clientHeight = container.clientHeight
        const scrollHeight = container.scrollHeight
        const scrollTop = container.scrollTop
        if (clientHeight <= 0 || scrollHeight <= clientHeight) {
            thumb.style.display = 'none'
            return
        }
        const height = Math.min(Math.max((clientHeight / scrollHeight) * clientHeight, 20), clientHeight)
        const maxTop = Math.max(0, clientHeight - height - 10)
        const top = Math.min((scrollTop / (scrollHeight - clientHeight)) * maxTop, maxTop)
        thumb.style.height = `${height}px`
        thumb.style.transform = `translateY(${top}px)`
        thumb.style.display = 'block'
    }

    const scheduleGeometry = () => {
        if (geometryFrame.current !== undefined) return
        geometryFrame.current = requestAnimationFrame(() => {
            geometryFrame.current = undefined
            updateThumbGeometry()
        })
    }

    const smoothScrollTo = (target: number) => {
        const container = containerRef.current
        if (!container) return
        if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current)
        const start = container.scrollTop
        const distance = target - start
        const startTime = performance.now()

        const step = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1)
            container.scrollTop = start + distance * ease(progress)
            scrollFrame.current = progress < 1 ? requestAnimationFrame(step) : undefined
        }

        scrollFrame.current = requestAnimationFrame(step)
    }

    useEffect(() => {
        const container = containerRef.current
        const thumb = thumbRef.current
        const track = trackRef.current
        if (!container || !thumb || !track) return

        const hovered = { current: false }

        const updateTrackOpacity = () => {
            track.style.opacity = hovered.current || isDragging.current ? '1' : '0'
        }

        updateThumbGeometry()

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

        const resizeObserver = new ResizeObserver(scheduleGeometry)
        const observeContent = () => {
            resizeObserver.disconnect()
            resizeObserver.observe(container)
            for (const child of container.children) resizeObserver.observe(child)
        }
        observeContent()
        const observer = new MutationObserver(records => {
            if (records.some(record => record.type === 'childList' && record.target === container)) observeContent()
            scheduleGeometry()
        })
        observer.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'open', 'width', 'height'],
            characterData: true,
        })
        container.addEventListener('load', scheduleGeometry, true)

        thumb.addEventListener('mousedown', onThumbMouseDown)
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
        container.addEventListener('click', onClickAnchor)

        container.addEventListener('mouseenter', onMouseEnter)
        container.addEventListener('mouseleave', onMouseLeave)
        track.addEventListener('mouseenter', onMouseEnter)
        track.addEventListener('mouseleave', onMouseLeave)

        window.addEventListener('resize', scheduleGeometry)

        return () => {
            observer.disconnect()
            resizeObserver.disconnect()
            container.removeEventListener('load', scheduleGeometry, true)
            if (geometryFrame.current !== undefined) cancelAnimationFrame(geometryFrame.current)
            if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current)
            geometryFrame.current = undefined
            scrollFrame.current = undefined
            if (isDragging.current) document.body.style.userSelect = ''
            thumb.removeEventListener('mousedown', onThumbMouseDown)
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            container.removeEventListener('click', onClickAnchor)

            container.removeEventListener('mouseenter', onMouseEnter)
            container.removeEventListener('mouseleave', onMouseLeave)
            track.removeEventListener('mouseenter', onMouseEnter)
            track.removeEventListener('mouseleave', onMouseLeave)

            window.removeEventListener('resize', scheduleGeometry)
        }
    }, [duration])

    return (
        <div className={cn(className, styles.scrollWrapper)} style={className ? {} : { height: '100%', width: '100%' }}>
            <div
                className={cn(classNameInner, styles.scrollContent)}
                style={className ? {} : { height: '100%', width: '100%' }}
                ref={containerRef}
                onScroll={e => {
                    scheduleGeometry()
                    onScroll?.(e)
                }}
            >
                {children}
            </div>
            <div className={styles.scrollbarTrack} ref={trackRef}>
                <div className={styles.scrollbarThumb} ref={thumbRef} />
            </div>
        </div>
    )
})

export default Scrollbar
