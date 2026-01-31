import { useEffect, useState } from 'react'
import path from 'path'

import appConfig from '../../../../api/web_config'
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

const getAddonCacheKey = (addon: AddonInterface): string => addon.directoryName || addon.name

const buildAddonUrl = (addon: AddonInterface, file: string): string =>
    `http://127.0.0.1:${appConfig.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(file)}`

export const preloadAddonFiles = async (addon: AddonInterface | null): Promise<void> => {
    if (!addon) return

    const cacheKey = getAddonCacheKey(addon)
    const shouldFetchDocs = !docsCache.has(cacheKey)
    const shouldFetchConfig = !configExistsCache.has(cacheKey)

    if (!shouldFetchDocs && !shouldFetchConfig) return

    if (shouldFetchDocs) {
        const candidates = ['readme.md', 'license', 'changelog.md']
        const fetched: DocTab[] = []

        await Promise.all(
            candidates.map(async f => {
                try {
                    const res = await fetch(buildAddonUrl(addon, f))
                    if (!res.ok) return
                    const text = await res.text()
                    fetched.push({ title: prettify(f), content: text, isMarkdown: f.toLowerCase().endsWith('.md') })
                } catch {}
            }),
        )

        fetched.sort((a, b) => (a.title === 'README' ? -1 : b.title === 'README' ? 1 : a.title.localeCompare(b.title)))
        docsCache.set(cacheKey, fetched)
    }

    if (shouldFetchConfig) {
        try {
            const res = await fetch(buildAddonUrl(addon, 'handleEvents.json'))
            if (!res.ok) throw new Error('404')
            const json: AddonConfig = await res.json()
            configCache.set(cacheKey, json)
            configExistsCache.set(cacheKey, true)
        } catch {
            configCache.set(cacheKey, null)
            configExistsCache.set(cacheKey, false)
        }
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
        const cachedDocs = docsCache.get(cacheKey)
        const cachedConfigExists = configExistsCache.get(cacheKey)
        const cachedConfig = configCache.get(cacheKey)

        if (cachedDocs) {
            setDocs(cachedDocs)
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

        const buildUrl = (file: string) => buildAddonUrl(addon, file)

        let active = true

        ;(async () => {
            if (docsCache.has(cacheKey)) return
            const candidates = ['readme.md', 'license', 'changelog.md']
            const fetched: DocTab[] = []

            await Promise.all(
                candidates.map(async f => {
                    try {
                        const res = await fetch(buildUrl(f))
                        if (!res.ok) return
                        const text = await res.text()
                        fetched.push({ title: prettify(f), content: text, isMarkdown: f.toLowerCase().endsWith('.md') })
                    } catch {}
                }),
            )

            fetched.sort((a, b) => (a.title === 'README' ? -1 : b.title === 'README' ? 1 : a.title.localeCompare(b.title)))
            docsCache.set(cacheKey, fetched)
            if (active) {
                setDocs(fetched)
            }
        })()
        ;(async () => {
            if (configExistsCache.has(cacheKey)) return
            try {
                const res = await fetch(buildUrl('handleEvents.json'))
                if (!res.ok) throw new Error('404')
                const json: AddonConfig = await res.json()
                configCache.set(cacheKey, json)
                configExistsCache.set(cacheKey, true)
                if (active) {
                    setConfig(json)
                    setConfigExists(true)
                }
            } catch {
                configCache.set(cacheKey, null)
                configExistsCache.set(cacheKey, false)
                if (active) {
                    setConfig(null)
                    setConfigExists(false)
                }
            }
        })()

        return () => {
            active = false
        }
    }, [addon])

    return { docs, config, configExists }
}
