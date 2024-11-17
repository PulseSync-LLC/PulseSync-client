import CheckOn from './../../../../static/assets/stratis-icons/check-square-on.svg'
import CheckOff from './../../../../static/assets/stratis-icons/minus-square-off.svg'
import FileDirectory from './../../../../static/assets/stratis-icons/file-eye.svg'
import FileExport from './../../../../static/assets/stratis-icons/file-export.svg'
import FileDelete from './../../../../static/assets/stratis-icons/file-delete.svg'

export interface SectionConfig {
    label?: string
    icon?: React.ReactNode
    onClick: () => void
    show: boolean
}

export const createActions = (
    themeName: string,
    onCheckboxChange: (themeName: string, isChecked: boolean) => void,
    exportTheme: (themeName: string) => void,
    onDelete: (themeName: string) => void,
    isChecked: boolean,
): SectionConfig[] => [
    {
        label: isChecked ? `Выключить ${themeName}` : `Включить ${themeName}`,
        onClick: () => onCheckboxChange(themeName, !isChecked),
        show: true,
        icon: isChecked ? <CheckOn /> : <CheckOff />, // Используйте компоненты JSX
    },
    {
        label: `Директория аддона ${themeName}`,
        onClick: () => console.log('Директория аддона'),
        show: false,
        icon: <FileDirectory />,
    },
    {
        label: `Экспорт ${themeName}`,
        onClick: () => exportTheme(themeName),
        show: true,
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
        onClick: () => onDelete(themeName),
        show: true,
        icon: <FileDelete />,
    },
]
