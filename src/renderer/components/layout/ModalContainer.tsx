import React from 'react'
import PulseSyncDialog from './PulseSyncDialog'
import YandexMusicUpdateDialog from './YandexMusicUpdateDialog'

const ModalContainer: React.FC = () => {
    return (
        <>
            <PulseSyncDialog />
            <YandexMusicUpdateDialog />
        </>
    )
}

export default ModalContainer

