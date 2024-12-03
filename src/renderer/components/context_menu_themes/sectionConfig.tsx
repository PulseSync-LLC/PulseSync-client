// context_menu_themes/sectionConfig.tsx

import React from 'react';
import CheckOn from './../../../../static/assets/stratis-icons/check-square-on.svg';
import CheckOff from './../../../../static/assets/stratis-icons/minus-square-off.svg';
import FileDirectory from './../../../../static/assets/stratis-icons/file-eye.svg';
import FileExport from './../../../../static/assets/stratis-icons/file-export.svg';
import FileDelete from './../../../../static/assets/stratis-icons/file-delete.svg';

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
    themeName: string,
    onCheckboxChange?: (themeName: string, isChecked: boolean) => void,
    exportTheme?: (themeName: string) => void,
    onDelete?: (themeName: string) => void,
    isChecked: boolean = false,
    options: CreateActionsOptions = {}
): SectionConfig[] => [
    {
        label: isChecked ? `Выключить ${themeName}` : `Включить ${themeName}`,
        onClick: () => {
            if (onCheckboxChange) {
                onCheckboxChange(themeName, !isChecked);
            }
        },
        show: options.showCheck ?? true,
        icon: isChecked ? <CheckOn /> : <CheckOff />,
    },
    {
        label: `Директория аддона ${themeName}`,
        onClick: () => console.log('Директория аддона'),
        show: options.showDirectory ?? false,
        icon: <FileDirectory />,
    },
    {
        label: `Экспорт ${themeName}`,
        onClick: () => {
            if (exportTheme) {
                exportTheme(themeName);
            }
        },
        show: options.showExport ?? false,
        icon: <FileExport />,
    },
    {
        label: `Страница темы ${themeName}`,
        onClick: () => console.log('Страница темы'),
        show: false,
    },
    {
        label: `Опубликовать ${themeName}`,
        onClick: () => console.log('Опубликовать'),
        show: false,
    },
    {
        label: 'Откатиться до версии с сервера',
        onClick: () => console.log('Откат'),
        show: false,
    },
    {
        label: `Удалить ${themeName}`,
        onClick: () => {
            if (onDelete) {
                onDelete(themeName);
            }
        },
        show: options.showDelete ?? false,
        icon: <FileDelete />,
    },
];
