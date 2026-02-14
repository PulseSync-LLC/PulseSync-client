import type { ReactNode } from 'react'
import { Modals } from './modals'

export type ModalName = (typeof Modals)[keyof typeof Modals]
export type ModalsState = Record<ModalName, boolean>

export type ModalsContextValue = {
    Modals: typeof Modals
    openModal: (modal: ModalName) => void
    closeModal: (modal: ModalName) => void
    isModalOpen: (modal: ModalName) => boolean
    linuxAsarPath: string | null
    setLinuxAsarPath: (path: string | null) => void
}

export type ModalProviderProps = {
    children: ReactNode
}
