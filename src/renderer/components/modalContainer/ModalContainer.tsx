import React from 'react'
import PulseSyncDialog from './modals/PulseSyncDialog'
import YandexMusicUpdateDialog from './modals/YandexMusicUpdateDialog'
import MacUpdateDialog from './modals/MacUpdateDialog'
import AppUpdateDialog from './modals/AppUpdateDialog'
import LinuxAsarPathDialog from './modals/LinuxAsarPathDialog'
import PremiumPromoModal from './modals/PremiumPromoModal'
import MacPermissionsModal from './modals/MacPermissionsModal'
import PremiumUnlockedModal from './modals/PremiumUnlockedModal'
import LinuxPermissionsModal from './modals/LinuxPermissionsModal'

const ModalContainer: React.FC = () => {
    return (
        <>
            <MacUpdateDialog />
            <LinuxAsarPathDialog />
            <AppUpdateDialog />
            <PulseSyncDialog />
            <YandexMusicUpdateDialog />
            <MacPermissionsModal />
            <LinuxPermissionsModal />
            <PremiumPromoModal />
            <PremiumUnlockedModal />
        </>
    )
}

export default ModalContainer
