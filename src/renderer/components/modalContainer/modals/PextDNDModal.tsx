import React, { useMemo } from 'react'
import { staticAsset } from '../../../utils/staticAssets'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'

import styles from './PextDNDModal.module.scss'

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
