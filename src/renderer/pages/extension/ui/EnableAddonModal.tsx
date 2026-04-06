import { useTranslation } from 'react-i18next'

import Addon from '@entities/addon/model/addon.interface'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'

type Props = {
    addon: Addon | null
    isOpen: boolean
    musicVersion: string | null | undefined
    onClose: () => void
    onConfirm: (addon: Addon) => void
    getAddonModalText: (addon: Addon, musicVersion: string | null | undefined) => string
}

export default function EnableAddonModal({ addon, isOpen, musicVersion, onClose, onConfirm, getAddonModalText }: Props) {
    const { t } = useTranslation()

    return (
        <CustomModalPS
            isOpen={isOpen}
            onClose={onClose}
            title={t('extensions.confirmTitle')}
            text={addon ? getAddonModalText(addon, musicVersion) : ''}
            subText={t('extensions.versionLabel', { version: musicVersion || t('common.notAvailable') })}
            buttons={[
                {
                    text: t('extensions.enableAnyway'),
                    onClick: () => {
                        if (addon) {
                            onConfirm(addon)
                        }
                        onClose()
                    },
                    variant: 'danger',
                },
                {
                    text: t('common.cancel'),
                    onClick: onClose,
                    variant: 'secondary',
                },
            ]}
        />
    )
}
