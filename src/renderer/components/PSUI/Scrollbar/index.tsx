import React, { useEffect, useRef, useState } from 'react'
import * as styles from './Scrollbar.module.scss'

interface ScrollbarProps {
    children: React.ReactNode
    className?: string
    classNameInner?: string
    duration?: number
}

const Scrollbar: React.FC<ScrollbarProps> = ({ children, className, classNameInner, duration = 400 }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const thumbRef = useRef<HTMLDivElement>(null)
    const trackRef = useRef<HTMLDivElement>(null)
    const [thumbHeight, setThumbHeight] = useState(3)

    const isDragging = useRef(false)
    const dragStartY = useRef(0)
    const scrollStartTop = useRef(0)

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
        const thumbHeight = thumb.offsetHeight

        if (scrollHeight <= clientHeight) {
            thumb.style.display = 'none'
            return
        }

        const ratio = scrollTop / (scrollHeight - clientHeight)
        const maxThumbTop = clientHeight - thumbHeight - 10
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

        const onScroll = () => updateThumbPosition()
        const onMouseDown = (e: MouseEvent) => {
            e.preventDefault()
            isDragging.current = true
            dragStartY.current = e.clientY
            scrollStartTop.current = container.scrollTop
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
            isDragging.current = false
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
            track.style.opacity = '1'
        }
        const onMouseLeave = () => {
            track.style.opacity = '0'
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

        container.addEventListener('scroll', onScroll)
        thumb.addEventListener('mousedown', onMouseDown)
        container.addEventListener('mousemove', onMouseMove)
        container.addEventListener('mouseup', onMouseUp)
        container.addEventListener('click', onClickAnchor)

        container.addEventListener('mouseenter', onMouseEnter)
        container.addEventListener('mouseleave', onMouseLeave)
        track.addEventListener('mouseenter', onMouseEnter)
        track.addEventListener('mouseleave', onMouseLeave)

        window.addEventListener('resize', onResize)

        return () => {
            observer.disconnect()

            container.removeEventListener('scroll', onScroll)
            thumb.removeEventListener('mousedown', onMouseDown)
            container.removeEventListener('mousemove', onMouseMove)
            container.removeEventListener('mouseup', onMouseUp)
            container.removeEventListener('click', onClickAnchor)

            container.removeEventListener('mouseenter', onMouseEnter)
            container.removeEventListener('mouseleave', onMouseLeave)
            track.removeEventListener('mouseenter', onMouseEnter)
            track.removeEventListener('mouseleave', onMouseLeave)

            window.removeEventListener('resize', onResize)
        }
    }, [duration])

    return (
        <div className={`${className || ''} ${styles.scrollWrapper}`} style={className ? {} : { height: '100%', width: '100%' }}>
            <div
                className={`${classNameInner || ''} ${styles.scrollContent}`}
                style={className ? {} : { height: '100%', width: '100%' }}
                ref={containerRef}
            >
                {children}
            </div>
            <div className={styles.scrollbarTrack} ref={trackRef}>
                <div className={styles.scrollbarThumb} ref={thumbRef} style={{ height: `${thumbHeight}px` }} />
            </div>
        </div>
    )
}

export default Scrollbar