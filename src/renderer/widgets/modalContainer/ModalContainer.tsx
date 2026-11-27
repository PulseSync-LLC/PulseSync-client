import React, { lazy } from 'react'

import { useModalContext } from '@app/providers/modal'
import AppUpdateDialog from '@widgets/modalContainer/modals/AppUpdateDialog'
import BasicConfirmationModal from '@widgets/modalContainer/modals/BasicConfirmationModal'
import LinuxAsarPathDialog from '@widgets/modalContainer/modals/LinuxAsarPathDialog'
import LinuxPermissionsModal from '@widgets/modalContainer/modals/LinuxPermissionsModal'
import MacPermissionsModal from '@widgets/modalContainer/modals/MacPermissionsModal'
import PextDNDModal from '@widgets/modalContainer/modals/PextDNDModal'
import PremiumPromoModal from '@widgets/modalContainer/modals/PremiumPromoModal'
import PremiumUnlockedModal from '@widgets/modalContainer/modals/PremiumUnlockedModal'
import UntrustedLocalAddonModal from '@widgets/modalContainer/modals/UntrustedLocalAddonModal'
import YandexMusicChangelogModal from '@widgets/modalContainer/modals/YandexMusicChangelogModal'
import YandexMusicUpdateDialog from '@widgets/modalContainer/modals/YandexMusicUpdateDialog'
import DeferredContent from '@shared/ui/DeferredContent'

const SubscriptionGiveawaysModal = lazy(() => import('@widgets/modalContainer/modals/SubscriptionGiveawaysModal'))

const ModalContainer: React.FC = () => {
    const { Modals, isModalOpen } = useModalContext()
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
            <UntrustedLocalAddonModal />
            <DeferredContent active={isModalOpen(Modals.SUBSCRIPTION_GIVEAWAYS)}>
                <SubscriptionGiveawaysModal />
            </DeferredContent>
            <BasicConfirmationModal />
        </>
    )
}

export default ModalContainer
