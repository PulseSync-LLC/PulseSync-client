import type { ReactNode } from 'react'
import { Modals } from './modals'

export type ModalName = (typeof Modals)[keyof typeof Modals]

export type ModalAdditionalStateMap = {
    [Modals.PEXT_DND_MODAL]: {
        isValidFileType: boolean
    }
}

type EmptyObject = {}

export type ModalState<T extends ModalName = ModalName> = {
    isOpen: boolean
} & (T extends keyof ModalAdditionalStateMap ? ModalAdditionalStateMap[T] : EmptyObject)

export type ModalStatePatch<T extends ModalName> = Partial<Omit<ModalState<T>, 'isOpen'>>
export type ModalsState = { [K in ModalName]: ModalState<K> }

export type ModalsContextValue = {
    Modals: typeof Modals
    openModal: <T extends ModalName>(modal: T, state?: ModalStatePatch<T>) => void
    closeModal: (modal: ModalName) => void
    isModalOpen: (modal: ModalName) => boolean
    getModalState: <T extends ModalName>(modal: T) => ModalState<T>
    setModalState: <T extends ModalName>(modal: T, state: Partial<ModalState<T>>) => void
}

export type ModalProviderProps = {
    children: ReactNode
}
