import { useCallback, useEffect, useState } from 'react'
import path from 'path'
import {
    HANDLE_EVENTS_FILENAME,
    HANDLE_EVENTS_SETTINGS_FILENAME,
    applyAddonSettingsValuesToConfig,
    collectAddonSettingsValuesFromConfig,
    normalizeAddonSettingsValues,
} from '@common/addons/handleEvents'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

import { AddonConfig, normalizeAddonConfig } from '@features/configurationSettings/types'

type UseConfigResult = {
    configExists: boolean | null
    config: AddonConfig | null
    editConfig: AddonConfig | null
    configApi: {
        reload: () => Promise<void>
        save: (cfg: AddonConfig) => Promise<void>
        saveSchema: (cfg: AddonConfig) => Promise<void>
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
    const [editConfig, setEditConfig] = useState<AddonConfig | null>(null)

    const schemaFilePath = path.join(addonPath, HANDLE_EVENTS_FILENAME)
    const settingsFilePath = path.join(addonPath, HANDLE_EVENTS_SETTINGS_FILENAME)

    const reload = useCallback(async () => {
        try {
            const rawSchema = await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.READ_FILE, schemaFilePath, 'utf-8')
            const parsedSchema = safeParse<AddonConfig>(rawSchema)
            const normalizedSchema = parsedSchema ? normalizeAddonConfig(parsedSchema) : null

            if (!normalizedSchema) {
                setExists(false)
                setConfig(null)
                setEditConfig(null)
                return
            }

            let storedValues = {}
            try {
                const rawValues = await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.READ_FILE, settingsFilePath, 'utf-8')
                storedValues = normalizeAddonSettingsValues(safeParse(rawValues) ?? {})
            } catch {}

            setExists(true)
            setEditConfig(normalizedSchema)
            setConfig(applyAddonSettingsValuesToConfig(normalizedSchema, storedValues))
        } catch {
            setExists(false)
            setConfig(null)
            setEditConfig(null)
        }
    }, [schemaFilePath, settingsFilePath])

    const save = useCallback(
        async (cfg: AddonConfig) => {
            const normalized = normalizeAddonConfig(cfg)
            const values = collectAddonSettingsValuesFromConfig(normalized)
            await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.WRITE_FILE, settingsFilePath, JSON.stringify(values, null, 4))
            setConfig(normalized)
            setExists(true)
        },
        [settingsFilePath],
    )

    const saveSchema = useCallback(
        async (cfg: AddonConfig) => {
            const normalized = normalizeAddonConfig(cfg)
            await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.WRITE_FILE, schemaFilePath, JSON.stringify(normalized, null, 4))
            setEditConfig(normalized)
            setExists(true)
            await reload()
        },
        [reload, schemaFilePath],
    )

    useEffect(() => {
        reload()
    }, [reload])

    return { configExists, config, editConfig, configApi: { reload, save, saveSchema } }
}
