import { useCallback, useEffect, useState } from 'react'
import path from 'path'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

import { AddonConfig, normalizeAddonConfig } from '@features/configurationSettings/types'

type UseConfigResult = {
    configExists: boolean | null
    config: AddonConfig | null
    configApi: {
        reload: () => Promise<void>
        save: (cfg: AddonConfig) => Promise<void>
    }
}

const safeParse = <T>(txt: string | null | undefined): T | null => {
    try {
        return txt ? (JSON.parse(txt) as T) : null
    } catch {
        return null
    }
}

export function useConfig(addonPath: string): UseConfigResult {
    const [configExists, setExists] = useState<boolean | null>(null)
    const [config, setConfig] = useState<AddonConfig | null>(null)

    const filePath = path.join(addonPath, 'handleEvents.json')

    const reload = useCallback(async () => {
        try {
            const raw = await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.READ_FILE, filePath, 'utf-8')
            const parsed = safeParse<AddonConfig>(raw)
            const normalized = parsed ? normalizeAddonConfig(parsed) : null
            setExists(!!normalized)
            setConfig(normalized)
        } catch {
            setExists(false)
            setConfig(null)
        }
    }, [filePath])

    const save = useCallback(
        async (cfg: AddonConfig) => {
            const normalized = normalizeAddonConfig(cfg)
            await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.WRITE_FILE, filePath, JSON.stringify(normalized, null, 4))
            setConfig(normalized)
            setExists(true)
        },
        [filePath],
    )

    useEffect(() => {
        reload()
    }, [reload])

    return { configExists, config, configApi: { reload, save } }
}
