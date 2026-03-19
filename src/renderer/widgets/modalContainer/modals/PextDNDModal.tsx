import React, { useMemo } from 'react'
import { staticAsset } from '@shared/lib/staticAssets'
import { useModalContext } from '@app/providers/modal'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'

import styles from '@widgets/modalContainer/modals/PextDNDModal.module.scss'

const PextDNDModal: React.FC = () => {
    const { Modals, closeModal, isModalOpen, getModalState } = useModalContext()
    const { isValidFileType } = getModalState(Modals.PEXT_DND_MODAL)

    const handleClose = () => {
        closeModal(Modals.PEXT_DND_MODAL)
    }

    const logo_src = useMemo(() => staticAsset('assets/images/pextLogo.png'), [])

    return (
        <CustomModalPS className={styles.PextDNDModal} isOpen={isModalOpen(Modals.PEXT_DND_MODAL)} onClose={handleClose}>
            <img className={styles.PextDNDModal_image} src={logo_src} alt="Pext Logo" />
            <h2 className={styles.PextDNDModal_text}>{isValidFileType ? 'Импорт Аддона' : 'Неверный тип файла'}</h2>
        </CustomModalPS>
    )
}

export default PextDNDModal
