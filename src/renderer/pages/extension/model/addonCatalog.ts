import { useEffect, useState } from 'react'
import semver from 'semver'
import stringSimilarity from 'string-similarity'

import config from '@common/appConfig'
import Addon from '@entities/addon/model/addon.interface'
import { AddonWhitelistItem } from '@entities/addon/model/addonWhitelist.interface'

export const defaultOrder = {
    alphabet: 'asc',
    author: 'asc',
    date: 'asc',
    size: 'desc',
    type: 'asc',
} as const

export type SortKey = keyof typeof defaultOrder
export type AddonTypeFilter = 'all' | 'theme' | 'script'

export function safeStoreGet<T>(path: string, fallback: T): T {
    try {
        const value = window?.electron?.store?.get?.(path)
        return (value ?? fallback) as T
    } catch {
        return fallback
    }
}

export function useDebouncedValue<T>(value: T, delay: number) {
    const [debounced, setDebounced] = useState(value)

    useEffect(() => {
        const timeoutId = setTimeout(() => setDebounced(value), delay)
        return () => clearTimeout(timeoutId)
    }, [value, delay])

    return debounced
}

export function getUniqueAddonTags(addons: Addon[]): string[] {
    const tags = new Set<string>()

    addons.filter(addon => addon.name !== 'Default').forEach(addon => (addon.tags || []).forEach(tag => tags.add(tag)))

    return Array.from(tags)
}

export function getUniqueAddonCreators(addons: Addon[]): string[] {
    const creators = new Set<string>()

    addons
        .filter(addon => addon.name !== 'Default')
        .forEach(addon => {
            if (typeof addon.author === 'string' && addon.author.trim() !== '') {
                creators.add(addon.author)
            }
        })

    return Array.from(creators)
}

type FilterAndSortAddonsParams = {
    addons: Addon[]
    type: AddonTypeFilter
    selectedTags: Set<string>
    selectedCreators: Set<string>
    searchQuery: string
    sort: SortKey
    sortOrder: 'asc' | 'desc'
}

export function filterAndSortAddons({
    addons,
    type,
    selectedTags,
    selectedCreators,
    searchQuery,
    sort,
    sortOrder,
}: FilterAndSortAddonsParams): Addon[] {
    let result = addons.filter(addon => addon.name !== 'Default')

    if (type !== 'all') {
        result = result.filter(addon => addon.type === type)
    }

    if (selectedTags.size > 0) {
        result = result.filter(addon => addon.tags?.some(tag => selectedTags.has(tag)))
    }

    if (selectedCreators.size > 0) {
        result = result.filter(addon => typeof addon.author === 'string' && selectedCreators.has(addon.author))
    }

    if (searchQuery.trim()) {
        result = result.filter(item => {
            const authorString =
                typeof item.author === 'string'
                    ? item.author.toLowerCase()
                    : Array.isArray(item.author)
                      ? item.author.map(id => String(id).toLowerCase()).join(', ')
                      : ''
            let matches = item.name.toLowerCase().includes(searchQuery) || authorString.includes(searchQuery)

            if (!matches && searchQuery.length > 2) {
                matches =
                    stringSimilarity.compareTwoStrings(item.name.toLowerCase(), searchQuery) > 0.35 ||
                    stringSimilarity.compareTwoStrings(authorString, searchQuery) > 0.35
            }

            return matches
        })
    }

    switch (sort) {
        case 'type':
            return result.slice().sort((a, b) => {
                const compareResult = (a.type || '').localeCompare(b.type || '')
                return sortOrder === 'asc' ? compareResult : -compareResult
            })
        case 'alphabet':
            return result.slice().sort((a, b) => {
                const compareResult = a.name.localeCompare(b.name)
                return sortOrder === 'asc' ? compareResult : -compareResult
            })
        case 'date':
            return result.slice().sort((a, b) => {
                const dateA = parseFloat(a.lastModified || '0') || 0
                const dateB = parseFloat(b.lastModified || '0') || 0
                return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
            })
        case 'size':
            return result.slice().sort((a, b) => {
                const sizeA = parseFloat(a.size || '0') || 0
                const sizeB = parseFloat(b.size || '0') || 0
                return sortOrder === 'asc' ? sizeA - sizeB : sizeB - sizeA
            })
        case 'author':
            return result.slice().sort((a, b) => {
                const authorA = typeof a.author === 'string' ? a.author : ''
                const authorB = typeof b.author === 'string' ? b.author : ''
                const compareResult = authorA.localeCompare(authorB)
                return sortOrder === 'asc' ? compareResult : -compareResult
            })
        default:
            return result
    }
}

export function buildAddonImagePath(addon: Addon, fallbackAddonImage: string) {
    if (!addon.image) return fallbackAddonImage
    if (/^(https?:\/\/|data:)/i.test(addon.image.trim())) return addon.image

    return `http://127.0.0.1:${config.MAIN_PORT}/addon_file` + `?name=${encodeURIComponent(addon.name)}` + `&file=${encodeURIComponent(addon.image)}`
}

export function createWhitelistedAddonNames(addonWhitelist: AddonWhitelistItem[]) {
    return new Set(addonWhitelist.map(addon => addon.name.toLowerCase()))
}

export function isAddonWhitelisted(addon: Addon, whitelistedAddonNames: Set<string>) {
    const name = addon.name.toLowerCase()
    const directoryName = addon.directoryName.toLowerCase()
    return whitelistedAddonNames.has(name) || whitelistedAddonNames.has(directoryName)
}

export function checkAddonVersionSupported(addon: Addon, version: string | undefined | null, whitelistedAddonNames: Set<string>) {
    if (isAddonWhitelisted(addon, whitelistedAddonNames)) {
        return true
    }

    if (!version || !semver.valid(version)) {
        return false
    }

    return addon.supportedVersions?.some(range => semver.satisfies(version, range)) ?? false
}
