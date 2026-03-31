import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import RendererEvents from '@common/types/rendererEvents'
import { Modals } from '@app/providers/modal/modals'
import type { ModalName, ModalProviderProps, ModalState, ModalStatePatch, ModalsContextValue, ModalsState } from '@app/providers/modal/types'

const initialModalsState: ModalsState = {
    [Modals.MOD_CHANGELOG]: { isOpen: false },
    [Modals.MAC_UPDATE_DIALOG]: { isOpen: false },
    [Modals.LINUX_ASAR_PATH]: { isOpen: false },
    [Modals.APP_UPDATE_DIALOG]: { isOpen: false },
    [Modals.YANDEX_MUSIC_UPDATE_DIALOG]: { isOpen: false },
    [Modals.PREMIUM_PROMO]: { isOpen: false },
    [Modals.MAC_PERMISSIONS_MODAL]: { isOpen: false },
    [Modals.PREMIUM_UNLOCKED]: { isOpen: false },
    [Modals.LINUX_PERMISSIONS_MODAL]: { isOpen: false },
    [Modals.PEXT_DND_MODAL]: { isOpen: false, isValidFileType: true },
    [Modals.EXTENSION_PUBLICATION_MODAL]: {
        isOpen: false,
        addon: null,
        authorsDisplay: '',
        publication: null,
        publicationBusy: false,
        changelogText: '',
        onChangeChangelog: null,
    },
    [Modals.UNTRUSTED_LOCAL_ADDON_MODAL]: { isOpen: false, addonName: '', onConfirm: null },
    [Modals.EXPERIMENT_OVERRIDES_DEV]: { isOpen: false },
    [Modals.UPDATE_CHANNEL_OVERRIDE]: { isOpen: false },
}

export const ModalsContext = createContext<ModalsContextValue>({
    Modals,
    openModal: <T extends ModalName>(_modal: T, _state?: ModalStatePatch<T>) => void 0,
    closeModal: () => void 0,
    isModalOpen: () => false,
    getModalState: <T extends ModalName>(_modal: T) => ({ isOpen: false }) as ModalState<T>,
    setModalState: <T extends ModalName>(_modal: T, _state: Partial<ModalState<T>>) => void 0,
})

export const ModalProvider: React.FC<ModalProviderProps> = ({ children }) => {
    const [openedModals, setOpenedModals] = useState<ModalsState>(initialModalsState)

    const openModal = useCallback(<T extends ModalName>(modal: T, state?: ModalStatePatch<T>) => {
        setOpenedModals(
            prev =>
                ({
                    ...prev,
                    [modal]: {
                        ...prev[modal],
                        ...(state ?? {}),
                        isOpen: true,
                    },
                }) as ModalsState,
        )
    }, [])

    const closeModal = useCallback((modal: ModalName) => {
        setOpenedModals(
            prev =>
                ({
                    ...prev,
                    [modal]: {
                        ...prev[modal],
                        isOpen: false,
                    },
                }) as ModalsState,
        )
    }, [])

    const isModalOpen = useCallback((modal: ModalName) => openedModals[modal].isOpen, [openedModals])

    const getModalState = useCallback(<T extends ModalName>(modal: T) => openedModals[modal] as ModalState<T>, [openedModals])

    const setModalState = useCallback(<T extends ModalName>(modal: T, state: Partial<ModalState<T>>) => {
        setOpenedModals(prev => {
            const currentState = prev[modal] as ModalState<T>
            const hasChanges = Object.entries(state).some(([key, value]) => currentState[key as keyof ModalState<T>] !== value)

            if (!hasChanges) {
                return prev
            }

            return {
                ...prev,
                [modal]: {
                    ...currentState,
                    ...state,
                },
            } as ModalsState
        })
    }, [])

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
            getModalState,
            setModalState,
        }),
        [closeModal, getModalState, isModalOpen, openModal, setModalState],
    )

    return <ModalsContext.Provider value={value}>{children}</ModalsContext.Provider>
}

export const useModalContext = () => useContext(ModalsContext)
