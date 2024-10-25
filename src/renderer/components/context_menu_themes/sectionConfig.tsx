export interface SectionConfig {
    label: string;
    onClick: () => void;
    show: boolean;
}

export const createActions = (themeName: string): SectionConfig[] => [
    {
        label: `Выключить ${themeName}`,
        onClick: () => console.log("Выключить"),
        show: true,
    },
    {
        label: `Директория аддона ${themeName}`,
        onClick: () => console.log("Директория аддона"),
        show: true,
    },
    {
        label: `Экспорт ${themeName}`,
        onClick: () => console.log("Экспорт"),
        show: true,
    },
    {
        label: `Страница темы ${themeName}`,
        onClick: () => console.log("Страница темы"),
        show: true,
    },
    {
        label: `Опубликовать ${themeName}`,
        onClick: () => console.log("Опубликовать"),
        show: true,
    },
    {
        label: "Откатиться до версии с сервера",
        onClick: () => console.log("Откат"),
        show: true,
    },
    {
        label: `Удалить ${themeName}`,
        onClick: () => console.log("Удалить"),
        show: true,
    },
];
