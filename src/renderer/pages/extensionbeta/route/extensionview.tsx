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
} from 'react-icons/md'

import Layout from '../../../components/layout'
import Button from '../../../components/button'
import ViewModal from '../../../components/context_menu_themes/viewModal'
import AddonInterface from '../../../api/interfaces/addon.interface'
import { createContextMenuActions } from '../../../components/context_menu_themes/sectionConfig'
import ConfigurationSettings from '../../../components/сonfigurationSettings/ConfigurationSettings'
import { AddonConfig, Item, TextItem, ButtonAction, ButtonItem, ColorItem } from '../../../components/сonfigurationSettings/types'

import * as globalStyles from '../../../../../static/styles/page/index.module.scss'
import * as localStyles from './extensionview.module.scss'
import addonInitials from '../../../api/initials/addon.initials'
import { useUserProfileModal } from '../../../../renderer/context/UserProfileModalContext'

const ExtensionViewPage: React.FC = () => {
    const [activatedTheme, setActivatedTheme] = useState<string>(window.electron.store.get('addons.theme') || 'Default')

    const [enabledScripts, setEnabledScripts] = useState<string[]>(window.electron.store.get('addons.scripts') || [])

    const isFirstRender = useRef(true)
    const { openUserProfile } = useUserProfileModal()
    const [currentAddon, setCurrentAddon] = useState<AddonInterface | null>(null)
    const [contextMenuVisible, setContextMenuVisible] = useState(false)
    const [bannerImage, setBannerImage] = useState('static/assets/images/no_themeBackground.png')

    const [themeActive, setThemeActive] = useState(activatedTheme !== 'Default')
    const [bannerExpanded, setBannerExpanded] = useState(false)
    const [bannerHeight, setBannerHeight] = useState(84)
    const [activeTab, setActiveTab] = useState('Overview')
    const [configData, setConfigData] = useState<AddonConfig | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [markdownData, setMarkdownData] = useState<string>('')
    const [configFileExists, setConfigFileExists] = useState<boolean | null>(null)
    const [newSectionTitle, setNewSectionTitle] = useState('')
    const menuElementRef = useRef<HTMLDivElement>(null)
    const location = useLocation()
    const navigate = useNavigate()

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false
            return
        }
        window.electron.store.set('addons.scripts', enabledScripts)
        window.desktopEvents?.send('REFRESH_EXTENSIONS')
    }, [enabledScripts])

    useEffect(() => {
        window.electron.store.set('addons.theme', activatedTheme)
    }, [activatedTheme])

    useEffect(() => {
        const receivedAddon = location.state?.theme as AddonInterface

        if (receivedAddon) {
            setCurrentAddon(receivedAddon)
        } else {
            navigate('/extensionbeta', { replace: false })
        }
    }, [location.state, navigate])

    useEffect(() => {
        const clickOutsideHandler = (event: MouseEvent) => {
            if (menuElementRef.current && !menuElementRef.current.contains(event.target as Node)) {
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
        if (currentAddon) {
            const expandedStates = window.electron.store.get('addons.themeIsExpanded') || {}
            if (!expandedStates.hasOwnProperty(currentAddon.name)) {
                expandedStates[currentAddon.name] = false
                window.electron.store.set('addons.themeIsExpanded', expandedStates)
            }
            const initialExpanded = expandedStates[currentAddon.name]
            setBannerExpanded(initialExpanded)
            setBannerHeight(initialExpanded ? 277 : 84)
        }
    }, [currentAddon])

    const toggleBanner = () => {
        const newState = !bannerExpanded
        setBannerExpanded(newState)
        if (currentAddon) {
            const expandedStates = window.electron.store.get('addons.themeIsExpanded') || {}
            expandedStates[currentAddon.name] = newState
            window.electron.store.set('addons.themeIsExpanded', expandedStates)
        }
    }

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null
        const targetHeight = bannerExpanded ? 277 : 84
        const step = bannerExpanded ? -1 : 1

        const animateBannerHeight = () => {
            setBannerHeight(prev => {
                if ((step < 0 && prev <= targetHeight) || (step > 0 && prev >= targetHeight)) {
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

    const changeTag = (tag: string) => {
        navigate(`/extensionbeta?selectedTag=${encodeURIComponent(tag)}`, {
            replace: false,
        })
    }

    const handleToggleAddon = () => {
        if (!currentAddon) return

        if (currentAddon.type === 'theme' || !currentAddon.type) {
            if (activatedTheme === currentAddon.directoryName) {
                setActivatedTheme('Default')
                window.desktopEvents?.send('themeChanged', addonInitials[0])
                setThemeActive(false)
            } else {
                setActivatedTheme(currentAddon.directoryName)
                window.desktopEvents?.send('themeChanged', addonInitials[0])
                window.desktopEvents?.send('themeChanged', currentAddon)
                setThemeActive(true)
            }
        } else {
            const isScriptEnabled = enabledScripts.includes(currentAddon.directoryName)
            if (isScriptEnabled) {
                setEnabledScripts(prev => prev.filter(item => item !== currentAddon.directoryName))
            } else {
                setEnabledScripts(prev => [...prev, currentAddon.directoryName])
            }
        }
    }

    const getToggleButtonText = () => {
        if (!currentAddon) return ''
        if (currentAddon.type === 'theme') {
            return activatedTheme === currentAddon.directoryName ? 'Выключить' : 'Включить'
        } else {
            return enabledScripts.includes(currentAddon.directoryName) ? 'Выключить' : 'Включить'
        }
    }

    const getToggleTitle = () => {
        if (!currentAddon) return ''
        if (currentAddon.type === 'theme') {
            const isActive = activatedTheme === currentAddon.directoryName
            return isActive ? 'Выключить тему' : 'Включить тему'
        } else {
            const isActive = enabledScripts.includes(currentAddon.directoryName)
            return isActive ? 'Выключить скрипт' : 'Включить скрипт'
        }
    }

    const getEncodedPath = (p: string) => {
        return encodeURI(p.replace(/\\/g, '/'))
    }
    useEffect(() => {
        if (currentAddon?.path && currentAddon.banner) {
            const bannerPath = getEncodedPath(`${currentAddon.path}/${currentAddon.banner}`)
            fetch(bannerPath)
                .then(res => {
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
    }, [currentAddon])

    useEffect(() => {
        if (currentAddon) {
            const readmePath = `${currentAddon.path}/README.md`
            fetch(readmePath)
                .then(response => response.text())
                .then(data => {
                    setMarkdownData(data)
                })
                .catch(() => {
                    console.error('Ошибка при загрузке README.md:')
                })
        }
    }, [currentAddon])

    useEffect(() => {
        const checkConfigFile = async () => {
            if (currentAddon) {
                const configPath = path.join(currentAddon.path, 'handleEvents.json')
                const exists = await window.desktopEvents?.invoke('file-event', 'check-file-exists', configPath)
                setConfigFileExists(exists)

                if (exists) {
                    const configContent = await window.desktopEvents?.invoke('file-event', 'read-file', configPath)
                    try {
                        const parsedConfig: AddonConfig = JSON.parse(configContent)
                        const upgradedConfig = upgradeConfig(parsedConfig)
                        setConfigData(upgradedConfig)
                    } catch (error) {
                        console.error('Ошибка при парсинге handleEvents.json:', error)
                        setConfigData(null)
                    }
                }
            }
        }
        if (currentAddon) {
            checkConfigFile()
        }
    }, [currentAddon])

    const upgradeConfig = (config: AddonConfig): AddonConfig => {
        const upgradedConfig = structuredClone(config)
        upgradedConfig.sections.forEach(section => {
            section.items.forEach(item => {
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
                        textItem.buttons.forEach(button => {
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
        if (currentAddon) {
            const configPath = path.join(currentAddon.path, 'handleEvents.json')
            const defaultContent: AddonConfig = {
                sections: [
                    {
                        title: 'Действия',
                        items: [
                            {
                                id: 'showHints',
                                name: 'Показать подсказки',
                                description: 'Включает отображение подсказок при наведении курсора',
                                type: 'button',
                                bool: false,
                                defaultParameter: false,
                            },
                            {
                                id: 'darkMode',
                                name: 'Режим темной темы',
                                description: 'Активирует тёмный режим для комфортной работы при слабом освещении',
                                type: 'button',
                                bool: false,
                                defaultParameter: false,
                            },
                            {
                                id: 'enableNotifications',
                                name: 'Уведомления',
                                description: 'Включает показ всплывающих уведомлений о новых событиях',
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
                                description: 'Текст, отображаемый при запуске приложения',
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

            const result = await window.desktopEvents?.invoke('file-event', 'create-config-file', configPath, defaultContent)

            if (result.success) {
                setConfigData(defaultContent)
                setConfigFileExists(true)
            } else {
                console.error('Ошибка при создании файла конфигурации:', result.error)
            }
        }
    }

    const writeConfigFile = async (updatedConfig: AddonConfig) => {
        if (currentAddon) {
            const configPath = path.join(currentAddon.path, 'handleEvents.json')
            try {
                await window.desktopEvents?.invoke('file-event', 'write-file', configPath, JSON.stringify(updatedConfig, null, 2))
            } catch (error) {
                console.error('Ошибка при сохранении конфигурации:', error)
                alert('Произошла ошибка при сохранении конфигурации.')
            }
        }
    }

    function isTextItem(item: Item): item is TextItem {
        return item.type === 'text'
    }

    const setNestedValue = (obj: any, pathStr: string, value: any) => {
        const keys = pathStr.replace(/\[(\d+)\]/g, '.$1').split('.')
        let current = obj
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i]
            const nextKey = keys[i + 1]
            const index = Number(key)
            if (Array.isArray(current)) {
                if (isNaN(index)) return
                if (!current[index]) {
                    current[index] = isNaN(Number(nextKey)) ? {} : []
                }
                current = current[index]
            } else {
                if (!(key in current) || current[key] === null) {
                    current[key] = isNaN(Number(nextKey)) ? {} : []
                }
                current = current[key]
            }
        }
        const lastKey = keys[keys.length - 1]
        if (Array.isArray(current)) {
            const idx = Number(lastKey)
            if (isNaN(idx)) return
            current[idx] = value
        } else {
            current[lastKey] = value
        }
    }

    const updateConfigField = (sectionIndex: number, itemIndex: number | null, key: string, value: any) => {
        if (!configData) return
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

    const updateButtonConfig = (sectionIndex: number, itemIndex: number, buttonIndex: number, key: keyof ButtonAction, newValue: string) => {
        if (!configData) return
        const updatedConfig = structuredClone(configData)
        const item = updatedConfig.sections[sectionIndex].items[itemIndex]
        if (isTextItem(item) && item.buttons[buttonIndex]) {
            const button = item.buttons[buttonIndex]
            button[key] = newValue
            setConfigData(updatedConfig)
            writeConfigFile(updatedConfig)
        }
    }

    const resetConfigField = (sectionIndex: number, itemIndex: number) => {
        if (!configData) return
        const updatedConfig = structuredClone(configData)
        const item = updatedConfig.sections[sectionIndex].items[itemIndex]

        switch (item.type) {
            case 'button':
                item.bool = item.defaultParameter
                break

            case 'color':
                item.input = item.defaultParameter
                break

            case 'text': {
                const textItem = item as TextItem
                textItem.buttons = textItem.buttons.map(btn => ({
                    ...btn,
                    text: btn.defaultParameter ?? btn.text,
                }))
                break
            }

            case 'slider':
                item.value = item.defaultParameter ?? 0
                break

            case 'file':
                item.filePath = item.defaultParameter?.filePath ?? ''
                break
        }

        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
    }

    const resetButtonConfig = (sectionIndex: number, itemIndex: number, buttonIndex: number) => {
        if (!configData) return
        const updatedConfig = structuredClone(configData)
        const item = updatedConfig.sections[sectionIndex].items[itemIndex]
        if (isTextItem(item)) {
            const button = item.buttons[buttonIndex]
            if (button) {
                button.text = button.defaultParameter || button.text
                setConfigData(updatedConfig)
                writeConfigFile(updatedConfig)
            }
        }
    }

    const addSection = () => {
        if (!newSectionTitle.trim()) return
        if (!configData) return
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
        if (!configData) return
        const updatedConfig = structuredClone(configData)
        updatedConfig.sections.splice(sectionIndex, 1)
        setConfigData(updatedConfig)
        writeConfigFile(updatedConfig)
    }

    const addItem = (sectionIndex: number, itemType: string) => {
        if (!configData) return
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
            case 'slider':
                newItem = {
                    id: `new_${Date.now()}`,
                    name: 'Новый слайдер',
                    description: '',
                    type: 'slider',
                    min: 0,
                    max: 100,
                    step: 1,
                    value: 50,
                    defaultParameter: 50,
                }
                break
            case 'file':
                newItem = {
                    id: `new_${Date.now()}`,
                    name: 'Новый файл',
                    description: '',
                    type: 'file',
                    filePath: '',
                    defaultParameter: {
                        filePath: '',
                    },
                }
                break
            case 'selector':
                newItem = {
                    id: `new_${Date.now()}`,
                    name: 'Новый селектор',
                    description: '',
                    type: 'selector',
                    selected: 1,
                    options: {
                        '1': {
                            event: 'center',
                            name: 'По центру',
                        },
                        '2': {
                            event: 'left',
                            name: 'Слева',
                        },
                        '3': {
                            event: 'right',
                            name: 'Справа',
                        },
                    },
                    defaultParameter: 1,
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
        if (!configData) return
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

    const renderActiveTabContent = () => {
        if (!currentAddon) return null
        switch (activeTab) {
            case 'Overview':
                return (
                    <div className={localStyles.galleryContainer}>
                        <div className={localStyles.markdownContent}>
                            <div className={localStyles.markdownText}>
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]} components={{ a: MarkdownLink }}>
                                    {markdownData || currentAddon.description}
                                </ReactMarkdown>
                            </div>
                        </div>
                    </div>
                )
            case 'Settings':
                if (configFileExists === false) {
                    return (
                        <div className={localStyles.alertContent}>
                            <div>Создать базовый handleEvents.json</div>
                            <button className={localStyles.settingsAlertButton} onClick={createDefaultConfig} title="Создать файл конфигурации">
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
                return <div className={localStyles.alertContent}>Страница "метаданные темы" в разработке</div>
            default:
                return null
        }
    }

    if (!currentAddon) return null

    return (
        <Layout title="Стилизация">
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        <div className={globalStyles.container0x0}>
                            {activeTab === 'Settings' && configFileExists === true && (
                                <button
                                    className={`${localStyles.edit} ${editMode ? localStyles.activeEdit : ''}`}
                                    onClick={() => setEditMode(prev => !prev)}
                                    title={editMode ? 'Выйти из режима редактирования' : 'Войти в режим редактирования'}
                                >
                                    <MdEdit />
                                </button>
                            )}
                            <div className={localStyles.containerFix}>
                                <div
                                    className={localStyles.bannerBackground}
                                    style={{
                                        transition: 'opacity 0.5s ease, height 0.5s ease, gap 0.5s ease',
                                        opacity: '1',
                                        backgroundImage: `url(${bannerImage})`,
                                        backgroundSize: 'cover',
                                        height: `${bannerHeight}px`,
                                    }}
                                >
                                    <Button
                                        className={localStyles.hideButton}
                                        onClick={() => {
                                            setBannerExpanded(prev => !prev)
                                            toggleBanner()
                                        }}
                                        title={bannerExpanded ? 'Свернуть баннер' : 'Развернуть баннер'}
                                    >
                                        <MdKeyboardArrowDown
                                            size={20}
                                            style={
                                                bannerExpanded
                                                    ? {
                                                          transition: 'transform 0.3s ease',
                                                          transform: 'rotate(180deg)',
                                                      }
                                                    : {
                                                          transition: 'transform 0.3s ease',
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
                                                src={`${currentAddon.path}/${currentAddon.image}`}
                                                alt={`${currentAddon.name} image`}
                                                width="100"
                                                height="100"
                                                onError={e => {
                                                    ;(e.target as HTMLImageElement).src = 'static/assets/images/no_themeImage.png'
                                                }}
                                            />
                                            <div className={localStyles.themeTitle}>
                                                <div className={localStyles.titleContainer}>
                                                    <NavLink className={localStyles.path} to="/extensionbeta" title="Перейти в Extension">
                                                        Extension
                                                    </NavLink>
                                                    /<div className={localStyles.title}>{currentAddon.name || 'Название недоступно'}</div>
                                                    <Button className={localStyles.addFavorite} disabled title="Добавить в избранное (недоступно)">
                                                        <MdBookmarkBorder size={20} />
                                                    </Button>
                                                </div>
                                                <div className={localStyles.authorInfo}>
                                                    {currentAddon.author && (
                                                        <div>
                                                            {Array.isArray(currentAddon.author) ? (
                                                                currentAddon.author.map((userName: string, index: number) => (
                                                                    <span
                                                                        key={userName}
                                                                        onClick={() => openUserProfile(userName)}
                                                                        style={{
                                                                            cursor: 'pointer',
                                                                        }}
                                                                    >
                                                                        {userName}
                                                                        {index < currentAddon.author.length - 1 && ', '}
                                                                    </span>
                                                                ))
                                                            ) : (
                                                                <span
                                                                    onClick={() => openUserProfile(currentAddon.author as string)}
                                                                    style={{
                                                                        cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    {currentAddon.author}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}{' '}
                                                    - {currentAddon.lastModified && <div>Last update: {currentAddon.lastModified}</div>}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className={localStyles.rightContainer}>
                                        <div className={localStyles.detailsContainer}>
                                            <div className={localStyles.detailInfo}>
                                                {currentAddon.version && (
                                                    <div className={localStyles.box}>
                                                        <MdDesignServices /> {currentAddon.version}
                                                    </div>
                                                )}
                                                {currentAddon.size !== undefined && (
                                                    <div className={localStyles.box}>
                                                        <MdFolder /> {currentAddon.size}
                                                    </div>
                                                )}
                                            </div>
                                            <div className={localStyles.detailInfo}>
                                                {Array.isArray(currentAddon.tags) &&
                                                    currentAddon.tags.length > 0 &&
                                                    currentAddon.tags.map(tag => (
                                                        <Button
                                                            key={tag}
                                                            className={localStyles.tag}
                                                            onClick={() => changeTag(tag)}
                                                            title={`Фильтровать по тегу ${tag}`}
                                                        >
                                                            {tag}
                                                        </Button>
                                                    ))}
                                            </div>
                                        </div>

                                        <div ref={menuElementRef}>
                                            <div className={localStyles.miniButtonsContainer}>
                                                <Button
                                                    className={`${localStyles.defaultButton} ${
                                                        (currentAddon.type === 'theme' && activatedTheme === currentAddon.directoryName) ||
                                                        (currentAddon.type === 'script' && enabledScripts.includes(currentAddon.directoryName))
                                                            ? localStyles.defaultButtonActive
                                                            : ''
                                                    }`}
                                                    disabled={!currentAddon.type || (currentAddon.type !== 'theme' && currentAddon.type !== 'script')}
                                                    onClick={handleToggleAddon}
                                                    title={getToggleTitle()}
                                                >
                                                    {getToggleButtonText()}
                                                </Button>
                                                <Button
                                                    className={localStyles.miniButton}
                                                    onClick={() => setContextMenuVisible(prev => !prev)}
                                                    title="Дополнительные настройки"
                                                >
                                                    <MdMoreHoriz size={20} />
                                                </Button>
                                            </div>
                                            {contextMenuVisible && currentAddon && (
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
                                                        currentAddon,
                                                    )}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className={localStyles.extensionNav}>
                                    <div className={localStyles.extensionNavContainer}>
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Overview' ? localStyles.activeTabButton : ''
                                            }`}
                                            onClick={() => setActiveTab('Overview')}
                                            title="Обзор"
                                        >
                                            <MdExplore /> Overview
                                        </button>
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Settings' ? localStyles.activeTabButton : ''
                                            }`}
                                            onClick={() => setActiveTab('Settings')}
                                            title="Настройки"
                                        >
                                            <MdSettings /> Settings
                                        </button>
                                        <button
                                            className={`${localStyles.extensionNavButton} ${
                                                activeTab === 'Metadata' ? localStyles.activeTabButton : ''
                                            }`}
                                            onClick={() => setActiveTab('Metadata')}
                                            title="Метаданные"
                                        >
                                            <MdStickyNote2 /> Metadata
                                        </button>
                                    </div>
                                    <button className={localStyles.extensionNavButton} disabled title="Store (недоступно)">
                                        <MdStoreMallDirectory /> Store
                                    </button>
                                </div>

                                <div className={localStyles.extensionContent}>
                                    {editMode && activeTab === 'Settings' && (
                                        <div className={localStyles.howAlert}>
                                            Подробную информацию о том, как с этим работать, можно найти в&nbsp;
                                            <a href="https://discord.gg/qy42uGTzRy" target="_blank" rel="noopener noreferrer">
                                                нашем Discord
                                            </a>
                                            !
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
