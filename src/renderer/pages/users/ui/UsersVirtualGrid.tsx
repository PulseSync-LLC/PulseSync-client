import { useCallback, useMemo, useState } from 'react'

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'

import { USER_CARD_HEIGHT, USER_GRID_GAP } from '@pages/users/model/userList'
import UserCardV2 from '@entities/user/ui/userCardV2'

import * as s from '@pages/users/users.module.scss'

import type UserInterface from '@entities/user/model/user.interface'
import type { Range } from '@tanstack/react-virtual'
import type { RefObject } from 'react'

interface UsersVirtualGridProps {
    users: UserInterface[]
    columns: number
    scrollElementRef: RefObject<HTMLDivElement | null>
    scrollMargin: number
    openProfile: (profileName: string) => void
    animationsEnabledRef: RefObject<boolean>
    scrollDirectionRef: RefObject<'up' | 'down'>
}

export default function UsersVirtualGrid({
    users,
    columns,
    scrollElementRef,
    scrollMargin,
    openProfile,
    animationsEnabledRef,
    scrollDirectionRef,
}: UsersVirtualGridProps) {
    'use no memo'

    // The virtualizer is mutable; keep its render reads outside React Compiler memoization.
    const [focusedUserId, setFocusedUserId] = useState<string | null>(null)
    const focusedIndex = useMemo(() => (focusedUserId === null ? -1 : users.findIndex(user => user.id === focusedUserId)), [focusedUserId, users])
    const focusedRow = focusedIndex < 0 ? -1 : Math.floor(focusedIndex / columns)
    const getItemKey = useCallback((index: number) => `${columns}:${users[index * columns].id}`, [columns, users])
    const rangeExtractor = useCallback(
        (range: Range) => {
            const indexes = defaultRangeExtractor(range)
            if (focusedRow < 0) return indexes

            // Retain focus and adjacent rows so ordinary Tab navigation can continue off screen.
            for (let index = Math.max(0, focusedRow - 1); index <= Math.min(range.count - 1, focusedRow + 1); index++) {
                if (!indexes.includes(index)) indexes.push(index)
            }
            return indexes.sort((left, right) => left - right)
        },
        [focusedRow],
    )
    const virtualizer = useVirtualizer({
        count: Math.ceil(users.length / columns),
        getScrollElement: () => scrollElementRef.current,
        getItemKey,
        estimateSize: () => USER_CARD_HEIGHT,
        gap: USER_GRID_GAP,
        scrollMargin,
        overscan: 3,
        rangeExtractor,
    })

    return (
        <div
            className={s.virtualGrid}
            style={{ height: virtualizer.getTotalSize() }}
            onBlurCapture={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocusedUserId(null)
            }}
        >
            {virtualizer.getVirtualItems().map(row => (
                <div
                    key={row.key}
                    className={s.virtualRow}
                    data-index={row.index}
                    style={{
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                        height: row.size,
                        transform: `translateY(${row.start - scrollMargin}px)`,
                    }}
                >
                    {users.slice(row.index * columns, (row.index + 1) * columns).map(user => (
                        <div key={user.id} onFocusCapture={() => setFocusedUserId(user.id)}>
                            <UserCardV2
                                user={user}
                                onClick={openProfile}
                                animationsEnabledRef={animationsEnabledRef}
                                scrollDirectionRef={scrollDirectionRef}
                                eagerVisible
                            />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}
