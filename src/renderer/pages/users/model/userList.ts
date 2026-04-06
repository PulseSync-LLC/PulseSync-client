import UserInterface from '@entities/user/model/user.interface'
import { getEffectiveLevelInfo } from '@shared/lib/levelInfo'

export const SORT_FIELDS = ['lastOnline', 'createdAt', 'username', 'level'] as const
export const USER_CARD_MIN_WIDTH = 300
export const USER_CARD_HEIGHT = 150
export const USER_GRID_GAP = 10

const USER_BATCH_VIEWPORTS = 3
const MAX_USERS_PER_PAGE = 150

export type UserGridMetrics = {
    columns: number
    visibleRows: number
    visibleCount: number
    perPage: number
    prefetchOffsetPx: number
}

export type SortField = (typeof SORT_FIELDS)[number]
export type SortState = { id: SortField; desc: boolean }[]

const SAFE_LEVEL_V2 = {
    totalPoints: 0,
}

export function normalizeUser(u: any): UserInterface {
    const levelInfoV2 = u?.levelInfoV2 && typeof u.levelInfoV2 === 'object' ? { ...SAFE_LEVEL_V2, ...u.levelInfoV2 } : SAFE_LEVEL_V2

    return {
        ...u,
        badges: Array.isArray(u?.badges) ? u.badges : [],
        levelInfoV2,
    }
}

export function sortUsers(rawUsers: UserInterface[], sortingState: SortState): UserInterface[] {
    const id = sortingState[0].id
    const desc = sortingState[0].desc
    const arr = rawUsers.map(normalizeUser)

    if (id === 'lastOnline') {
        return [...arr].sort((a, b) => {
            const aOnline = a.status === 'online'
            const bOnline = b.status === 'online'
            if (aOnline !== bOnline) return aOnline ? -1 : 1
            const aT = a.lastOnline ? Number(a.lastOnline) : 0
            const bT = b.lastOnline ? Number(b.lastOnline) : 0
            if (aT === bT) return 0
            return desc ? bT - aT : aT - bT
        })
    }

    if (id === 'createdAt') {
        return [...arr].sort((a, b) => {
            const aT = a.createdAt ? Number(a.createdAt) : 0
            const bT = b.createdAt ? Number(b.createdAt) : 0
            return desc ? bT - aT : aT - bT
        })
    }

    if (id === 'username') {
        return [...arr].sort((a, b) => {
            const result = (a.username || '').localeCompare(b.username || '', undefined, { sensitivity: 'base' })
            return desc ? -result : result
        })
    }

    if (id === 'level') {
        return [...arr].sort((a, b) => {
            const aPoints = getEffectiveLevelInfo(a).totalPoints
            const bPoints = getEffectiveLevelInfo(b).totalPoints
            return desc ? bPoints - aPoints : aPoints - bPoints
        })
    }

    return arr
}

export function getUserGridMetrics(width: number, height: number): UserGridMetrics {
    const safeWidth = Math.max(width, USER_CARD_MIN_WIDTH)
    const safeHeight = Math.max(height, USER_CARD_HEIGHT)
    const rowHeight = USER_CARD_HEIGHT + USER_GRID_GAP

    const columns = Math.max(1, Math.floor((safeWidth + USER_GRID_GAP) / (USER_CARD_MIN_WIDTH + USER_GRID_GAP)))
    const visibleRows = Math.max(1, Math.ceil((safeHeight + USER_GRID_GAP) / rowHeight))
    const visibleCount = columns * visibleRows
    const perPage = Math.max(visibleCount, Math.min(MAX_USERS_PER_PAGE, visibleCount * USER_BATCH_VIEWPORTS))
    const prefetchOffsetPx = Math.max(rowHeight, visibleRows * rowHeight)

    return {
        columns,
        visibleRows,
        visibleCount,
        perPage,
        prefetchOffsetPx,
    }
}
