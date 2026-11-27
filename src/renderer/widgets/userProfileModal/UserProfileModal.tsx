import { lazy } from 'react'

import { useTranslation } from 'react-i18next'
import { MdClose } from 'react-icons/md'

import { useModalContext } from '@app/providers/modal'
import DeferredContent from '@shared/ui/DeferredContent'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'

import * as styles from '@widgets/userProfileModal/profileOverlay.module.scss'

const ProfileView = lazy(() => import('@widgets/userProfileModal/ProfileView'))

export default function UserProfileModal() {
    const { t } = useTranslation()
    const { Modals, closeModal, getModalState, isModalOpen } = useModalContext()
    const { profileName } = getModalState(Modals.USER_PROFILE)
    const handleClose = () => closeModal(Modals.USER_PROFILE)

    return (
        <CustomModalPS
            inline
            isOpen={isModalOpen(Modals.USER_PROFILE)}
            onClose={handleClose}
            className={styles.modal}
            backdropClassName={styles.backdrop}
        >
            <div className={styles.content}>
                <button type="button" className={styles.closeButton} onClick={handleClose} aria-label={t('common.done')}>
                    <MdClose aria-hidden="true" />
                </button>
                <DeferredContent active={isModalOpen(Modals.USER_PROFILE)}>
                    {profileName ? <ProfileView profileName={profileName} /> : null}
                </DeferredContent>
            </div>
        </CustomModalPS>
    )
}
