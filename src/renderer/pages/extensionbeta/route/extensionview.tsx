import path from 'path'
import React, { CSSProperties, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import {
    MdBookmarkBorder,
    MdDesignServices,
    MdEdit,
    MdExplore,
    MdFolder,
    MdKeyboardArrowDown,
    MdMoreHoriz,
    MdSettings,
    MdStickyNote2,
    MdStoreMallDirectory,
} from 'react-icons/md'

import Layout from '../../../components/layout'
import Button from '../../../components/button'
import ViewModal from '../../../components/context_menu_themes/viewModal'
import ThemeInterface from '../../../api/interfaces/theme.interface'
import { createContextMenuActions } from '../../../components/context_menu_themes/sectionConfig'

import * as globalStyles from '../../../../../static/styles/page/index.module.scss'
import * as localStyles from './extensionview.module.scss'

interface ThemeConfig {
    sections: Section[]
}

interface Section {
    title: string
    items: Item[]
}

interface Item {
    id: string
    name: string
    description: string
    type: string
    bool?: boolean
    input?: string
    buttons?: ButtonItem[]
}

interface ButtonItem {
    name: string
    text: string
}

interface ActionOptions {
    showCheck?: boolean
    showDirectory?: boolean
    showExport?: boolean
    showDelete?: boolean
}

interface Props {
    isTheme: ThemeInterface
    isChecked: boolean
    onCheckboxChange?: (themeName: string, isChecked: boolean) => void
    exportTheme?: (themeName: string) => void
    onDelete?: (themeName: string) => void
    children?: any
    className?: string
    style?: CSSProperties
    options?: ActionOptions
}

const ExtensionViewPage: React.FC = () => {
    const [contextMenuVisible, setContextMenuVisible] = useState(false)
    const [currentTheme, setCurrentTheme] = useState<ThemeInterface | null>(
        null,
    )
    const [bannerImage, setBannerImage] = useState(
        'static/assets/images/no_themeBackground.png',
    )
    const [activatedTheme, setActivatedTheme] = useState(
        window.electron.store.get('theme') || 'Default',
    )
    const [themeActive, setThemeActive] = useState(activatedTheme !== 'Default')
    const [bannerExpanded, setBannerExpanded] = useState(false)
    const [bannerHeight, setBannerHeight] = useState(84)
    const [bannerOpacity, setBannerOpacity] = useState(1)
    const [activeTab, setActiveTab] = useState('Overview')
    const [configData, setConfigData] = useState<ThemeConfig | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [transitionsEnabled, setTransitionsEnabled] = useState(true)
    const [markdownData, setMarkdownData] = useState<string>('')
    const [configFileExists, setConfigFileExists] = useState<boolean | null>(
        null,
    )

    const menuElementRef = useRef(null)
    const location = useLocation()
    const navigate = useNavigate()

    useEffect(() => {
        const receivedTheme = location.state?.theme as ThemeInterface
        if (receivedTheme) {
            setCurrentTheme(receivedTheme)
        } else {
            navigate('/extensionbeta', { replace: false })
        }
    }, [location.state, navigate])

    useEffect(() => {
        const clickOutsideHandler = (event: { target: any }) => {
            if (
                menuElementRef.current &&
                !menuElementRef.current.contains(event.target)
            ) {
                setContextMenuVisible(false)
            }
        }

        if (contextMenuVisible) {
            document.addEventListener('mousedown', clickOutsideHandler)
        } else {
            document.removeEventListener('mousedown', clickOutsideHandler)
        }

        return () => {
            document.removeEventListener('mousedown', clickOutsideHandler)
        }
    }, [contextMenuVisible])

    useEffect(() => {
        if (currentTheme) {
            const expandedStates =
                window.electron.store.get('themes.themeIsExpanded') || {}
            if (!expandedStates.hasOwnProperty(currentTheme.name)) {
                expandedStates[currentTheme.name] = false
                window.electron.store.set(
                    'themes.themeIsExpanded',
                    expandedStates,
                )
            }
            const initialExpanded = expandedStates[currentTheme.name]
            setBannerExpanded(initialExpanded)
            setBannerHeight(initialExpanded ? 277 : 84)
        }
    }, [currentTheme])

    const toggleBanner = () => {
        const newState = !bannerExpanded
        setBannerExpanded(newState)

        if (currentTheme) {
            const expandedStates =
                window.electron.store.get('themes.themeIsExpanded') || {}
            expandedStates[currentTheme.name] = newState
            window.electron.store.set('themes.themeIsExpanded', expandedStates)
        }
    }

    const toggleThemeActivation = () => {
        const newTheme = themeActive
            ? 'Default'
            : currentTheme?.name || 'Default'
        window.electron.store.set('theme', newTheme)
        setActivatedTheme(newTheme)
        window.desktopEvents.send('themeChanged', newTheme)
        setThemeActive(!themeActive)
    }

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null
        const targetHeight = bannerExpanded ? 277 : 84
        const step = bannerExpanded ? -1 : 1

        const animateBannerHeight = () => {
            setBannerHeight(prev => {
                if (
                    (step < 0 && prev <= targetHeight) ||
                    (step > 0 && prev >= targetHeight)
                ) {
                    if (interval) clearInterval(interval)
                    return targetHeight
                }
                return prev + step
            })
        }

        interval = setInterval(animateBannerHeight, 5)
        return () => {
            if (interval) clearInterval(interval)
        }
    }, [bannerExpanded])

    const activateTheme = () => {
        const newTheme = currentTheme?.name || 'Default'
        window.electron.store.set('theme', newTheme)
        setActivatedTheme(newTheme)
        window.desktopEvents.send('themeChanged', newTheme)
        setThemeActive(true)
    }

    useEffect(() => {
        const savedTheme = window.electron.store.get('theme')
        setActivatedTheme(savedTheme)
        setThemeActive(savedTheme !== 'Default')
    }, [])

    const getEncodedPath = (p: string) => {
        return encodeURI(p.replace(/\\/g, '/'))
    }

    const changeTag = (tag: string) => {
        navigate(`/extensionbeta?selectedTag=${encodeURIComponent(tag)}`, {
            replace: false,
        })
    }

    useEffect(() => {
        if (currentTheme?.path && currentTheme.banner) {
            const bannerPath = getEncodedPath(
                `${currentTheme.path}/${currentTheme.banner}`,
            )
            fetch(bannerPath)
                .then(res => {
                    if (res.ok) {
                        setBannerImage(bannerPath)
                    } else {
                        setBannerImage(
                            'static/assets/images/no_themeBackground.png',
                        )
                    }
                })
                .catch(() => {
                    setBannerImage(
                        'static/assets/images/no_themeBackground.png',
                    )
                })
        }
    }, [currentTheme])

    useEffect(() => {
        if (currentTheme) {
            const readmePath = `${currentTheme.path}/README.md`
            fetch(readmePath)
                .then(response => response.text())
                .then(data => {
                    setMarkdownData(data)
                })
                .catch(() => {
                    console.error('Ошибка при загрузке README.md:')
                })
        }
    }, [currentTheme])

    useEffect(() => {
        const checkConfigFile = async () => {
            if (currentTheme) {
                const configPath = path.join(
                    currentTheme.path,
                    'handleEvents.json',
                )
                const exists = await window.desktopEvents.invoke(
                    'file-event',
                    'check-file-exists',
                    configPath,
                )
                setConfigFileExists(exists)

                if (exists) {
                    const configContent = await window.desktopEvents.invoke(
                        'file-event',
                        'read-file',
                        configPath,
                    )
                    setConfigData(JSON.parse(configContent))
                }
            }
        }

        if (currentTheme) {
            checkConfigFile()
        }
    }, [currentTheme])

    const createDefaultConfig = async () => {
        if (currentTheme) {
            const configPath = path.join(currentTheme.path, 'handleEvents.json')
            const defaultContent: ThemeConfig = {
                sections: [
                    {
                        title: 'Действия',
                        items: [
                            {
                                id: 'showHints',
                                name: 'Показать подсказки',
                                description:
                                    'Включает отображение подсказок при наведении курсора',
                                type: 'button',
                                bool: false,
                            },
                            {
                                id: 'darkMode',
                                name: 'Режим темной темы',
                                description:
                                    'Активирует тёмный режим для комфортной работы при слабом освещении',
                                type: 'button',
                                bool: false,
                            },
                            {
                                id: 'enableNotifications',
                                name: 'Уведомления',
                                description:
                                    'Включает показ всплывающих уведомлений о новых событиях',
                                type: 'button',
                                bool: false,
                            },
                        ],
                    },
                    {
                        title: 'Цветовая схема',
                        items: [
                            {
                                id: 'mainBackground',
                                name: 'Основной фон',
                                description:
                                    'Цвет фона главного окна приложения',
                                type: 'color',
                                input: '#3498db',
                                bool: true,
                            },
                        ],
                    },
                    {
                        title: 'Текстовые настройки',
                        items: [
                            {
                                id: 'greetingMessage',
                                name: 'Приветственное сообщение',
                                description:
                                    'Текст, отображаемый при запуске приложения',
                                type: 'text',
                                buttons: [
                                    {
                                        name: 'MessageParam1',
                                        text: 'Добро пожаловать!',
                                    },
                                    {
                                        name: 'MessageParam2',
                                        text: 'Отмена',
                                    },
                                ],
                            },
                        ],
                    },
                ],
            }

            const result = await window.desktopEvents.invoke(
                'file-event',
                'create-config-file',
                configPath,
                defaultContent,
            )

            if (result.success) {
                setConfigData(defaultContent)
                setConfigFileExists(true)
            } else {
                console.error(
                    'Ошибка при создании файла конфигурации:',
                    result.error,
                )
            }
        }
    }

    const writeConfigFile = async (updatedConfig: ThemeConfig) => {
        if (currentTheme) {
            const configPath = path.join(currentTheme.path, 'handleEvents.json')
            try {
                await window.desktopEvents.invoke(
                    'file-event',
                    'write-file',
                    configPath,
                    updatedConfig,
                )
            } catch (error) {
                console.error('Ошибка при сохранении конфигурации:', error)
            }
        }
    }

    const updateConfigField = (
        sectionIndex: number,
        itemIndex: number | null,
        key:
            | 'name'
            | 'description'
            | 'input'
            | 'text'
            | 'title'
            | 'bool'
            | 'id',
        value: any,
    ) => {
        const updatedConfig = structuredClone(configData)
        if (!updatedConfig) return

        if (itemIndex !== null) {
            const section = updatedConfig.sections[sectionIndex]
            const item = section.items[itemIndex]
            if (item) {
                ;(item as any)[key] = value
            }
        } else {
            ;(updatedConfig.sections[sectionIndex] as any)[key] = value
        }

        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
    }

    const updateButtonConfig = (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
        key: keyof ButtonItem,
        newValue: string,
    ) => {
        if (!configData) return
        const updatedConfig = structuredClone(configData)

        if (
            updatedConfig.sections[sectionIndex] &&
            updatedConfig.sections[sectionIndex].items[itemIndex] &&
            updatedConfig.sections[sectionIndex].items[itemIndex].buttons &&
            updatedConfig.sections[sectionIndex].items[itemIndex].buttons[
                buttonIndex
            ]
        ) {
            updatedConfig.sections[sectionIndex].items[itemIndex].buttons[
                buttonIndex
            ][key] = newValue
            setConfigData(updatedConfig)
            writeConfigFile(updatedConfig)
        }
    }

    function MarkdownLink(props: any) {
        return (
            <a href={props.href} target="_blank" rel="noreferrer">
                {props.children}
            </a>
        )
    }

    const renderActiveTabContent = () => {
        if (!currentTheme) return null

        switch (activeTab) {
            case 'Overview':
                return (
                    <div className={localStyles.galleryContainer}>
                        <div className={localStyles.markdownContent}>
                            <ReactMarkdown
                                className={localStyles.markdownText}
                                remarkPlugins={[remarkGfm, remarkBreaks]}
                                rehypePlugins={[rehypeRaw]}
                                components={{ a: MarkdownLink }}
                            >
                                {markdownData || currentTheme.description}
                            </ReactMarkdown>
                        </div>
                    </div>
                )
            case 'Settings':
                if (configFileExists === false) {
                    return (
                        <div className={localStyles.alertContent}>
                            <div>Создать базовый handleEvent.json</div>
                            <button
                                className={localStyles.settingsAlertButton}
                                onClick={createDefaultConfig}
                            >
                                Создать файл
                            </button>
                        </div>
                    )
                }

                return (
                    <div className={localStyles.settingsContent}>
                        {configData?.sections.map(
                            (section: Section, sectionIndex: number) => (
                                <div
                                    key={sectionIndex}
                                    className={localStyles.section}
                                >
                                    {editMode ? (
                                        <input
                                            type="text"
                                            className={
                                                localStyles.sectionTitleInput
                                            }
                                            value={section.title}
                                            onChange={e =>
                                                updateConfigField(
                                                    sectionIndex,
                                                    null,
                                                    'title',
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    ) : (
                                        <div
                                            className={localStyles.sectionTitle}
                                        >
                                            {section.title}
                                        </div>
                                    )}
                                    {section.items.map(
                                        (item: Item, itemIndex: number) => (
                                            <div
                                                key={itemIndex}
                                                className={`${localStyles.item} ${localStyles[`item-${item.type}`]}`}
                                            >
                                                {editMode ? (
                                                    <>
                                                        <span
                                                            className={
                                                                localStyles.itemTypeInfo
                                                            }
                                                        >
                                                            Type: {item.type}
                                                        </span>
                                                        <span
                                                            className={
                                                                localStyles.itemNameEdit
                                                            }
                                                        >
                                                            id (string):{' '}
                                                        </span>
                                                        <input
                                                            type="text"
                                                            className={
                                                                localStyles.itemNameInput
                                                            }
                                                            value={item.id}
                                                            onChange={e =>
                                                                updateConfigField(
                                                                    sectionIndex,
                                                                    itemIndex,
                                                                    'id',
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                        />
                                                        <span
                                                            className={
                                                                localStyles.itemNameEdit
                                                            }
                                                        >
                                                            name (string):{' '}
                                                        </span>
                                                        <input
                                                            type="text"
                                                            className={
                                                                localStyles.itemNameInput
                                                            }
                                                            value={item.name}
                                                            onChange={e =>
                                                                updateConfigField(
                                                                    sectionIndex,
                                                                    itemIndex,
                                                                    'name',
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                        />
                                                        <span
                                                            className={
                                                                localStyles.itemNameEdit
                                                            }
                                                        >
                                                            description
                                                            (string):{' '}
                                                        </span>
                                                        <input
                                                            type="text"
                                                            className={
                                                                localStyles.itemDescriptionInput
                                                            }
                                                            value={
                                                                item.description
                                                            }
                                                            onChange={e =>
                                                                updateConfigField(
                                                                    sectionIndex,
                                                                    itemIndex,
                                                                    'description',
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                        />
                                                    </>
                                                ) : (
                                                    <>
                                                        <div
                                                            className={
                                                                localStyles.itemName
                                                            }
                                                        >
                                                            {item.name}
                                                        </div>
                                                        <div
                                                            className={
                                                                localStyles.itemDescription
                                                            }
                                                        >
                                                            {item.description}
                                                        </div>
                                                    </>
                                                )}

                                                {item.type === 'button' &&
                                                    (editMode ? (
                                                        <button
                                                            disabled
                                                            className={`${localStyles.itemButton} ${
                                                                item.bool
                                                                    ? localStyles.itemButtonActive
                                                                    : ''
                                                            }`}
                                                        >
                                                            {item.bool
                                                                ? 'Включено'
                                                                : 'Отключено'}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className={`${localStyles.itemButton} ${
                                                                item.bool
                                                                    ? localStyles.itemButtonActive
                                                                    : ''
                                                            }`}
                                                            onClick={() =>
                                                                updateConfigField(
                                                                    sectionIndex,
                                                                    itemIndex,
                                                                    'bool',
                                                                    !item.bool,
                                                                )
                                                            }
                                                        >
                                                            {item.bool
                                                                ? 'Включено'
                                                                : 'Отключено'}
                                                        </button>
                                                    ))}

                                                {item.type === 'color' &&
                                                    (editMode ? (
                                                        <>
                                                            <span
                                                                className={
                                                                    localStyles.itemNameEdit
                                                                }
                                                            >
                                                                input (string):{' '}
                                                            </span>
                                                            <input
                                                                type="text"
                                                                className={
                                                                    localStyles.itemColorInputText
                                                                }
                                                                value={
                                                                    item.input ||
                                                                    ''
                                                                }
                                                                onChange={e =>
                                                                    updateConfigField(
                                                                        sectionIndex,
                                                                        itemIndex,
                                                                        'input',
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder="#FFFFFF"
                                                            />
                                                        </>
                                                    ) : (
                                                        <input
                                                            type="color"
                                                            className={
                                                                localStyles.itemColorInput
                                                            }
                                                            value={
                                                                item.input ||
                                                                '#FFFFFF'
                                                            }
                                                            onChange={e =>
                                                                updateConfigField(
                                                                    sectionIndex,
                                                                    itemIndex,
                                                                    'input',
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                        />
                                                    ))}

                                                {item.type === 'text' &&
                                                    item.buttons && (
                                                        <div
                                                            className={
                                                                localStyles.itemButtons
                                                            }
                                                        >
                                                            {item.buttons.map(
                                                                (
                                                                    button: ButtonItem,
                                                                    buttonIndex: number,
                                                                ) => (
                                                                    <div
                                                                        key={
                                                                            buttonIndex
                                                                        }
                                                                        className={
                                                                            localStyles.buttonContainer
                                                                        }
                                                                    >
                                                                        {editMode ? (
                                                                            <>
                                                                                <span
                                                                                    className={
                                                                                        localStyles.itemNameButtons
                                                                                    }
                                                                                >
                                                                                    button.name
                                                                                    (string):
                                                                                </span>
                                                                                <input
                                                                                    type="text"
                                                                                    className={
                                                                                        localStyles.buttonNameInput
                                                                                    }
                                                                                    value={
                                                                                        button.name
                                                                                    }
                                                                                    onChange={e => {
                                                                                        const newName =
                                                                                            e
                                                                                                .target
                                                                                                .value
                                                                                        updateButtonConfig(
                                                                                            sectionIndex,
                                                                                            itemIndex,
                                                                                            buttonIndex,
                                                                                            'name',
                                                                                            newName,
                                                                                        )
                                                                                    }}
                                                                                />
                                                                                <span
                                                                                    className={
                                                                                        localStyles.iNBMini
                                                                                    }
                                                                                >
                                                                                    button.text
                                                                                    (string):
                                                                                </span>
                                                                                <input
                                                                                    type="text"
                                                                                    className={
                                                                                        localStyles.buttonTextInputEdit
                                                                                    }
                                                                                    value={
                                                                                        button.text
                                                                                    }
                                                                                    onChange={e =>
                                                                                        updateButtonConfig(
                                                                                            sectionIndex,
                                                                                            itemIndex,
                                                                                            buttonIndex,
                                                                                            'text',
                                                                                            e
                                                                                                .target
                                                                                                .value,
                                                                                        )
                                                                                    }
                                                                                />
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <div
                                                                                    className={
                                                                                        localStyles.buttonName
                                                                                    }
                                                                                >
                                                                                    {
                                                                                        button.name
                                                                                    }
                                                                                </div>
                                                                                <input
                                                                                    type="text"
                                                                                    className={
                                                                                        localStyles.buttonTextInput
                                                                                    }
                                                                                    value={
                                                                                        button.text
                                                                                    }
                                                                                    onChange={e =>
                                                                                        updateButtonConfig(
                                                                                            sectionIndex,
                                                                                            itemIndex,
                                                                                            buttonIndex,
                                                                                            'text',
                                                                                            e
                                                                                                .target
                                                                                                .value,
                                                                                        )
                                                                                    }
                                                                                />
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                ),
                                                            )}
                                                        </div>
                                                    )}
                                            </div>
                                        ),
                                    )}
                                </div>
                            ),
                        )}
                    </div>
                )

            case 'Metadata':
                return (
                    <div className={localStyles.alertContent}>
                        Страница "метаданные темы" в разработке
                    </div>
                )

            default:
                return null
        }
    }

    if (!currentTheme) return null

    return (
        <Layout title="Стилизация">
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        <div className={globalStyles.container0x0}>
                            {activeTab === 'Settings' &&
                                configFileExists === true && (
                                    <button
                                        className={`${localStyles.edit} ${editMode ? localStyles.activeEdit : ''}`}
                                        onClick={() =>
                                            setEditMode(prev => !prev)
                                        }
                                    >
                                        <MdEdit />
                                    </button>
                                )}
                            <div className={localStyles.containerFix}>
                                <div
                                    className={localStyles.bannerBackground}
                                    style={{
                                        transition: transitionsEnabled
                                            ? 'opacity 0.5s ease, height 0.5s ease, gap 0.5s ease'
                                            : 'none',
                                        opacity: bannerOpacity,
                                        backgroundImage: `url(${bannerImage})`,
                                        backgroundSize: 'cover',
                                        height: `${bannerHeight}px`,
                                    }}
                                >
                                    <Button
                                        className={localStyles.hideButton}
                                        onClick={() =>
                                            setBannerExpanded(prev => !prev)
                                        }
                                    >
                                        <MdKeyboardArrowDown
                                            size={20}
                                            style={
                                                bannerExpanded
                                                    ? {
                                                          transition:
                                                              'var(--transition)',
                                                          transform:
                                                              'rotate(180deg)',
                                                      }
                                                    : {
                                                          transition:
                                                              'var(--transition)',
                                                          transform:
                                                              'rotate(0deg)',
                                                      }
                                            }
                                        />
                                    </Button>
                                </div>

                                <div className={localStyles.themeInfo}>
                                    <div className={localStyles.themeHeader}>
                                        <div
                                            className={
                                                localStyles.containerLeft
                                            }
                                        >
                                            <img
                                                className={
                                                    localStyles.themeImage
                                                }
                                                src={`${currentTheme.path}/${currentTheme.image}`}
                                                alt={`${currentTheme.name} image`}
                                                width="100"
                                                height="100"
                                                onError={e => {
                                                    ;(
                                                        e.target as HTMLImageElement
                                                    ).src =
                                                        'static/assets/images/no_themeImage.png'
                                                }}
                                            />
                                            <div
                                                className={
                                                    localStyles.themeTitle
                                                }
                                            >
                                                <div
                                                    className={
                                                        localStyles.titleContainer
                                                    }
                                                >
                                                    <NavLink
                                                        className={
                                                            localStyles.path
                                                        }
                                                        to="/extensionbeta"
                                                    >
                                                        Extension
                                                    </NavLink>
                                                    /
                                                    <div
                                                        className={
                                                            localStyles.title
                                                        }
                                                    >
                                                        {currentTheme.name ||
                                                            'Название недоступно'}
                                                    </div>
                                                    <Button
                                                        className={
                                                            localStyles.addFavorite
                                                        }
                                                        disabled
                                                    >
                                                        <MdBookmarkBorder
                                                            size={20}
                                                        />
                                                    </Button>
                                                </div>
                                                <div
                                                    className={
                                                        localStyles.authorInfo
                                                    }
                                                >
                                                    {currentTheme.author && (
                                                        <div>
                                                            {
                                                                currentTheme.author
                                                            }
                                                        </div>
                                                    )}{' '}
                                                    -{' '}
                                                    {currentTheme.lastModified && (
                                                        <div>
                                                            Last update:{' '}
                                                            {
                                                                currentTheme.lastModified
                                                            }
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className={localStyles.rightContainer}>
                                        <div
                                            className={
                                                localStyles.detailsContainer
                                            }
                                        >
                                            <div
                                                className={
                                                    localStyles.detailInfo
                                                }
                                            >
                                                {currentTheme.version && (
                                                    <div
                                                        className={
                                                            localStyles.box
                                                        }
                                                    >
                                                        <MdDesignServices />{' '}
                                                        {currentTheme.version}
                                                    </div>
                                                )}
                                                {currentTheme.size !==
                                                    undefined && (
                                                    <div
                                                        className={
                                                            localStyles.box
                                                        }
                                                    >
                                                        <MdFolder />{' '}
                                                        {currentTheme.size}
                                                    </div>
                                                )}
                                            </div>
                                            <div
                                                className={
                                                    localStyles.detailInfo
                                                }
                                            >
                                                {Array.isArray(
                                                    currentTheme.tags,
                                                ) &&
                                                    currentTheme.tags.length >
                                                        0 &&
                                                    currentTheme.tags.map(
                                                        tag => (
                                                            <Button
                                                                key={tag}
                                                                className={
                                                                    localStyles.tag
                                                                }
                                                                onClick={() =>
                                                                    changeTag(
                                                                        tag,
                                                                    )
                                                                }
                                                            >
                                                                {tag}
                                                            </Button>
                                                        ),
                                                    )}
                                            </div>
                                        </div>

                                        <div ref={menuElementRef}>
                                            <div
                                                className={
                                                    localStyles.miniButtonsContainer
                                                }
                                            >
                                                <Button
                                                    className={`${localStyles.defaultButton} ${
                                                        activatedTheme ===
                                                        currentTheme.name
                                                            ? localStyles.defaultButtonActive
                                                            : ''
                                                    }`}
                                                    onClick={
                                                        activatedTheme !==
                                                        currentTheme.name
                                                            ? activateTheme
                                                            : toggleThemeActivation
                                                    }
                                                >
                                                    {activatedTheme !==
                                                    currentTheme.name
                                                        ? 'Включить'
                                                        : themeActive
                                                          ? 'Выключить'
                                                          : 'Включить'}
                                                </Button>
                                                <Button
                                                    className={
                                                        localStyles.miniButton
                                                    }
                                                    onClick={() =>
                                                        setContextMenuVisible(
                                                            prev => !prev,
                                                        )
                                                    }
                                                >
                                                    <MdMoreHoriz size={20} />
                                                </Button>
                                            </div>
                                            {contextMenuVisible && (
                                                <ViewModal
                                                    items={createContextMenuActions(
                                                        undefined,
                                                        themeActive,
                                                        {
                                                            showCheck: false,
                                                            showDirectory: true,
                                                            showExport: true,
                                                            showDelete: true,
                                                        },
                                                        currentTheme,
                                                    )}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className={localStyles.extensionNav}>
                                    <div
                                        className={
                                            localStyles.extensionNavContainer
                                        }
                                    >
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Overview'
                                                    ? localStyles.activeTabButton
                                                    : ''
                                            }`}
                                            onClick={() =>
                                                setActiveTab('Overview')
                                            }
                                        >
                                            <MdExplore /> Overview
                                        </button>
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Settings'
                                                    ? localStyles.activeTabButton
                                                    : ''
                                            }`}
                                            onClick={() =>
                                                setActiveTab('Settings')
                                            }
                                        >
                                            <MdSettings /> Settings
                                        </button>
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Metadata'
                                                    ? localStyles.activeTabButton
                                                    : ''
                                            }`}
                                            onClick={() =>
                                                setActiveTab('Metadata')
                                            }
                                        >
                                            <MdStickyNote2 /> Metadata
                                        </button>
                                    </div>
                                    <button
                                        className={
                                            localStyles.extensionNavButton
                                        }
                                        disabled
                                    >
                                        <MdStoreMallDirectory /> Store
                                    </button>
                                </div>

                                <div className={localStyles.extensionContent}>
                                    {editMode && activeTab === 'Settings' && (
                                        <div className={localStyles.howAlert}>
                                            Подробную информацию о том, как с
                                            этим работать, можно найти в нашем{' '}
                                            <a
                                                href="https://discord.gg/qy42uGTzRy"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                Discord канале
                                            </a>{' '}
                                            в разделе extension!
                                        </div>
                                    )}
                                    {renderActiveTabContent()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default ExtensionViewPage