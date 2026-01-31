import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RendererEvents from '../../../../common/types/rendererEvents'
import CustomModalPS from '../../PSUI/CustomModalPS'
import MainEvents from '../../../../common/types/mainEvents'

type MacUpdateInfo = {
    type: 'dmg' | 'zip'
    openPath: string
    appBundlePath?: string | null
}

const MacUpdateDialog: React.FC = () => {
    const { t } = useTranslation()
    const [showDialog, setShowDialog] = useState(false)
    const [updateInfo, setUpdateInfo] = useState<MacUpdateInfo | null>(null)

    useEffect(() => {
        const handleMacUpdateReady = (_: any, data: MacUpdateInfo) => {
            setUpdateInfo(data)
            setShowDialog(true)
        }

        window.desktopEvents?.on(RendererEvents.MAC_UPDATE_READY, handleMacUpdateReady)

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.MAC_UPDATE_READY)
        }
    }, [])

    const handleClose = () => {
        setShowDialog(false)
        setUpdateInfo(null)
    }

    const description = useMemo(() => {
        if (updateInfo?.type === 'zip') return t('updates.macInstallBodyZip')
        return t('updates.macInstallBodyDmg')
    }, [t, updateInfo?.type])

    return (
        <CustomModalPS
            isOpen={showDialog}
            onClose={handleClose}
            title={t('updates.macInstallTitle')}
            text={description}
            buttons={[
                {
                    text: t('updates.macInstallOpenFinder'),
                    onClick: () =>
                        updateInfo?.openPath && window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'openPath', path: updateInfo.openPath }),
                    variant: 'primary',
                    disabled: !updateInfo?.openPath,
                },
                {
                    text: t('updates.macInstallOpenApplications'),
                    onClick: () => window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'openApplications' }),
                    variant: 'secondary',
                },
                {
                    text: t('common.done'),
                    onClick: handleClose,
                    variant: 'secondary',
                },
            ]}
        />
    )
}

export default MacUpdateDialog
