import { useCallback, useEffect, useState } from 'react'

import path from 'path'

import {
    applyAddonSettingsValuesToConfig,
    collectAddonSettingsValuesFromConfig,
    HANDLE_EVENTS_FILENAME,
    HANDLE_EVENTS_SETTINGS_FILENAME,
    normalizeAddonSettingsValues,
} from '@common/addons/handleEvents'
import { normalizeAddonConfig } from '@features/configurationSettings/types'
import { desktopApi } from '@shared/desktop/desktopApi'

import type Addon from '@entities/addon/model/addon.interface'
import type { AddonConfig} from '@features/configurationSettings/types';

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

export function useConfig(addon: Addon): UseConfigResult {
    const [configExists, setExists] = useState<boolean | null>(null)
    const [config, setConfig] = useState<AddonConfig | null>(null)
    const [editConfig, setEditConfig] = useState<AddonConfig | null>(null)

    const schemaFilePath = path.join(addon.path, HANDLE_EVENTS_FILENAME)
    const settingsFilePath = path.join(addon.path, HANDLE_EVENTS_SETTINGS_FILENAME)
    const metadataSchema = addon.type === 'web-addon' && Array.isArray(addon.settings?.sections) ? addon.settings : null

    const reload = useCallback(async () => {
        try {
            let normalizedSchema: AddonConfig | null = null
            if (metadataSchema) {
                normalizedSchema = normalizeAddonConfig(metadataSchema as AddonConfig)
            } else {
                const rawSchema = await desktopApi.addons.files.readText(schemaFilePath, 'utf8')
                const parsedSchema = safeParse<AddonConfig>(rawSchema)
                normalizedSchema = parsedSchema ? normalizeAddonConfig(parsedSchema) : null
            }

            if (!normalizedSchema) {
                setExists(false)
                setConfig(null)
                setEditConfig(null)
                return
            }

            let storedValues = {}
            try {
                const rawValues = await desktopApi.addons.files.readText(settingsFilePath, 'utf8')
                storedValues = normalizeAddonSettingsValues(safeParse(rawValues) ?? {})
            } catch {}

            setExists(true)
            setEditConfig(metadataSchema ? null : normalizedSchema)
            setConfig(applyAddonSettingsValuesToConfig(normalizedSchema, storedValues))
        } catch {
            setExists(false)
            setConfig(null)
            setEditConfig(null)
        }
    }, [metadataSchema, schemaFilePath, settingsFilePath])

    const save = useCallback(
        async (cfg: AddonConfig) => {
            const normalized = normalizeAddonConfig(cfg)
            const values = collectAddonSettingsValuesFromConfig(normalized)
            await desktopApi.addons.files.writeText(settingsFilePath, JSON.stringify(values, null, 4))
            setConfig(normalized)
            setExists(true)
        },
        [settingsFilePath],
    )

    const saveSchema = useCallback(
        async (cfg: AddonConfig) => {
            if (metadataSchema) return
            const normalized = normalizeAddonConfig(cfg)
            await desktopApi.addons.files.writeText(schemaFilePath, JSON.stringify(normalized, null, 4))
            setEditConfig(normalized)
            setExists(true)
            await reload()
        },
        [metadataSchema, reload, schemaFilePath],
    )

    useEffect(() => {
        reload()
    }, [reload])

    return { configExists, config, editConfig, configApi: { reload, save, saveSchema } }
}
