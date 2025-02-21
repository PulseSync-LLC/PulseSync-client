import React from 'react'
import CheckOn from './../../../../static/assets/stratis-icons/check-square-on.svg'
import CheckOff from './../../../../static/assets/stratis-icons/minus-square-off.svg'
import FileDirectory from './../../../../static/assets/stratis-icons/file-eye.svg'
import FileExport from './../../../../static/assets/stratis-icons/file-export.svg'
import FileDelete from './../../../../static/assets/stratis-icons/file-delete.svg'
import ThemeInterface from '../../api/interfaces/theme.interface'
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
    currentTheme: ThemeInterface,
): MenuItem[] => [
    {
        label: checkedState
            ? `Выключить ${currentTheme.name}`
            : `Включить ${currentTheme.name}`,
        onClick: () => {
            if (handleToggleCheck) {
                handleToggleCheck(currentTheme.name, !checkedState)
            }
        },
        show: actionVisibility.showCheck ?? true,
        icon: checkedState ? <CheckOn /> : <CheckOff />,
    },
    {
        label: `Директория аддона ${currentTheme.name}`,
        onClick: () =>
            window.desktopEvents?.send('openPath', {
                action: 'theme',
                themeName: currentTheme.name,
            }),
        show: actionVisibility.showDirectory ?? false,
        icon: <FileDirectory />,
    },
    {
        label: `Экспорт ${currentTheme.name}`,
        onClick: () => {
            window.desktopEvents
                .invoke('exportTheme', {
                    path: currentTheme.path,
                    name: currentTheme.name,
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
        label: `Страница темы ${currentTheme.name}`,
        onClick: () => console.log('Страница темы'),
        show: false,
    },
    {
        label: `Опубликовать ${currentTheme.name}`,
        onClick: () => console.log('Опубликовать'),
        show: false,
    },
    {
        label: 'Откатиться до версии с сервера',
        onClick: () => console.log('Откат'),
        show: false,
    },
    {
        label: `Удалить ${currentTheme.name}`,
        onClick: () => {
            const confirmation = window.confirm(
                `Вы уверены, что хотите удалить тему "${currentTheme.name}"? Это действие нельзя будет отменить.`,
            )
            if (confirmation) {
                const themeDirPath = currentTheme.path
                window.desktopEvents
                    .invoke('deleteThemeDirectory', themeDirPath)
                    .then(() => {
                        window.refreshThemes()
                        console.log(
                            `Тема "${currentTheme.name}" и связанные файлы удалены.`,
                        )
                    })
                    .catch((error) => {
                        console.error(
                            `Ошибка при удалении темы "${currentTheme.name}":`,
                            error,
                        )
                    })
            }
        },
        show: actionVisibility.showDelete ?? false,
        icon: <FileDelete />,
    },
]
