import React from 'react'
import CheckOn from './../../../../static/assets/stratis-icons/check-square-on.svg'
import CheckOff from './../../../../static/assets/stratis-icons/minus-square-off.svg'
import FileDirectory from './../../../../static/assets/stratis-icons/file-eye.svg'
import FileExport from './../../../../static/assets/stratis-icons/file-export.svg'
import FileDelete from './../../../../static/assets/stratis-icons/file-delete.svg'
import AddonInterface from '../../api/interfaces/addon.interface'
import toast from '../toast'

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
    currentAddon: AddonInterface,
): MenuItem[] => [
    {
        label: checkedState
            ? `Выключить ${currentAddon.name}`
            : `Включить ${currentAddon.name}`,
        onClick: () => {
            if (handleToggleCheck) {
                handleToggleCheck(currentAddon.name, !checkedState)
            }
        },
        show: actionVisibility.showCheck ?? true,
        icon: checkedState ? <CheckOn /> : <CheckOff />,
    },
    {
        label: `Директория аддона ${currentAddon.name}`,
        onClick: () =>
            window.desktopEvents?.send('openPath', {
                action: 'theme',
                themeName: currentAddon.name,
            }),
        show: actionVisibility.showDirectory ?? false,
        icon: <FileDirectory />,
    },
    {
        label: `Экспорт ${currentAddon.name}`,
        onClick: () => {
            window.desktopEvents
                .invoke('exportAddon', {
                    path: currentAddon.path,
                    name: currentAddon.name,
                })
                .then((result) => {
                    if (result) {
                        toast.custom('success', `Готово`, 'Успешный экспорт')
                    }
                })
                .catch((error) => {
                    console.error(error)
                })
        },
        show: actionVisibility.showExport ?? false,
        icon: <FileExport />,
    },
    {
        label: `Страница темы ${currentAddon.name}`,
        onClick: () => console.log('Страница темы'),
        show: false,
    },
    {
        label: `Опубликовать ${currentAddon.name}`,
        onClick: () => console.log('Опубликовать'),
        show: false,
    },
    {
        label: 'Откатиться до версии с сервера',
        onClick: () => console.log('Откат'),
        show: false,
    },
    {
        label: `Удалить ${currentAddon.name}`,
        onClick: () => {
            const confirmation = window.confirm(
                `Вы уверены, что хотите удалить тему "${currentAddon.name}"? Это действие нельзя будет отменить.`,
            )
            if (confirmation) {
                const themeDirPath = currentAddon.path
                window.desktopEvents
                    .invoke('deleteAddonDirectory', themeDirPath)
                    .then(() => {
                        window.refreshAddons()
                        console.log(
                            `Тема "${currentAddon.name}" и связанные файлы удалены.`,
                        )
                    })
                    .catch((error) => {
                        console.error(
                            `Ошибка при удалении темы "${currentAddon.name}":`,
                            error,
                        )
                    })
            }
        },
        show: actionVisibility.showDelete ?? false,
        icon: <FileDelete />,
    },
]
