import type { ReactNode } from 'react'
import { Modals } from '@app/providers/modal/modals'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'
import type Addon from '@entities/addon/model/addon.interface'

export type ModalName = (typeof Modals)[keyof typeof Modals]

export type ModalAdditionalStateMap = {
    [Modals.PEXT_DND_MODAL]: {
        isValidFileType: boolean
    }
    [Modals.EXTENSION_PUBLICATION_MODAL]: {
        addon: Addon | null
        authorsDisplay: string
        publication: StoreAddon | null
        publicationBusy: boolean
        changelogText: string
        githubUrlText: string
        onChangeChangelog?: ((value: string) => void) | null
        onChangeGithubUrl?: ((value: string) => void) | null
        onPublish?: ((changelogText: string, githubUrl: string, usedAiDuringDevelopment: boolean) => void) | null
        onUpdate?: ((changelogText: string, githubUrl: string, usedAiDuringDevelopment: boolean) => void) | null
    }
    [Modals.UNTRUSTED_LOCAL_ADDON_MODAL]: {
        addonName: string
        onConfirm?: (() => void) | null
    }
    [Modals.BASIC_CONFIRMATION]: {
        title: string
        description?: string | null
        confirmLabel?: string | null
        confirmVariant?: 'primary' | 'danger'
        onConfirm?: (() => void) | null
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
