import React from 'react'
import PulseSyncDialog from './modals/PulseSyncDialog'
import YandexMusicUpdateDialog from './modals/YandexMusicUpdateDialog'
import MacUpdateDialog from './modals/MacUpdateDialog'
import AppUpdateDialog from './modals/AppUpdateDialog'
import LinuxAsarPathDialog from './modals/LinuxAsarPathDialog'
import PremiumPromoModal from './modals/PremiumPromoModal'

const ModalContainer: React.FC = () => {
    return (
        <>
            <MacUpdateDialog />
            <LinuxAsarPathDialog />
            <AppUpdateDialog />
            <PulseSyncDialog />
            <YandexMusicUpdateDialog />
            <PremiumPromoModal />
        </>
    )
}

export default ModalContainer
