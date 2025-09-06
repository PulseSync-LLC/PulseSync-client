import React from 'react'
import CheckOn from './../../../../static/assets/stratis-icons/check-square-on.svg'
import CheckOff from './../../../../static/assets/stratis-icons/minus-square-off.svg'
import FileDirectory from './../../../../static/assets/stratis-icons/file-eye.svg'
import FileExport from './../../../../static/assets/stratis-icons/file-export.svg'
import FileDelete from './../../../../static/assets/stratis-icons/file-delete.svg'
import Addon from '../../api/interfaces/addon.interface'
import toast from '../toast'
import { MdDeleteForever, MdFileOpen, MdIosShare } from 'react-icons/md'
import MainEvents from '../../../common/types/mainEvents'

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
        label: checkedState ? `Выключить ${currentAddon.name}` : `Включить ${currentAddon.name}`,
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
            window.desktopEvents?.send(MainEvents.OPEN_PATH, {
                action: 'theme',
                themeName: currentAddon.directoryName,
            }),
        show: actionVisibility.showDirectory ?? false,
        icon: <MdFileOpen size={20} />,
    },
    {
        label: `Экспорт ${currentAddon.name}`,
        onClick: () => {
            window.desktopEvents
                .invoke(MainEvents.EXPORT_ADDON, {
                    path: currentAddon.path,
                    name: currentAddon.name,
                })
                .then(result => {
                    if (result) {
                        toast.custom('success', `Готово`, 'Успешный экспорт')
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
            const confirmation = window.confirm(`Вы уверены, что хотите удалить тему "${currentAddon.name}"? Это действие нельзя будет отменить.`)
            if (confirmation) {
                const themeDirPath = currentAddon.path
                window.desktopEvents
                    .invoke(MainEvents.DELETE_ADDON_DIRECTORY, themeDirPath)
                    .then(() => {
                        window.refreshAddons()
                        console.log(`Тема "${currentAddon.name}" и связанные файлы удалены.`)
                    })
                    .catch(error => {
                        console.error(`Ошибка при удалении темы "${currentAddon.name}":`, error)
                    })
            }
        },
        show: actionVisibility.showDelete ?? false,
        icon: <MdDeleteForever size={20} />,
    },
]
