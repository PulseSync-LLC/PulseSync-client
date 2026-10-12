import { useEffect, useMemo, useState } from 'react'

import path from 'path'
import { useTranslation } from 'react-i18next'

import appConfig from '@common/appConfig'
import rendererHttpClient from '@shared/api/http/client'

import type AddonInterface from '@entities/addon/model/addon.interface'
import type { DocTab } from '@pages/extension/route/extBox/types'

interface HookResult {
    docs: DocTab[]
}

interface CachedAddonFiles {
    docs?: DocTab[]
    bytes: number
}

const MAX_CACHED_ADDONS = 16
const MAX_ADDON_CACHE_BYTES = 4 * 1024 * 1024
const addonFilesCache = new Map<string, CachedAddonFiles>()
const docsRequestCache = new Map<string, Promise<DocTab[]>>()
let addonCacheBytes = 0
let cacheGeneration = 0

const DOC_README_PATTERN = /^readme(?:\.[^.]+)?$/i
const DOC_LICENSE_PATTERN = /^licen[sc]e(?:\.[^.]+)?$/i
const DOC_CHANGELOG_PATTERN = /^change\s*log(?:\.[^.]+)?$/i

const DEFAULT_DOC_FILES = ['readme.md', 'license', 'changelog.md']

const getAddonCacheKey = (addon: AddonInterface): string => addon.id || addon.directoryName || addon.name

const deleteCachedAddonFiles = (cacheKey: string): void => {
    const cached = addonFilesCache.get(cacheKey)
    if (!cached) return
    addonCacheBytes -= cached.bytes
    addonFilesCache.delete(cacheKey)
}

const getCachedAddonFiles = (cacheKey: string): CachedAddonFiles | undefined => {
    const cached = addonFilesCache.get(cacheKey)
    if (cached) {
        addonFilesCache.delete(cacheKey)
        addonFilesCache.set(cacheKey, cached)
    }
    return cached
}

const cacheAddonFiles = (cacheKey: string, files: Omit<CachedAddonFiles, 'bytes'>): void => {
    const cached = { ...addonFilesCache.get(cacheKey), ...files }
    const docsLength = cached.docs?.reduce((length, doc) => length + doc.content.length + doc.title.length + (doc.value?.length ?? 0), 0) ?? 0
    const bytes = (cacheKey.length + docsLength) * 2

    deleteCachedAddonFiles(cacheKey)
    if (bytes > MAX_ADDON_CACHE_BYTES) return

    addonFilesCache.set(cacheKey, { ...cached, bytes })
    addonCacheBytes += bytes

    while (addonFilesCache.size > MAX_CACHED_ADDONS || addonCacheBytes > MAX_ADDON_CACHE_BYTES) {
        const oldestKey = addonFilesCache.keys().next().value
        if (oldestKey === undefined) break
        deleteCachedAddonFiles(oldestKey)
    }
}

const resolveRootFileByPattern = (addon: AddonInterface, pattern: RegExp): string | null => {
    if (!Array.isArray(addon.rootFiles) || addon.rootFiles.length === 0) return null
    return addon.rootFiles.find(file => pattern.test(path.basename(file))) ?? null
}

const resolveDocFiles = (addon: AddonInterface): string[] => {
    if (!Array.isArray(addon.rootFiles) || addon.rootFiles.length === 0) return [...DEFAULT_DOC_FILES]

    const files = [
        resolveRootFileByPattern(addon, DOC_README_PATTERN),
        resolveRootFileByPattern(addon, DOC_LICENSE_PATTERN),
        resolveRootFileByPattern(addon, DOC_CHANGELOG_PATTERN),
    ].filter((file): file is string => Boolean(file))

    return Array.from(new Set(files))
}

const fetchAddonDocs = async (addon: AddonInterface): Promise<DocTab[]> => {
    const candidates = resolveDocFiles(addon)
    if (!candidates.length) return []

    const fetched: DocTab[] = []

    await Promise.all(
        candidates.map(async file => {
            try {
                const res = await rendererHttpClient.get<string>(buildAddonUrl(addon, file), {
                    responseType: 'text',
                })
                if (!res.ok) return
                const text = res.data
                const value = prettify(file)
                fetched.push({ title: value, value, content: text, isMarkdown: file.toLowerCase().endsWith('.md') })
            } catch {}
        }),
    )

    fetched.sort((a, b) => (a.value === 'README' ? -1 : b.value === 'README' ? 1 : (a.value || a.title).localeCompare(b.value || b.title)))
    return fetched
}

const requestAddonDocs = (addon: AddonInterface, cacheKey: string): Promise<DocTab[]> => {
    const existing = docsRequestCache.get(cacheKey)
    if (existing) return existing

    const request = fetchAddonDocs(addon).finally(() => {
        if (docsRequestCache.get(cacheKey) === request) {
            docsRequestCache.delete(cacheKey)
        }
    })

    docsRequestCache.set(cacheKey, request)
    return request
}

export const clearAddonFilesCache = (addon?: AddonInterface | null): void => {
    cacheGeneration += 1

    if (!addon) {
        addonFilesCache.clear()
        addonCacheBytes = 0
        docsRequestCache.clear()
        return
    }

    const cacheKey = getAddonCacheKey(addon)
    deleteCachedAddonFiles(cacheKey)
    docsRequestCache.delete(cacheKey)
}

const buildAddonUrl = (addon: AddonInterface, file: string): string =>
    `http://127.0.0.1:${appConfig.MAIN_PORT}/addon_file?directory=${encodeURIComponent(addon.directoryName)}&file=${encodeURIComponent(file)}&r=${encodeURIComponent(
        `addon-docs-v2-${addon.lastModified || ''}-${addon.size || ''}`,
    )}`

function prettify(file: string): string {
    const base = path.basename(file)
    if (/readme/i.test(base)) return 'README'
    if (/changelog/i.test(base)) return 'Changelog'
    if (/license/i.test(base)) return 'License'
    return base.replace(/\.[^.]+$/, '')
}

function localizeDocTitle(title: string, t: (key: string) => string): string {
    if (title === 'Changelog') {
        return t('extensions.tabs.changelog')
    }

    if (title === 'License') {
        return t('extensions.tabs.license')
    }

    return title
}

export const useAddonFiles = (addon: AddonInterface | null): HookResult => {
    const { t } = useTranslation()
    const [docs, setDocs] = useState<DocTab[]>([])

    useEffect(() => {
        if (!addon) {
            setDocs([])
            return
        }

        const cacheKey = getAddonCacheKey(addon)
        const cached = getCachedAddonFiles(cacheKey)
        setDocs(cached?.docs ?? [])

        let active = true
        const generation = cacheGeneration

        ;(async () => {
            const fetched = await requestAddonDocs(addon, cacheKey)
            if (generation === cacheGeneration) {
                cacheAddonFiles(cacheKey, { docs: fetched })
                if (active) {
                    setDocs(fetched)
                }
            }
        })()
        return () => {
            active = false
        }
    }, [addon])

    const localizedDocs = useMemo(
        () =>
            docs.map(doc => ({
                ...doc,
                title: localizeDocTitle(doc.value || doc.title, t),
            })),
        [docs, t],
    )

    return { docs: localizedDocs }
}
