import React from 'react'

import { MdDeleteForever, MdFileOpen, MdIosShare } from 'react-icons/md'

import { t } from '@app/i18n'
import { desktopApi } from '@shared/desktop/desktopApi'
import toast from '@shared/ui/toast'

import type { ModalsContextValue } from '@app/providers/modal/types'
import type Addon from '@entities/addon/model/addon.interface'

export interface MenuItem {
    label?: string
    icon?: React.ReactNode
    onClick: () => void
    show: boolean
}

interface ActionVisibility {
    showDirectory?: boolean
    showExport?: boolean
    showDelete?: boolean
}

type ContextMenuModalActions = Pick<ModalsContextValue, 'Modals' | 'openModal' | 'setModalState'>

export const createContextMenuActions = (
    actionVisibility: ActionVisibility = {},
    currentAddon: Addon,
    modalActions: ContextMenuModalActions,
    onAddonListChanged?: () => void,
): MenuItem[] => {
    const { Modals, setModalState } = modalActions
    return [
        {
            label: t('contextMenuThemes.directory', { name: currentAddon.name }),
            onClick: () => desktopApi.addons.openDirectory(currentAddon.directoryName),
            show: actionVisibility.showDirectory ?? false,
            icon: <MdFileOpen size={20} />,
        },
        {
            label: t('contextMenuThemes.export', { name: currentAddon.name }),
            onClick: () => {
                desktopApi.addons
                    .exportArchive({
                        path: currentAddon.path,
                        name: currentAddon.name,
                    })
                    .then(result => {
                        if (result) {
                            toast.custom('success', t('common.doneTitle'), t('contextMenuThemes.exportSuccess'))
                        }
                    })
                    .catch(error => {
                        console.error(error)
                    })
            },
            show: actionVisibility.showExport ?? false,
            icon: <MdIosShare size={20} />,
        },
        {
            label: t('contextMenuThemes.delete', { name: currentAddon.name }),
            onClick: () => {
                setModalState(Modals.BASIC_CONFIRMATION, {
                    description: t('contextMenuThemes.deleteConfirm', { name: currentAddon.name }),
                    confirmLabel: t('modals.basicConfirmation.delete'),
                    confirmVariant: 'danger',
                    onConfirm: () => {
                        const themeDirPath = currentAddon.path
                        desktopApi.addons
                            .deleteDirectory(themeDirPath)
                            .then(result => {
                                const deleteResult = result as { reason?: string; success?: boolean }
                                if (!deleteResult?.success) {
                                    throw new Error(deleteResult?.reason || 'DELETE_FAILED')
                                }
                                onAddonListChanged?.()
                                console.log(t('contextMenuThemes.deleteSuccess', { name: currentAddon.name }))
                            })
                            .catch(error => {
                                console.error(t('contextMenuThemes.deleteError', { name: currentAddon.name }), error)
                            })
                    },
                    isOpen: true,
                })
            },
            show: actionVisibility.showDelete ?? false,
            icon: <MdDeleteForever size={20} />,
        },
    ]
}
