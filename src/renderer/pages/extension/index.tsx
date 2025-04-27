import React, { useContext, useEffect, useRef, useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import Layout from '../../components/layout'
import * as styles from '../../../../static/styles/page/index.module.scss'
import * as extensionStylesV2 from './extension.module.scss'
import AddonInterface from '../../api/interfaces/addon.interface'
import toast from '../../components/toast'
import userContext from '../../api/context/user.context'
import ArrowRefreshImg from './../../../../static/assets/stratis-icons/arrowRefresh.svg'
import FileAddImg from './../../../../static/assets/stratis-icons/file-add.svg'
import FileImg from './../../../../static/assets/stratis-icons/file.svg'
import ContainerV2 from '../../components/containerV2'
import { ExtensionView } from './route/extensionview'
import { MdCheckCircle, MdColorLens, MdTextSnippet } from 'react-icons/md'

function checkMissingFields(addon: AddonInterface): string[] {
    const missing: string[] = []
    if (!addon.name) missing.push('name')
    if (!addon.author) missing.push('author')
    if (!addon.version) missing.push('version')
    if (!addon.image) missing.push('image')
    if (!addon.banner) missing.push('banner')
    if (!addon.type) missing.push('type')
    return missing
}

export default function ExtensionPage() {
    const { addons, setAddons } = useContext(userContext)
    const [currentTheme, setCurrentTheme] = useState(window.electron.store.get('addons.theme') || 'Default')
    const [enabledScripts, setEnabledScripts] = useState<string[]>(window.electron.store.get('addons.scripts') || [])
    const [searchQuery, setSearchQuery] = useState('')
    const [hideEnabled, setHideEnabled] = useState(window.electron.store.get('addons.hideEnabled') || false)
    const [selectedAddon, setSelectedAddon] = useState<AddonInterface | null>(null)
    const [isListFullyLoaded, setIsListFullyLoaded] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set(window.electron.store.get('addons.selectedTags') || []))
    const [searchParams] = useSearchParams()
    const selectedTagFromURL = searchParams.get('selectedTag')
    const [displayedCount, setDisplayedCount] = useState(0)

    const loadAddons = () => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents
                .invoke('getAddons')
                .then((fetchedAddons: AddonInterface[]) => {
                    setAddons(fetchedAddons)
                })
                .catch(error => console.error('Ошибка при загрузке аддонов:', error))
        }
    }

    useEffect(() => {
        if (selectedTagFromURL) {
            setSelectedTags(prev => {
                const copy = new Set(prev)
                copy.add(selectedTagFromURL)
                return copy
            })
        }
    }, [selectedTagFromURL])

    useEffect(() => {
        loadAddons()
    }, [])

    useEffect(() => {
        window.electron.store.set('addons.scripts', enabledScripts)
    }, [enabledScripts])

    useEffect(() => {
        window.electron.store.set('addons.theme', currentTheme)
    }, [currentTheme])

    const handleCheckboxChange = (addon: AddonInterface, newChecked: boolean) => {
        if (addon.type === 'theme') {
            if (newChecked) {
                setCurrentTheme(addon.directoryName)
                window.desktopEvents?.send('themeChanged', addon)
                toast.custom('success', 'Тема активирована', `${addon.name} теперь активна`)
            } else {
                setCurrentTheme('Default')
                toast.custom('info', 'Тема деактивирована', 'Установлена тема по умолчанию')
            }
        } else {
            setEnabledScripts(prev => {
                const newScripts = newChecked ? [...prev, addon.directoryName] : prev.filter(scriptName => scriptName !== addon.directoryName)
                if (newChecked) {
                    toast.custom('success', 'Скрипт включен', `${addon.name} теперь активен`)
                } else {
                    toast.custom('info', 'Скрипт выключен', `${addon.name} деактивирован`)
                }
                return newScripts
            })
        }
    }

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value.toLowerCase())
    }

    function filterAndSortAddons(list: AddonInterface[], query: string, tags: Set<string>): AddonInterface[] {
        // Filter by tags
        let filtered = filterAddonsByTags(list, tags)
        // Filter by search query
        if (query.trim() !== '') {
            filtered = filtered.filter(item => {
                const authorString = typeof item.author === 'string' ? item.author.toLowerCase() : ''
                return item.name.toLowerCase().includes(query) || authorString.includes(query)
            })
        }
        // Sort by priority (enabled/disabled status)
        return filtered.sort((a, b) => {
            const priA = getPriority(a)
            const priB = getPriority(b)
            return priA - priB
        })
    }

    function filterAddonsByTags(list: AddonInterface[], tags: Set<string>): AddonInterface[] {
        if (tags.size === 0) return list
        return list.filter(item => item.tags?.some(t => tags.has(t)))
    }

    function getMissingCount(addon: AddonInterface): number {
        return checkMissingFields(addon).length
    }

    function getPriority(addon: AddonInterface): number {
        const missingCount = getMissingCount(addon)
        if (missingCount > 0) {
            return 999
        }
        const isTheme = addon.type === 'theme'
        const isEnabledTheme = isTheme && addon.directoryName === currentTheme
        if (isEnabledTheme) return 0
        const isScript = addon.type === 'script'
        const isEnabledScript = isScript && enabledScripts.includes(addon.directoryName)
        if (isEnabledScript) return 1
        return 2
    }

    const mergedAddons = useMemo(() => {
        let filtered = filterAddonsByTags(addons, selectedTags)
        filtered = filterAndSortAddons(filtered, searchQuery, selectedTags)

        filtered = filtered.filter(addon => addon.name !== 'Default');

        if (hideEnabled) {
            filtered = filtered.filter(item => {
                if (item.type === 'theme') {
                    return item.directoryName !== currentTheme
                }
                return !enabledScripts.includes(item.directoryName)
            })
        }
        filtered.sort((a, b) => {
            const priA = getPriority(a)
            const priB = getPriority(b)
            if (priA !== priB) {
                return priA - priB
            }
            const aMatch = a.matches ? 1 : 0
            const bMatch = b.matches ? 1 : 0
            return bMatch - aMatch
        })
        return filtered
    }, [addons, selectedTags, searchQuery, hideEnabled, currentTheme, enabledScripts])

    useEffect(() => {
        if (searchQuery.trim() !== '') {
            setDisplayedCount(mergedAddons.length)
            setIsListFullyLoaded(true)
        } else {
            setDisplayedCount(0)
            if (mergedAddons.length > 0) {
                const interval = setInterval(() => {
                    setDisplayedCount(prev => {
                        if (prev < mergedAddons.length) {
                            return prev + 1
                        } else {
                            clearInterval(interval)
                            setIsListFullyLoaded(true)
                            return prev
                        }
                    })
                }, 50)
                return () => clearInterval(interval)
            }
        }
    }, [mergedAddons, searchQuery])

    useEffect(() => {
        window.electron.store.set('addons.selectedTags', Array.from(selectedTags))
        window.electron.store.set('addons.hideEnabled', hideEnabled)
    }, [selectedTags, hideEnabled])

    const handleAddonClick = (addon: AddonInterface) => {
        setSelectedAddon(addon)
    }

    const handleCreateTheme = () => {
        window.desktopEvents.invoke('create-new-extension').then(res => {
            if (res.success) {
                toast.custom('success', 'Вжух!', 'Новое расширение создано: ' + res.name)
                setAddons([])
                loadAddons()
            }
        })
    }

    const handleOpenAddonsDirectory = () => {
        window.desktopEvents?.send('openPath', { action: 'themePath' })
    }

    const handleReloadAddons = () => {
        loadAddons()
        toast.custom('info', 'Информация', 'Аддоны перезагружены')
    }

    useEffect(() => {
        if (!selectedAddon && isListFullyLoaded && mergedAddons.length > 0) {
            const firstAddon = mergedAddons[0]
            setSelectedAddon(firstAddon)
        }
    }, [isListFullyLoaded, mergedAddons, selectedAddon])

    return (
        <Layout title="Аддоны">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div ref={containerRef} className={styles.main_container}>
                        <ContainerV2 titleName={'Addons'} imageName={'extension'}></ContainerV2>
                        <div className={extensionStylesV2.container}>
                            <div className={extensionStylesV2.leftSide}>
                                {/* Action Buttons */}
                                <div className={extensionStylesV2.actionButtons}>
                                    <button className={extensionStylesV2.actionButton} onClick={() => handleCreateTheme()}>
                                        <FileAddImg />
                                    </button>
                                    <button className={extensionStylesV2.actionButton} onClick={() => handleOpenAddonsDirectory()}>
                                        <FileImg />
                                    </button>
                                    <button className={extensionStylesV2.actionButton} onClick={() => handleReloadAddons()}>
                                        <ArrowRefreshImg />
                                    </button>
                                </div>

                                {/* Search Container */}
                                <div className={extensionStylesV2.searchContainer}>
                                    <input
                                        type="text"
                                        placeholder="Поиск..."
                                        value={searchQuery}
                                        onChange={handleSearchChange}
                                        className={extensionStylesV2.searchInput}
                                    />
                                </div>

                                {/* Tag Selector */}
                                <div className={extensionStylesV2.tagSelectorContainer}>
                                    {Array.from(selectedTags).map(tag => (
                                        <div key={tag} className={extensionStylesV2.selectedTag}>
                                            {tag}
                                            <button
                                                className={extensionStylesV2.removeTagButton}
                                                onClick={() => {
                                                    setSelectedTags(prev => {
                                                        const newSet = new Set(prev)
                                                        newSet.delete(tag)
                                                        return newSet
                                                    })
                                                }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    <select
                                        className={extensionStylesV2.tagDropdown}
                                        onChange={e => {
                                            if (e.target.value) {
                                                setSelectedTags(prev => {
                                                    const newSet = new Set(prev)
                                                    newSet.add(e.target.value)
                                                    return newSet
                                                })
                                            }
                                        }}
                                    >
                                        <option value="">Выберите тег</option>
                                        {Array.from(new Set(addons.flatMap(addon => addon.tags || []))).map(tag => (
                                            <option key={tag} value={tag}>
                                                {tag}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Display Addons */}
                                <div className={extensionStylesV2.addonList}>
                                    {/* Enabled Addons */}
                                    <div className={extensionStylesV2.enabledAddons}>
                                        {mergedAddons
                                            .filter(addon =>
                                                addon.type === 'theme'
                                                    ? addon.directoryName === currentTheme
                                                    : enabledScripts.includes(addon.directoryName),
                                            )
                                            .map(addon => (
                                                <div
                                                    key={addon.name}
                                                    className={`${extensionStylesV2.addonCard} ${selectedAddon === addon ? extensionStylesV2.addonCardSelected : ''}`}
                                                    onClick={() => handleAddonClick(addon)}
                                                >
                                                    <div
                                                        className={`${extensionStylesV2.checkSelect} ${
                                                            addon.type === 'theme'
                                                                ? extensionStylesV2.checkMarkTheme
                                                                : extensionStylesV2.checkMarkScript
                                                        }`}
                                                        style={{
                                                            marginRight: '12px',
                                                            opacity: 1,
                                                            color: null,
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={e => {
                                                            e.stopPropagation()
                                                            handleCheckboxChange(
                                                                addon,
                                                                !(addon.type === 'theme'
                                                                    ? addon.directoryName === currentTheme
                                                                    : enabledScripts.includes(addon.directoryName)),
                                                            )
                                                        }}
                                                    >
                                                        <MdCheckCircle size={18} />
                                                    </div>
                                                    <img
                                                        src={
                                                            addon.path && addon.image
                                                                ? encodeURI(`${addon.path}/${addon.image}`.replace(/\\/g, '/'))
                                                                : 'static/assets/images/no_themeImage.png'
                                                        }
                                                        alt="Addon"
                                                        className={extensionStylesV2.addonImage}
                                                        loading="lazy"
                                                    />
                                                    <div className={extensionStylesV2.addonName}>
                                                        {addon.name}
                                                    </div>
                                                    <div className={extensionStylesV2.addonType}>
                                                        {addon.type === 'theme' ? <MdColorLens size={21} /> : <MdTextSnippet size={21} />}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                    <div className={extensionStylesV2.line}></div>
                                    {/* Disabled Addons */}
                                    <div className={extensionStylesV2.disabledAddons}>
                                        {mergedAddons
                                            .filter(
                                                addon =>
                                                    !(addon.type === 'theme'
                                                        ? addon.directoryName === currentTheme
                                                        : enabledScripts.includes(addon.directoryName)),
                                            )
                                            .map(addon => (
                                                <div
                                                    key={addon.name}
                                                    className={`${extensionStylesV2.addonCard} ${selectedAddon === addon ? extensionStylesV2.addonCardSelected : ''}`}
                                                    onClick={() => handleAddonClick(addon)}
                                                >
                                                    <div
                                                        className={`${extensionStylesV2.checkSelect} ${
                                                            addon.type === 'theme'
                                                                ? extensionStylesV2.checkMarkTheme
                                                                : extensionStylesV2.checkMarkScript
                                                        }`}
                                                        style={{
                                                            color: '#565F77',
                                                        }}
                                                        onClick={e => {
                                                            e.stopPropagation()
                                                            handleCheckboxChange(
                                                                addon,
                                                                !(addon.type === 'theme'
                                                                    ? addon.directoryName === currentTheme
                                                                    : enabledScripts.includes(addon.directoryName)),
                                                            )
                                                        }}
                                                    >
                                                        <MdCheckCircle size={18} />
                                                    </div>
                                                    <img
                                                        src={
                                                            addon.path && addon.image
                                                                ? encodeURI(`${addon.path}/${addon.image}`.replace(/\\/g, '/'))
                                                                : 'static/assets/images/no_themeImage.png'
                                                        }
                                                        alt="Addon"
                                                        className={extensionStylesV2.addonImage}
                                                        loading="lazy"
                                                    />
                                                    <div className={extensionStylesV2.addonName}>
                                                        {addon.name}
                                                    </div>
                                                    <div className={extensionStylesV2.addonType}>
                                                        {addon.type === 'theme' ? <MdColorLens size={21} /> : <MdTextSnippet size={21} />}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            </div>
                            <div className={extensionStylesV2.rightSide}>
                                {selectedAddon && (
                                    <ExtensionView
                                        addon={selectedAddon}
                                        isEnabled={
                                            selectedAddon.type === 'theme'
                                                ? selectedAddon.directoryName === currentTheme
                                                : enabledScripts.includes(selectedAddon.directoryName)
                                        }
                                        onToggleEnabled={(enabled: boolean) => handleCheckboxChange(selectedAddon, enabled)}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
