import { useEffect, useState } from 'react'
import path from 'path'

import appConfig from '@common/appConfig'
import { DocTab } from './types'
import AddonInterface from '../../../../api/interfaces/addon.interface'
import { AddonConfig } from '../../../../components/сonfigurationSettings/types'

interface HookResult {
    docs: DocTab[]
    config: AddonConfig | null
    configExists: boolean | null
}

const docsCache = new Map<string, DocTab[]>()
const configCache = new Map<string, AddonConfig | null>()
const configExistsCache = new Map<string, boolean>()
const docsRequestCache = new Map<string, Promise<DocTab[]>>()
const configRequestCache = new Map<string, Promise<{ config: AddonConfig | null; exists: boolean }>>()

const DOC_README_PATTERN = /^readme(?:\.[^.]+)?$/i
const DOC_LICENSE_PATTERN = /^licen[sc]e(?:\.[^.]+)?$/i
const DOC_CHANGELOG_PATTERN = /^change\s*log(?:\.[^.]+)?$/i
const HANDLE_EVENTS_PATTERN = /^handleevents\.json$/i

const DEFAULT_DOC_FILES = ['readme.md', 'license', 'changelog.md']
const DEFAULT_CONFIG_FILE = 'handleEvents.json'

const getAddonCacheKey = (addon: AddonInterface): string => addon.directoryName || addon.name

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

const resolveConfigFile = (addon: AddonInterface): string | null => {
    if (!Array.isArray(addon.rootFiles) || addon.rootFiles.length === 0) return DEFAULT_CONFIG_FILE
    return resolveRootFileByPattern(addon, HANDLE_EVENTS_PATTERN)
}

const fetchAddonDocs = async (addon: AddonInterface): Promise<DocTab[]> => {
    const candidates = resolveDocFiles(addon)
    if (!candidates.length) return []

    const fetched: DocTab[] = []

    await Promise.all(
        candidates.map(async file => {
            try {
                const res = await fetch(buildAddonUrl(addon, file), { cache: 'no-store' })
                if (!res.ok) return
                const text = await res.text()
                fetched.push({ title: prettify(file), content: text, isMarkdown: file.toLowerCase().endsWith('.md') })
            } catch {}
        }),
    )

    fetched.sort((a, b) => (a.title === 'README' ? -1 : b.title === 'README' ? 1 : a.title.localeCompare(b.title)))
    return fetched
}

const fetchAddonConfig = async (addon: AddonInterface): Promise<{ config: AddonConfig | null; exists: boolean }> => {
    const file = resolveConfigFile(addon)
    if (!file) return { config: null, exists: false }

    try {
        const res = await fetch(buildAddonUrl(addon, file), { cache: 'no-store' })
        if (!res.ok) throw new Error('404')
        const json: AddonConfig = await res.json()
        return { config: json, exists: true }
    } catch {
        return { config: null, exists: false }
    }
}

const requestAddonDocs = (addon: AddonInterface, cacheKey: string): Promise<DocTab[]> => {
    const existing = docsRequestCache.get(cacheKey)
    if (existing) return existing

    const request = fetchAddonDocs(addon).finally(() => {
        docsRequestCache.delete(cacheKey)
    })

    docsRequestCache.set(cacheKey, request)
    return request
}

const requestAddonConfig = (addon: AddonInterface, cacheKey: string): Promise<{ config: AddonConfig | null; exists: boolean }> => {
    const existing = configRequestCache.get(cacheKey)
    if (existing) return existing

    const request = fetchAddonConfig(addon).finally(() => {
        configRequestCache.delete(cacheKey)
    })

    configRequestCache.set(cacheKey, request)
    return request
}

export const clearAddonFilesCache = (addon?: AddonInterface | null): void => {
    if (!addon) {
        docsCache.clear()
        configCache.clear()
        configExistsCache.clear()
        docsRequestCache.clear()
        configRequestCache.clear()
        return
    }

    const cacheKey = getAddonCacheKey(addon)
    docsCache.delete(cacheKey)
    configCache.delete(cacheKey)
    configExistsCache.delete(cacheKey)
    docsRequestCache.delete(cacheKey)
    configRequestCache.delete(cacheKey)
}

const buildAddonUrl = (addon: AddonInterface, file: string): string =>
    `http://127.0.0.1:${appConfig.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(file)}&r=${encodeURIComponent(
        `addon-docs-v2-${addon.lastModified || ''}-${addon.size || ''}`,
    )}`

export const preloadAddonFiles = async (addon: AddonInterface | null): Promise<void> => {
    if (!addon) return

    const cacheKey = getAddonCacheKey(addon)
    const shouldFetchDocs = !docsCache.has(cacheKey)
    const shouldFetchConfig = !configExistsCache.has(cacheKey)

    if (!shouldFetchDocs && !shouldFetchConfig) return

    if (shouldFetchDocs) {
        const fetched = await requestAddonDocs(addon, cacheKey)
        docsCache.set(cacheKey, fetched)
    }

    if (shouldFetchConfig) {
        const { config, exists } = await requestAddonConfig(addon, cacheKey)
        configCache.set(cacheKey, config)
        configExistsCache.set(cacheKey, exists)
    }
}

function prettify(file: string): string {
    const base = path.basename(file)
    if (/readme/i.test(base)) return 'README'
    if (/changelog/i.test(base)) return 'Changelog'
    if (/license/i.test(base)) return 'License'
    return base.replace(/\.[^.]+$/, '')
}

export const useAddonFiles = (addon: AddonInterface | null): HookResult => {
    const [docs, setDocs] = useState<DocTab[]>([])
    const [config, setConfig] = useState<AddonConfig | null>(null)
    const [configExists, setConfigExists] = useState<boolean | null>(null)

    useEffect(() => {
        if (!addon) {
            setDocs([])
            setConfig(null)
            setConfigExists(null)
            return
        }

        const cacheKey = getAddonCacheKey(addon)
        const hasCachedDocs = docsCache.has(cacheKey)
        const cachedDocs = docsCache.get(cacheKey)
        const cachedConfigExists = configExistsCache.get(cacheKey)
        const cachedConfig = configCache.get(cacheKey)

        if (hasCachedDocs) {
            setDocs(cachedDocs ?? [])
        } else {
            setDocs([])
        }

        if (cachedConfigExists !== undefined) {
            setConfigExists(cachedConfigExists)
            setConfig(cachedConfig ?? null)
        } else {
            setConfigExists(null)
            setConfig(null)
        }

        let active = true

        if (!hasCachedDocs) {
            ;(async () => {
                const fetched = await requestAddonDocs(addon, cacheKey)
                docsCache.set(cacheKey, fetched)
                if (active) {
                    setDocs(fetched)
                }
            })()
        }

        if (cachedConfigExists === undefined) {
            ;(async () => {
                const { config, exists } = await requestAddonConfig(addon, cacheKey)
                configCache.set(cacheKey, config)
                configExistsCache.set(cacheKey, exists)
                if (active) {
                    setConfig(config)
                    setConfigExists(exists)
                }
            })()
        }

        return () => {
            active = false
        }
    }, [addon])

    return { docs, config, configExists }
}

