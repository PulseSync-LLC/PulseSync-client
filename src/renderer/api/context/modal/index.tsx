import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import RendererEvents from '../../../../common/types/rendererEvents'
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
    [Modals.PREMIUM_UNLOCKED]: false,
    [Modals.LINUX_PERMISSIONS_MODAL]: false,
}

export const ModalsContext = createContext<ModalsContextValue>({
    Modals,
    openModal: () => void 0,
    closeModal: () => void 0,
    isModalOpen: () => false,
})

export const ModalProvider: React.FC<ModalProviderProps> = ({ children }) => {
    const [openedModals, setOpenedModals] = useState<ModalsState>(initialModalsState)

    const openModal = useCallback((modal: ModalName) => {
        setOpenedModals(prev => ({ ...prev, [modal]: true }))
    }, [])

    const closeModal = useCallback((modal: ModalName) => {
        setOpenedModals(prev => ({ ...prev, [modal]: false }))
    }, [])

    const isModalOpen = useCallback((modal: ModalName) => openedModals[modal], [openedModals])

    const openModalByName = useCallback(
        (modalName: string) => {
            const modalValues = Object.values(Modals) as string[]
            if (!modalValues.includes(modalName)) {
                return false
            }
            openModal(modalName as ModalName)
            return true
        },
        [openModal],
    )

    useEffect(() => {
        const unsubscribe = window.desktopEvents?.on(RendererEvents.OPEN_MODAL, (_event, modalName: string) => {
            const ok = openModalByName(modalName)
            if (!ok) {
                console.warn('[ModalProvider] Unknown modal name for open:', modalName)
            }
        })

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe()
            }
        }
    }, [openModalByName])

    const value = useMemo<ModalsContextValue>(
        () => ({
            Modals,
            openModal,
            closeModal,
            isModalOpen,
        }),
        [closeModal, isModalOpen, openModal],
    )

    return <ModalsContext.Provider value={value}>{children}</ModalsContext.Provider>
}

export const useModalContext = () => useContext(ModalsContext)
