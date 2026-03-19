import React from 'react'
import PulseSyncDialog from '@widgets/modalContainer/modals/PulseSyncDialog'
import YandexMusicUpdateDialog from '@widgets/modalContainer/modals/YandexMusicUpdateDialog'
import MacUpdateDialog from '@widgets/modalContainer/modals/MacUpdateDialog'
import AppUpdateDialog from '@widgets/modalContainer/modals/AppUpdateDialog'
import LinuxAsarPathDialog from '@widgets/modalContainer/modals/LinuxAsarPathDialog'
import PremiumPromoModal from '@widgets/modalContainer/modals/PremiumPromoModal'
import MacPermissionsModal from '@widgets/modalContainer/modals/MacPermissionsModal'
import PremiumUnlockedModal from '@widgets/modalContainer/modals/PremiumUnlockedModal'
import LinuxPermissionsModal from '@widgets/modalContainer/modals/LinuxPermissionsModal'
import PextDNDModal from '@widgets/modalContainer/modals/PextDNDModal'

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
            <PextDNDModal />
        </>
    )
}

export default ModalContainer
