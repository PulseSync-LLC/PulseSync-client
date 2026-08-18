import React from 'react'

import AppUpdateDialog from '@widgets/modalContainer/modals/AppUpdateDialog'
import BasicConfirmationModal from '@widgets/modalContainer/modals/BasicConfirmationModal'
import ExtensionPublicationModal from '@widgets/modalContainer/modals/ExtensionPublicationModal'
import LinuxAsarPathDialog from '@widgets/modalContainer/modals/LinuxAsarPathDialog'
import LinuxPermissionsModal from '@widgets/modalContainer/modals/LinuxPermissionsModal'
import MacPermissionsModal from '@widgets/modalContainer/modals/MacPermissionsModal'
import PextDNDModal from '@widgets/modalContainer/modals/PextDNDModal'
import PremiumPromoModal from '@widgets/modalContainer/modals/PremiumPromoModal'
import PremiumUnlockedModal from '@widgets/modalContainer/modals/PremiumUnlockedModal'
import SubscriptionGiveawaysModal from '@widgets/modalContainer/modals/SubscriptionGiveawaysModal'
import UntrustedLocalAddonModal from '@widgets/modalContainer/modals/UntrustedLocalAddonModal'
import YandexMusicChangelogModal from '@widgets/modalContainer/modals/YandexMusicChangelogModal'
import YandexMusicUpdateDialog from '@widgets/modalContainer/modals/YandexMusicUpdateDialog'

const ModalContainer: React.FC = () => {
    return (
        <>
            <LinuxAsarPathDialog />
            <AppUpdateDialog />
            <YandexMusicUpdateDialog />
            <YandexMusicChangelogModal />
            <MacPermissionsModal />
            <LinuxPermissionsModal />
            <PremiumPromoModal />
            <PremiumUnlockedModal />
            <PextDNDModal />
            <ExtensionPublicationModal />
            <UntrustedLocalAddonModal />
            <SubscriptionGiveawaysModal />
            <BasicConfirmationModal />
        </>
    )
}

export default ModalContainer
