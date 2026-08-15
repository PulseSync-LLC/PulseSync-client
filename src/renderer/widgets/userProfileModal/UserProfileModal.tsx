import { MdClose } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import ProfileView from '@widgets/userProfileModal/ProfileView'
import * as styles from '@widgets/userProfileModal/profileOverlay.module.scss'

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
                {profileName ? <ProfileView profileName={profileName} /> : null}
            </div>
        </CustomModalPS>
    )
}
