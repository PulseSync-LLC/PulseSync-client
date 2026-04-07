import type Addon from '@entities/addon/model/addon.interface'

export interface StoreAddonMetric {
    addonId: string
    enabled: boolean
}

export function buildStoreAddonMetrics(addons: Addon[], currentTheme: string, enabledScripts: string[]): StoreAddonMetric[] {
    const enabledScriptsSet = new Set(
        enabledScripts
            .map(script => String(script || '').trim())
            .filter(Boolean),
    )
    const metricsMap = new Map<string, StoreAddonMetric>()

    for (const addon of addons) {
        const addonId = String(addon.storeAddonId || '').trim()
        if (addon.installSource !== 'store' || !addonId) {
            continue
        }

        const enabled = addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScriptsSet.has(addon.directoryName)
        const currentMetric = metricsMap.get(addonId)
        if (!currentMetric || (!currentMetric.enabled && enabled)) {
            metricsMap.set(addonId, { addonId, enabled })
        }
    }

    return [...metricsMap.values()].sort((left, right) => left.addonId.localeCompare(right.addonId))
}
