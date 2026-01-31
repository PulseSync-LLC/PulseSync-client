import React from 'react'
import CheckOn from '../../assets/stratis-icons/check-square-on.svg'
import CheckOff from '../../assets/stratis-icons/minus-square-off.svg'
import Addon from '../../api/interfaces/addon.interface'
import toast from '../toast'
import { MdDeleteForever, MdFileOpen, MdIosShare } from 'react-icons/md'
import MainEvents from '../../../common/types/mainEvents'
import { t } from '../../i18n'

export interface MenuItem {
    label?: string
    icon?: React.ReactNode
    onClick: () => void
    show: boolean
}

interface ActionVisibility {
    showCheck?: boolean
    showDirectory?: boolean
    showExport?: boolean
    showDelete?: boolean
}

export const createContextMenuActions = (
    handleToggleCheck: (themeName: string, isChecked: boolean) => void,
    checkedState: boolean = false,
    actionVisibility: ActionVisibility = {},
    currentAddon: Addon,
): MenuItem[] => [
    {
        label: checkedState
            ? t('contextMenuThemes.disable', { name: currentAddon.name })
            : t('contextMenuThemes.enable', { name: currentAddon.name }),
        onClick: () => {
            if (handleToggleCheck) {
                handleToggleCheck(currentAddon.name, !checkedState)
            }
        },
        show: actionVisibility.showCheck ?? true,
        icon: checkedState ? <CheckOn /> : <CheckOff />,
    },
    {
        label: t('contextMenuThemes.directory', { name: currentAddon.name }),
        onClick: () =>
            window.desktopEvents?.send(MainEvents.OPEN_PATH, {
                action: 'theme',
                themeName: currentAddon.directoryName,
            }),
        show: actionVisibility.showDirectory ?? false,
        icon: <MdFileOpen size={20} />,
    },
    {
        label: t('contextMenuThemes.export', { name: currentAddon.name }),
        onClick: () => {
            window.desktopEvents
                .invoke(MainEvents.EXPORT_ADDON, {
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
        label: t('contextMenuThemes.page', { name: currentAddon.name }),
        onClick: () => console.log(t('contextMenuThemes.pageLog')),
        show: false,
    },
    {
        label: t('contextMenuThemes.publish', { name: currentAddon.name }),
        onClick: () => console.log(t('contextMenuThemes.publishLog')),
        show: false,
    },
    {
        label: t('contextMenuThemes.rollback'),
        onClick: () => console.log(t('contextMenuThemes.rollbackLog')),
        show: false,
    },
    {
        label: t('contextMenuThemes.delete', { name: currentAddon.name }),
        onClick: () => {
            const confirmation = window.confirm(t('contextMenuThemes.deleteConfirm', { name: currentAddon.name }))
            if (confirmation) {
                const themeDirPath = currentAddon.path
                window.desktopEvents
                    .invoke(MainEvents.DELETE_ADDON_DIRECTORY, themeDirPath)
                    .then(() => {
                        window.refreshAddons()
                        console.log(t('contextMenuThemes.deleteSuccess', { name: currentAddon.name }))
                    })
                    .catch(error => {
                        console.error(t('contextMenuThemes.deleteError', { name: currentAddon.name }), error)
                    })
            }
        },
        show: actionVisibility.showDelete ?? false,
        icon: <MdDeleteForever size={20} />,
    },
]
