export interface SectionConfig {
    label: string;
    onClick: () => void;
    show: boolean;
}

export const createActions = (
    themeName: string,
    onCheckboxChange: (themeName: string, isChecked: boolean) => void,
    exportTheme: (themeName: string) => void,
    onDelete: (themeName: string) => void,
    isChecked: boolean
): SectionConfig[] => [
    {
        label: isChecked ? `Выключить ${themeName}` : `Включить ${themeName}`,
        onClick: () => onCheckboxChange(themeName, !isChecked),
        show: true,
    },
    {
        label: `Директория аддона ${themeName}`,
        onClick: () => console.log("Директория аддона"),
        show: false,
    },
    {
        label: `Экспорт ${themeName}`,
        onClick: () => exportTheme(themeName),
        show: false,
    },    
    {
        label: `Страница темы ${themeName}`,
        onClick: () => console.log("Страница темы"),
        show: false,
    },
    {
        label: `Опубликовать ${themeName}`,
        onClick: () => console.log("Опубликовать"),
        show: false,
    },
    {
        label: "Откатиться до версии с сервера",
        onClick: () => console.log("Откат"),
        show: false,
    },
    {
        label: `Удалить ${themeName}`,
        onClick: () => onDelete(themeName),
        show: true,
    },
];