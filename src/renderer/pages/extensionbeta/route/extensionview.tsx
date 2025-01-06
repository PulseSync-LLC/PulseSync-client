import path from 'path'
import React, { useEffect, useRef, useState } from 'react'
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
    MdAdd,
    MdDelete,
    MdRestore,
} from 'react-icons/md'

import Layout from '../../../components/layout'
import Button from '../../../components/button'
import ViewModal from '../../../components/context_menu_themes/viewModal'
import ThemeInterface from '../../../api/interfaces/theme.interface'
import { createContextMenuActions } from '../../../components/context_menu_themes/sectionConfig'
import ConfigurationSettings from '../../../components/сonfigurationSettings/ConfigurationSettings'
import {
    ThemeConfig,
    Item,
    TextItem,
    ButtonAction,
    ButtonItem,
    ColorItem,
} from '../../../components/сonfigurationSettings/types'

import * as globalStyles from '../../../../../static/styles/page/index.module.scss'
import * as localStyles from './extensionview.module.scss'

const ExtensionViewPage: React.FC = () => {
    const [contextMenuVisible, setContextMenuVisible] = useState(false)
    const [currentTheme, setCurrentTheme] = useState<ThemeInterface | null>(null)
    const [bannerImage, setBannerImage] = useState(
        'static/assets/images/no_themeBackground.png',
    )
    const [activatedTheme, setActivatedTheme] = useState(
        window.electron.store.get('theme') || 'Default',
    )
    const [themeActive, setThemeActive] = useState(activatedTheme !== 'Default')
    const [bannerExpanded, setBannerExpanded] = useState(false)
    const [bannerHeight, setBannerHeight] = useState(84)
    const [activeTab, setActiveTab] = useState('Overview')
    const [configData, setConfigData] = useState<ThemeConfig | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [markdownData, setMarkdownData] = useState<string>('')
    const [configFileExists, setConfigFileExists] = useState<boolean | null>(null)
    const [newSectionTitle, setNewSectionTitle] = useState('')

    const menuElementRef = useRef<HTMLDivElement>(null)
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
        const clickOutsideHandler = (event: MouseEvent) => {
            if (
                menuElementRef.current &&
                !menuElementRef.current.contains(event.target as Node)
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
                window.electron.store.set('themes.themeIsExpanded', expandedStates)
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
        const newTheme = themeActive ? 'Default' : currentTheme?.name || 'Default'
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
            setBannerHeight((prev) => {
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
        window.desktopEvents.send('themeChanged', 'Default')
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
                .then((res) => {
                    if (res.ok) {
                        setBannerImage(bannerPath)
                    } else {
                        setBannerImage('static/assets/images/no_themeBackground.png')
                    }
                })
                .catch(() => {
                    setBannerImage('static/assets/images/no_themeBackground.png')
                })
        }
    }, [currentTheme])

    useEffect(() => {
        if (currentTheme) {
            const readmePath = `${currentTheme.path}/README.md`
            fetch(readmePath)
                .then((response) => response.text())
                .then((data) => {
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
                const configPath = path.join(currentTheme.path, 'handleEvents.json')
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
                    try {
                        const parsedConfig: ThemeConfig = JSON.parse(configContent)
                        const upgradedConfig = upgradeConfig(parsedConfig)
                        setConfigData(upgradedConfig)
                    } catch (error) {
                        console.error(
                            'Ошибка при парсинге handleEvents.json:',
                            error,
                        )
                        setConfigData(null)
                    }
                }
            }
        }

        if (currentTheme) {
            checkConfigFile()
        }
    }, [currentTheme])

    const upgradeConfig = (config: ThemeConfig): ThemeConfig => {
        const upgradedConfig = structuredClone(config)

        upgradedConfig.sections.forEach((section) => {
            section.items.forEach((item) => {
                switch (item.type) {
                    case 'button':
                        const buttonItem = item as ButtonItem
                        if (buttonItem.defaultParameter === undefined) {
                            buttonItem.defaultParameter = buttonItem.bool
                        }
                        break
                    case 'color':
                        const colorItem = item as ColorItem
                        if (colorItem.defaultParameter === undefined) {
                            colorItem.defaultParameter = colorItem.input
                        }
                        break
                    case 'text':
                        const textItem = item as TextItem
                        textItem.buttons.forEach((button) => {
                            if (button.defaultParameter === undefined) {
                                button.defaultParameter = button.text
                            }
                        })
                        break
                    default:
                        break
                }
            })
        })

        return upgradedConfig
    }

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
                                defaultParameter: false,
                            },
                            {
                                id: 'darkMode',
                                name: 'Режим темной темы',
                                description:
                                    'Активирует тёмный режим для комфортной работы при слабом освещении',
                                type: 'button',
                                bool: false,
                                defaultParameter: false,
                            },
                            {
                                id: 'enableNotifications',
                                name: 'Уведомления',
                                description:
                                    'Включает показ всплывающих уведомлений о новых событиях',
                                type: 'button',
                                bool: false,
                                defaultParameter: false,
                            },
                        ],
                    },
                    {
                        title: 'Цветовая схема',
                        items: [
                            {
                                id: 'mainBackground',
                                name: 'Основной фон',
                                description: 'Цвет фона главного окна приложения',
                                type: 'color',
                                input: '#3498db',
                                defaultParameter: '#3498db',
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
                                        id: `btn_${Date.now()}_1`,
                                        name: 'text',
                                        text: 'Добро пожаловать!',
                                        defaultParameter: 'Добро пожаловать!',
                                    },
                                    {
                                        id: `btn_${Date.now()}_2`,
                                        name: 'position',
                                        text: 'center',
                                        defaultParameter: 'center',
                                    },
                                    {
                                        id: `btn_${Date.now()}_3`,
                                        name: 'size',
                                        text: '81px',
                                        defaultParameter: '81px',
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
                    JSON.stringify(updatedConfig, null, 2),
                )
            } catch (error) {
                console.error('Ошибка при сохранении конфигурации:', error)
                alert('Произошла ошибка при сохранении конфигурации.')
            }
        }
    }

    const setNestedValue = (obj: any, path: string, value: any) => {
        console.log(`Setting path: ${path} to value: ${value}`)
        const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.')
        let current = obj
        for (let i = 0; i < keys.length - 1; i++) {
            let key = keys[i]
            let nextKey = keys[i + 1]
            let index = Number(key)

            if (Array.isArray(current)) {
                if (isNaN(index)) {
                    console.error(
                        `Ожидался числовой индекс массива, но получил: ${key}`,
                    )
                    return
                }
                if (!current[index]) {
                    current[index] = isNaN(Number(nextKey)) ? {} : []
                    console.log(
                        `Initialized array index ${index} as ${isNaN(Number(nextKey)) ? '{}' : '[]'}`,
                    )
                }
                current = current[index]
            } else {
                if (!(key in current) || current[key] === null) {
                    current[key] = isNaN(Number(nextKey)) ? {} : []
                    console.log(
                        `Initialized key '${key}' as ${isNaN(Number(nextKey)) ? '{}' : '[]'}`,
                    )
                }
                current = current[key]
            }
        }
        const lastKey = keys[keys.length - 1]
        if (Array.isArray(current)) {
            const index = Number(lastKey)
            if (isNaN(index)) {
                console.error(
                    `Ожидался числовой индекс массива, но получил: ${lastKey}`,
                )
                return
            }
            if (!current[index]) {
                current[index] = {}
                console.log(`Initialized array index ${index} as {}`)
            }
            current[index] = value
            console.log(`Set array[${index}].${lastKey} = ${value}`)
        } else {
            current[lastKey] = value
            console.log(`Set ${lastKey} = ${value}`)
        }
    }

    const updateConfigField = (
        sectionIndex: number,
        itemIndex: number | null,
        key: string,
        value: any,
    ) => {
        if (!configData) return

        console.log(
            `Updating field: section ${sectionIndex}, item ${itemIndex}, key '${key}' to value: '${value}'`,
        )

        const updatedConfig = structuredClone(configData)

        if (itemIndex !== null) {
            const item = updatedConfig.sections[sectionIndex].items[itemIndex]
            setNestedValue(item, key, value)
        } else {
            setNestedValue(updatedConfig.sections[sectionIndex], key, value)
        }

        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
    }

    const updateButtonConfig = (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
        key: keyof ButtonAction,
        newValue: string,
    ) => {
        if (!configData) return
        const updatedConfig = structuredClone(configData)

        const item = updatedConfig.sections[sectionIndex].items[itemIndex]
        if (isTextItem(item) && item.buttons[buttonIndex]) {
            const button = item.buttons[buttonIndex]
            button[key] = newValue
            // НИЗАЧТО НЕ ИЗМЕНЯЕМ defaultParameter ЗДЕСЬ
            setConfigData(updatedConfig)
            writeConfigFile(updatedConfig)
        }
    }

    const resetConfigField = (sectionIndex: number, itemIndex: number) => {
        if (!configData) return
        const updatedConfig = structuredClone(configData)
        const item = updatedConfig.sections[sectionIndex].items[itemIndex]
        if (item.type === 'button') {
            item.bool = item.defaultParameter
        } else if (item.type === 'color') {
            item.input = item.defaultParameter
        } else if (item.type === 'text') {
            const textItem = item as TextItem
            textItem.buttons = textItem.buttons.map((btn) => ({
                ...btn,
                text: btn.defaultParameter || btn.text,
            }))
        }
        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
    }

    const resetButtonConfig = (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
    ) => {
        if (!configData) return
        const updatedConfig = structuredClone(configData)
        const item = updatedConfig.sections[sectionIndex].items[itemIndex]
        if (isTextItem(item)) {
            const button = item.buttons[buttonIndex]
            if (button) {
                button.text = button.defaultParameter || button.text
                setConfigData(updatedConfig)
                writeConfigFile(updatedConfig)
            } else {
                console.error(`Кнопка с индексом ${buttonIndex} отсутствует.`)
            }
        }
    }

    const addSection = () => {
        if (!newSectionTitle.trim()) return
        const updatedConfig = structuredClone(configData)
        updatedConfig.sections.push({
            title: newSectionTitle.trim(),
            items: [],
        })
        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
        setNewSectionTitle('')
    }

    const removeSection = (sectionIndex: number) => {
        const updatedConfig = structuredClone(configData)
        updatedConfig.sections.splice(sectionIndex, 1)
        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
    }

    const addItem = (sectionIndex: number, itemType: string) => {
        let newItem: Item

        switch (itemType) {
            case 'button':
                newItem = {
                    id: `new_${Date.now()}`,
                    name: 'Новый элемент',
                    description: '',
                    type: 'button',
                    bool: false,
                    defaultParameter: false,
                }
                break
            case 'color':
                newItem = {
                    id: `new_${Date.now()}`,
                    name: 'Новый цвет',
                    description: '',
                    type: 'color',
                    input: '#ffffff',
                    defaultParameter: '#ffffff',
                }
                break
            case 'text':
                newItem = {
                    id: `new_${Date.now()}`,
                    name: 'Новый текст',
                    description: '',
                    type: 'text',
                    buttons: [
                        {
                            id: `btn_${Date.now()}_1`,
                            name: 'text',
                            text: 'Текст',
                            defaultParameter: 'Текст',
                        },
                        {
                            id: `btn_${Date.now()}_2`,
                            name: 'position',
                            text: 'center',
                            defaultParameter: 'center',
                        },
                        {
                            id: `btn_${Date.now()}_3`,
                            name: 'size',
                            text: '16px',
                            defaultParameter: '16px',
                        },
                    ],
                }
                break
            default:
                return
        }

        const updatedConfig = structuredClone(configData)
        updatedConfig.sections[sectionIndex].items.push(newItem)
        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
    }

    const removeItem = (sectionIndex: number, itemIndex: number) => {
        const updatedConfig = structuredClone(configData)
        updatedConfig.sections[sectionIndex].items.splice(itemIndex, 1)
        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
    }

    function MarkdownLink(props: any) {
        return (
            <a href={props.href} target="_blank" rel="noreferrer">
                {props.children}
            </a>
        )
    }

    function isTextItem(item: Item): item is TextItem {
        return item.type === 'text'
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
                            <div>Создать базовый handleEvents.json</div>
                            <button
                                className={localStyles.settingsAlertButton}
                                onClick={createDefaultConfig}
                                title="Создать файл конфигурации"
                            >
                                Создать файл
                            </button>
                        </div>
                    )
                }

                return configData ? (
                    <ConfigurationSettings
                        configData={configData}
                        editMode={editMode}
                        updateConfigField={updateConfigField}
                        updateButtonConfig={updateButtonConfig}
                        resetConfigField={resetConfigField}
                        resetButtonConfig={resetButtonConfig}
                        addSection={addSection}
                        removeSection={removeSection}
                        addItem={addItem}
                        removeItem={removeItem}
                        newSectionTitle={newSectionTitle}
                        setNewSectionTitle={setNewSectionTitle}
                    />
                ) : null
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
                                        className={`${localStyles.edit} ${
                                            editMode ? localStyles.activeEdit : ''
                                        }`}
                                        onClick={() => setEditMode((prev) => !prev)}
                                        title={
                                            editMode
                                                ? 'Выйти из режима редактирования'
                                                : 'Войти в режим редактирования'
                                        }
                                    >
                                        <MdEdit />
                                    </button>
                                )}
                            <div className={localStyles.containerFix}>
                                <div
                                    className={localStyles.bannerBackground}
                                    style={{
                                        transition: true
                                            ? 'opacity 0.5s ease, height 0.5s ease, gap 0.5s ease'
                                            : 'none',
                                        opacity: '1',
                                        backgroundImage: `url(${bannerImage})`,
                                        backgroundSize: 'cover',
                                        height: `${bannerHeight}px`,
                                    }}
                                >
                                    <Button
                                        className={localStyles.hideButton}
                                        onClick={() => {
                                            setBannerExpanded((prev) => !prev)
                                            toggleBanner()
                                        }}
                                        title={
                                            bannerExpanded
                                                ? 'Свернуть баннер'
                                                : 'Развернуть баннер'
                                        }
                                    >
                                        <MdKeyboardArrowDown
                                            size={20}
                                            style={
                                                bannerExpanded
                                                    ? {
                                                          transition:
                                                              'transform 0.3s ease',
                                                          transform:
                                                              'rotate(180deg)',
                                                      }
                                                    : {
                                                          transition:
                                                              'transform 0.3s ease',
                                                          transform: 'rotate(0deg)',
                                                      }
                                            }
                                        />
                                    </Button>
                                </div>

                                <div className={localStyles.themeInfo}>
                                    <div className={localStyles.themeHeader}>
                                        <div className={localStyles.containerLeft}>
                                            <img
                                                className={localStyles.themeImage}
                                                src={`${currentTheme.path}/${currentTheme.image}`}
                                                alt={`${currentTheme.name} image`}
                                                width="100"
                                                height="100"
                                                onError={(e) => {
                                                    ;(
                                                        e.target as HTMLImageElement
                                                    ).src =
                                                        'static/assets/images/no_themeImage.png'
                                                }}
                                            />
                                            <div className={localStyles.themeTitle}>
                                                <div
                                                    className={
                                                        localStyles.titleContainer
                                                    }
                                                >
                                                    <NavLink
                                                        className={localStyles.path}
                                                        to="/extensionbeta"
                                                        title="Перейти в Extension"
                                                    >
                                                        Extension
                                                    </NavLink>
                                                    /
                                                    <div
                                                        className={localStyles.title}
                                                    >
                                                        {currentTheme.name ||
                                                            'Название недоступно'}
                                                    </div>
                                                    <Button
                                                        className={
                                                            localStyles.addFavorite
                                                        }
                                                        disabled
                                                        title="Добавить в избранное (недоступно)"
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
                                                            {currentTheme.author}
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
                                            className={localStyles.detailsContainer}
                                        >
                                            <div className={localStyles.detailInfo}>
                                                {currentTheme.version && (
                                                    <div className={localStyles.box}>
                                                        <MdDesignServices />{' '}
                                                        {currentTheme.version}
                                                    </div>
                                                )}
                                                {currentTheme.size !== undefined && (
                                                    <div className={localStyles.box}>
                                                        <MdFolder />{' '}
                                                        {currentTheme.size}
                                                    </div>
                                                )}
                                            </div>
                                            <div className={localStyles.detailInfo}>
                                                {Array.isArray(currentTheme.tags) &&
                                                    currentTheme.tags.length > 0 &&
                                                    currentTheme.tags.map((tag) => (
                                                        <Button
                                                            key={tag}
                                                            className={
                                                                localStyles.tag
                                                            }
                                                            onClick={() =>
                                                                changeTag(tag)
                                                            }
                                                            title={`Фильтровать по тегу ${tag}`}
                                                        >
                                                            {tag}
                                                        </Button>
                                                    ))}
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
                                                    title={
                                                        activatedTheme !==
                                                        currentTheme.name
                                                            ? 'Включить тему'
                                                            : themeActive
                                                              ? 'Выключить тему'
                                                              : 'Включить тему'
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
                                                            (prev) => !prev,
                                                        )
                                                    }
                                                    title="Дополнительные настройки"
                                                >
                                                    <MdMoreHoriz size={20} />
                                                </Button>
                                            </div>
                                            {contextMenuVisible && currentTheme && (
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
                                        className={localStyles.extensionNavContainer}
                                    >
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Overview'
                                                    ? localStyles.activeTabButton
                                                    : ''
                                            }`}
                                            onClick={() => setActiveTab('Overview')}
                                            title="Обзор"
                                        >
                                            <MdExplore /> Overview
                                        </button>
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Settings'
                                                    ? localStyles.activeTabButton
                                                    : ''
                                            }`}
                                            onClick={() => setActiveTab('Settings')}
                                            title="Настройки"
                                        >
                                            <MdSettings /> Settings
                                        </button>
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Metadata'
                                                    ? localStyles.activeTabButton
                                                    : ''
                                            }`}
                                            onClick={() => setActiveTab('Metadata')}
                                            title="Метаданные"
                                        >
                                            <MdStickyNote2 /> Metadata
                                        </button>
                                    </div>
                                    <button
                                        className={localStyles.extensionNavButton}
                                        disabled
                                        title="Store (недоступно)"
                                    >
                                        <MdStoreMallDirectory /> Store
                                    </button>
                                </div>

                                <div className={localStyles.extensionContent}>
                                    {editMode && activeTab === 'Settings' && (
                                        <div className={localStyles.howAlert}>
                                            Подробную информацию о том, как с этим
                                            работать, можно найти в нашем{' '}
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
