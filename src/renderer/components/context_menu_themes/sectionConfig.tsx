// context_menu_themes/sectionConfig.tsx

import React, { useContext } from 'react'
import CheckOn from './../../../../static/assets/stratis-icons/check-square-on.svg';
import CheckOff from './../../../../static/assets/stratis-icons/minus-square-off.svg';
import FileDirectory from './../../../../static/assets/stratis-icons/file-eye.svg';
import FileExport from './../../../../static/assets/stratis-icons/file-export.svg';
import FileDelete from './../../../../static/assets/stratis-icons/file-delete.svg';
import userContext from '../../api/context/user.context'
import ThemeInterface from '../../api/interfaces/theme.interface'
import toast from '../../api/toast'

export interface SectionConfig {
    label?: string;
    icon?: React.ReactNode;
    onClick: () => void;
    show: boolean;
}

interface CreateActionsOptions {
    showCheck?: boolean;
    showDirectory?: boolean;
    showExport?: boolean;
    showDelete?: boolean;
}
export const createActions = (
    onCheckboxChange: (themeName: string, isChecked: boolean) => void,
    isChecked: boolean = false,
    options: CreateActionsOptions = {},
    theme: ThemeInterface
): SectionConfig[] => [
    {
        label: isChecked ? `Выключить ${theme.name}` : `Включить ${theme.name}`,
        onClick: () => {
            if (onCheckboxChange) {
                onCheckboxChange(theme.name, !isChecked);
            }
        },
        show: options.showCheck ?? true,
        icon: isChecked ? <CheckOn /> : <CheckOff />,
    },
    {
        label: `Директория аддона ${theme.name}`,
        onClick: () => window.desktopEvents.send('openPath', {
            action: 'theme',
            themeName: theme.name
        }),
        show: options.showDirectory ?? false,
        icon: <FileDirectory />,
    },
    {
        label: `Экспорт ${theme.name}`,
        onClick: () => {
            window.desktopEvents
                .invoke('exportTheme', {
                    path: theme.path,
                    name: theme.name,
                })
                .then(result => {
                    if (result) {
                        toast.success('Успешный экспорт')
                    }
                })
                .catch(error => {
                    console.error(error)
                })
        },
        show: options.showExport ?? false,
        icon: <FileExport />,
    },
    {
        label: `Страница темы ${theme.name}`,
        onClick: () => console.log('Страница темы'),
        show: false,
    },
    {
        label: `Опубликовать ${theme.name}`,
        onClick: () => console.log('Опубликовать'),
        show: false,
    },
    {
        label: 'Откатиться до версии с сервера',
        onClick: () => console.log('Откат'),
        show: false,
    },
    {
        label: `Удалить ${theme.name}`,
        onClick: () => {
            const isConfirmed = window.confirm(
                `Вы уверены, что хотите удалить тему "${theme.name}"? Это действие нельзя будет отменить.`,
            )
            if (isConfirmed) {
                    const themeDirectoryPath = theme.path
                    window.desktopEvents
                        .invoke('deleteThemeDirectory', themeDirectoryPath)
                        .then(() => {
                            window.refreshThemes()
                            console.log(
                                `Тема "${theme.name}" и связанные файлы удалены.`,
                            )
                        })
                        .catch(error => {
                            console.error(
                                `Ошибка при удалении темы "${theme.name}":`,
                                error,
                            )
                        })
            }
        },
        show: options.showDelete ?? false,
        icon: <FileDelete />,
    },
];
