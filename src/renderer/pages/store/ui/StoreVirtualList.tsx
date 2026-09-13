import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'

import * as st from '@pages/store/store.module.scss'

import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'
import type { Range } from '@tanstack/react-virtual'
import type { ReactNode, RefObject } from 'react'

interface StoreVirtualListProps {
    addons: StoreAddon[]
    scrollElementRef: RefObject<HTMLDivElement | null>
    children: (addon: StoreAddon) => ReactNode
}

export default function StoreVirtualList({ addons, scrollElementRef, children }: StoreVirtualListProps) {
    'use no memo'

    const listRef = useRef<HTMLDivElement>(null)
    const [scrollMargin, setScrollMargin] = useState(0)
    const [focusedId, setFocusedId] = useState<string | null>(null)
    const focusedIndex = useMemo(() => (focusedId === null ? -1 : addons.findIndex(addon => addon.id === focusedId)), [addons, focusedId])
    const getItemKey = useCallback((index: number) => addons[index].id, [addons])
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
        count: addons.length,
        getScrollElement: () => scrollElementRef.current,
        getItemKey,
        estimateSize: () => 140,
        measureElement: element => element.offsetHeight,
        gap: 10,
        overscan: 3,
        scrollMargin,
        rangeExtractor,
    })

    useLayoutEffect(() => {
        const list = listRef.current
        const scrollElement = scrollElementRef.current
        if (!list || !scrollElement) return

        let width = list.clientWidth
        const updateLayout = () => {
            setScrollMargin(list.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop)
            if (width !== list.clientWidth) {
                width = list.clientWidth
                virtualizer.measure()
                for (const row of Array.from(list.children)) {
                    if (row instanceof HTMLDivElement) virtualizer.measureElement(row)
                }
            }
        }
        updateLayout()
        const observer = new ResizeObserver(updateLayout)
        observer.observe(list)
        observer.observe(scrollElement)
        // The featured section and poster rail above the list can change its origin.
        if (scrollElement.firstElementChild) observer.observe(scrollElement.firstElementChild)
        return () => observer.disconnect()
    }, [scrollElementRef, virtualizer])

    return (
        <div
            ref={listRef}
            className={st.storeVirtualList}
            style={{ height: virtualizer.getTotalSize() }}
            onBlurCapture={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null)
            }}
        >
            {virtualizer.getVirtualItems().map(row => (
                <div
                    key={row.key}
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    className={st.storeVirtualRow}
                    style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
                    onFocusCapture={() => setFocusedId(addons[row.index].id)}
                >
                    {children(addons[row.index])}
                </div>
            ))}
        </div>
    )
}
