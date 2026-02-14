import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Modals } from './modals'
import type { ModalName, ModalProviderProps, ModalsContextValue, ModalsState } from './types'

const initialModalsState: ModalsState = {
    [Modals.MOD_CHANGELOG]: false,
    [Modals.MAC_UPDATE_DIALOG]: false,
    [Modals.LINUX_ASAR_PATH]: false,
    [Modals.APP_UPDATE_DIALOG]: false,
    [Modals.PULSE_SYNC_DIALOG]: false,
    [Modals.YANDEX_MUSIC_UPDATE_DIALOG]: false,
    [Modals.PREMIUM_PROMO]: false,
    [Modals.MAC_PERMISSIONS_MODAL]: false,
}

export const ModalsContext = createContext<ModalsContextValue>({
    Modals,
    openModal: () => void 0,
    closeModal: () => void 0,
    isModalOpen: () => false,
    linuxAsarPath: null,
    setLinuxAsarPath: () => void 0,
})

export const ModalProvider: React.FC<ModalProviderProps> = ({ children }) => {
    const [openedModals, setOpenedModals] = useState<ModalsState>(initialModalsState)
    const [linuxAsarPath, setLinuxAsarPath] = useState<string | null>(null)

    const openModal = useCallback((modal: ModalName) => {
        setOpenedModals(prev => ({ ...prev, [modal]: true }))
    }, [])

    const closeModal = useCallback((modal: ModalName) => {
        setOpenedModals(prev => ({ ...prev, [modal]: false }))
    }, [])

    const isModalOpen = useCallback((modal: ModalName) => openedModals[modal], [openedModals])

    const value = useMemo<ModalsContextValue>(
        () => ({
            Modals,
            openModal,
            closeModal,
            isModalOpen,
            linuxAsarPath,
            setLinuxAsarPath,
        }),
        [closeModal, isModalOpen, linuxAsarPath, openModal],
    )

    return <ModalsContext.Provider value={value}>{children}</ModalsContext.Provider>
}

export const useModalContext = () => useContext(ModalsContext)
