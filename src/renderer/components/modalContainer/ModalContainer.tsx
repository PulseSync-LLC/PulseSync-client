import React from 'react'
import PulseSyncDialog from './modals/PulseSyncDialog'
import YandexMusicUpdateDialog from './modals/YandexMusicUpdateDialog'
import MacUpdateDialog from './modals/MacUpdateDialog'

const ModalContainer: React.FC = () => {
    return (
        <>
            <MacUpdateDialog />
            <PulseSyncDialog />
            <YandexMusicUpdateDialog />
        </>
    )
}

export default ModalContainer
