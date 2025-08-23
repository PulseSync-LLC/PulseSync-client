import { useEffect, useState } from 'react'
import path from 'path'

import appConfig from '../../../../api/config'
import { DocTab } from './types'
import AddonInterface from '../../../../api/interfaces/addon.interface'
import { AddonConfig } from '../../../../components/сonfigurationSettings/types'

interface HookResult {
    docs: DocTab[]
    config: AddonConfig | null
    configExists: boolean | null
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
        if (!addon) return

        const buildUrl = (file: string) =>
            `http://127.0.0.1:${appConfig.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(file)}`

        ;(async () => {
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
            setDocs(fetched)
        })()
        ;(async () => {
            try {
                const res = await fetch(buildUrl('handleEvents.json'))
                if (!res.ok) throw new Error('404')
                const json: AddonConfig = await res.json()
                setConfig(json)
                setConfigExists(true)
            } catch {
                setConfig(null)
                setConfigExists(false)
            }
        })()
    }, [addon])

    return { docs, config, configExists }
}
