import { useEffect, useMemo } from 'react'

import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import {
    getLegacyAddonMigrationNewsSlug,
    isAddonAuthor,
    isRestrictedLegacyAddon,
    openLegacyAddonMigrationNews,
} from '@entities/addon/lib/legacyAddonRestrictions'

import type { LegacyAddonRestrictionsState } from '@app/AppShell.types'
import type Addon from '@entities/addon/model/addon.interface'
import type UserInterface from '@entities/user/model/user.interface'

type Props = {
    addons: Addon[]
    onChange: (state: LegacyAddonRestrictionsState) => void
    user: Pick<UserInterface, 'nickname' | 'username'>
}

export default function LegacyAddonRestrictionsController({ addons, onChange, user }: Props) {
    const { getExperiment, isExperimentEnabled, loading } = useExperiments()
    const experiment = getExperiment(CLIENT_EXPERIMENTS.ClientLegacyAddonRestrictions)
    const enabled = !loading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientLegacyAddonRestrictions, false)
    const hasAuthoredLegacyAddons = useMemo(
        () => addons.some(addon => isRestrictedLegacyAddon(addon, enabled) && isAddonAuthor(addon, user)),
        [addons, enabled, user],
    )

    useEffect(() => {
        onChange({ enabled, loading })
    }, [enabled, loading, onChange])

    useEffect(() => {
        if (loading || !enabled || !hasAuthoredLegacyAddons) {
            return
        }

        const newsSlug = getLegacyAddonMigrationNewsSlug(experiment?.meta)
        const noticeVersion = typeof experiment?.meta.noticeVersion === 'string' ? experiment.meta.noticeVersion.trim() : ''
        const storageKey = `pulsesync.legacyAddonRestrictions.news:${noticeVersion || newsSlug}`

        if (window.localStorage.getItem(storageKey) === '1') {
            return
        }

        window.localStorage.setItem(storageKey, '1')
        void openLegacyAddonMigrationNews(experiment?.meta)
    }, [enabled, experiment?.meta, hasAuthoredLegacyAddons, loading])

    return null
}
