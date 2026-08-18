import { useCallback } from 'react'

import { useTranslation } from 'react-i18next'

import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import { useModalContext } from '@app/providers/modal'
import { openLegacyAddonMigrationNews } from '@entities/addon/lib/legacyAddonRestrictions'

export function useLegacyAddonMigrationModal() {
    const { t } = useTranslation()
    const { getExperiment } = useExperiments()
    const { Modals, openModal } = useModalContext()
    const experimentMeta = getExperiment(CLIENT_EXPERIMENTS.ClientLegacyAddonRestrictions)?.meta

    return useCallback(() => {
        openModal(Modals.BASIC_CONFIRMATION, {
            title: t('extensions.legacyAddon.migrationModalTitle'),
            description: t('extensions.legacyAddon.migrationModalDescription'),
            confirmLabel: t('extensions.legacyAddon.openNews'),
            confirmVariant: 'primary',
            onConfirm: () => void openLegacyAddonMigrationNews(experimentMeta),
        })
    }, [Modals.BASIC_CONFIRMATION, experimentMeta, openModal, t])
}
