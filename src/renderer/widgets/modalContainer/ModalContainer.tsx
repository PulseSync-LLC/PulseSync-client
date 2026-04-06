import React from 'react'
import YandexMusicUpdateDialog from '@widgets/modalContainer/modals/YandexMusicUpdateDialog'
import MacUpdateDialog from '@widgets/modalContainer/modals/MacUpdateDialog'
import AppUpdateDialog from '@widgets/modalContainer/modals/AppUpdateDialog'
import LinuxAsarPathDialog from '@widgets/modalContainer/modals/LinuxAsarPathDialog'
import PremiumPromoModal from '@widgets/modalContainer/modals/PremiumPromoModal'
import MacPermissionsModal from '@widgets/modalContainer/modals/MacPermissionsModal'
import PremiumUnlockedModal from '@widgets/modalContainer/modals/PremiumUnlockedModal'
import LinuxPermissionsModal from '@widgets/modalContainer/modals/LinuxPermissionsModal'
import PextDNDModal from '@widgets/modalContainer/modals/PextDNDModal'
import ExtensionPublicationModal from '@widgets/modalContainer/modals/ExtensionPublicationModal'
import UntrustedLocalAddonModal from '@widgets/modalContainer/modals/UntrustedLocalAddonModal'

const ModalContainer: React.FC = () => {
    return (
        <>
            <MacUpdateDialog />
            <LinuxAsarPathDialog />
            <AppUpdateDialog />
            <YandexMusicUpdateDialog />
            <MacPermissionsModal />
            <LinuxPermissionsModal />
            <PremiumPromoModal />
            <PremiumUnlockedModal />
            <PextDNDModal />
            <ExtensionPublicationModal />
            <UntrustedLocalAddonModal />
        </>
    )
}

export default ModalContainer
