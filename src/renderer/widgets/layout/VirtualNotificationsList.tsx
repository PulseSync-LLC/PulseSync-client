import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'

import * as styles from '@widgets/layout/NotificationsBell.module.scss'

import type { NotificationItem } from '@app/providers/notifications/types'
import type { Range } from '@tanstack/react-virtual'
import type { ReactNode } from 'react'

interface VirtualNotificationsListProps {
    items: NotificationItem[]
    onEndReached?: () => Promise<void>
    footer?: ReactNode
    children: (item: NotificationItem) => ReactNode
}

export default function VirtualNotificationsList({ items, onEndReached, footer, children }: VirtualNotificationsListProps) {
    'use no memo'

    const scrollRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const [focusedId, setFocusedId] = useState<string | null>(null)
    const focusedIndex = useMemo(() => (focusedId === null ? -1 : items.findIndex(item => item.id === focusedId)), [focusedId, items])
    const getItemKey = useCallback((index: number) => items[index].id, [items])
    const rangeExtractor = useCallback(
        (range: Range) => {
            const indexes = defaultRangeExtractor(range)
            if (focusedIndex < 0) return indexes
            for (let index = Math.max(0, focusedIndex - 1); index <= Math.min(range.count - 1, focusedIndex + 1); index++) {
                if (!indexes.includes(index)) indexes.push(index)
            }
            return indexes.sort((left, right) => left - right)
        },
        [focusedIndex],
    )
    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: items.length,
        getScrollElement: () => scrollRef.current,
        getItemKey,
        estimateSize: () => 160,
        // Ignore the panel's opening scale when measuring card height.
        measureElement: element => element.offsetHeight,
        gap: 8,
        paddingStart: 12,
        paddingEnd: 12,
        overscan: 2,
        rangeExtractor,
    })
    const virtualItems = virtualizer.getVirtualItems()
    // Use the visible range, excluding any offscreen row retained for keyboard focus.
    const endIndex = virtualizer.range?.endIndex ?? -1

    useEffect(() => {
        if (endIndex >= 0 && endIndex >= items.length - 3) void onEndReached?.()
    }, [endIndex, items.length, onEndReached])

    useLayoutEffect(() => {
        const scrollElement = scrollRef.current
        if (!scrollElement) return
        let width = scrollElement.clientWidth
        const observer = new ResizeObserver(() => {
            if (width === scrollElement.clientWidth) return
            width = scrollElement.clientWidth
            virtualizer.measure()
            for (const row of Array.from(contentRef.current?.children ?? [])) {
                if (row instanceof HTMLDivElement) virtualizer.measureElement(row)
            }
        })
        observer.observe(scrollElement)
        return () => observer.disconnect()
    }, [virtualizer])

    return (
        <div
            ref={scrollRef}
            className={styles.notificationsVirtualViewport}
            onBlurCapture={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null)
            }}
        >
            <div ref={contentRef} className={styles.notificationsVirtualContent} style={{ height: virtualizer.getTotalSize() }}>
                {virtualItems.map(row => (
                    <div
                        key={row.key}
                        ref={virtualizer.measureElement}
                        data-index={row.index}
                        className={styles.notificationsVirtualRow}
                        style={{ transform: `translateY(${row.start}px)` }}
                        onFocusCapture={() => setFocusedId(items[row.index].id)}
                    >
                        {children(items[row.index])}
                    </div>
                ))}
            </div>
            {footer}
        </div>
    )
}
