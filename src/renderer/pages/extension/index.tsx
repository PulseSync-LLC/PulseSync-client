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
import { MdCheckCircle, MdColorLens, MdFilterList, MdMoreHoriz, MdTextSnippet } from 'react-icons/md'
import TagFilterPanel from '../../components/PSUI/TagFilterPanel'
import Scrollbar from '../../components/PSUI/Scrollbar'

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

    const filterButtonRef = useRef<HTMLButtonElement>(null)
    const optionButtonRef = useRef<HTMLButtonElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set(window.electron.store.get('addons.selectedTags') || []))
    const [searchParams] = useSearchParams()
    const selectedTagFromURL = searchParams.get('selectedTag')
    const [displayedCount, setDisplayedCount] = useState(0)
    const [showTagFilter, setShowTagFilter] = useState(false)
    const [optionMenu, setOptionMenu] = useState(false)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node
            if (
                containerRef.current &&
                !containerRef.current.contains(target) &&
                filterButtonRef.current &&
                !filterButtonRef.current.contains(target) &&
                optionButtonRef.current &&
                !optionButtonRef.current.contains(target)
            ) {
                setOptionMenu(false)
                setShowTagFilter(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])

    const loadAddons = () => {
        window.desktopEvents
            ?.invoke('getAddons')
            .then((fetchedAddons: AddonInterface[]) => {
                const filtered = fetchedAddons.filter(a => a.name !== 'Default')
                setAddons(filtered)
            })
            .catch(error => console.error('Ошибка при загрузке аддонов:', error))
    }

    useEffect(() => {
        if (selectedTagFromURL) {
            setSelectedTags(prev => new Set(prev).add(selectedTagFromURL))
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
            const updated = newChecked ? [...enabledScripts, addon.directoryName] : enabledScripts.filter(name => name !== addon.directoryName)

            toast.custom(
                newChecked ? 'success' : 'info',
                newChecked ? 'Скрипт включен' : 'Скрипт выключен',
                `${addon.name} ${newChecked ? 'теперь активен' : 'деактивирован'}`,
            )

            setEnabledScripts(updated)
        }
    }

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value.toLowerCase())
    }

    function filterAddonsByTags(list: AddonInterface[], tags: Set<string>) {
        if (tags.size === 0) return list
        return list.filter(item => item.tags?.some(t => tags.has(t)))
    }

    function getPriority(addon: AddonInterface) {
        const missing = checkMissingFields(addon).length
        if (missing > 0) return 999
        const isTheme = addon.type === 'theme'
        const isScript = addon.type === 'script'
        if (isTheme && addon.directoryName === currentTheme) return 0
        if (isScript && enabledScripts.includes(addon.directoryName)) return 1
        return 2
    }

    const mergedAddons = useMemo(() => {
        let result = filterAddonsByTags(addons, selectedTags)

        if (searchQuery.trim()) {
            const q = searchQuery.trim()
            result = result.filter(item => {
                const author = typeof item.author === 'string' ? item.author.toLowerCase() : ''
                return item.name.toLowerCase().includes(q) || author.includes(q)
            })
        }

        result = result.filter(a => a.name !== 'Default')

        if (hideEnabled) {
            result = result.filter(item => {
                return item.type === 'theme' ? item.directoryName !== currentTheme : !enabledScripts.includes(item.directoryName)
            })
        }

        return result.sort((a, b) => {
            const pA = getPriority(a),
                pB = getPriority(b)
            if (pA !== pB) return pA - pB
            const mA = a.matches ? 1 : 0,
                mB = b.matches ? 1 : 0
            return mB - mA
        })
    }, [addons, selectedTags, searchQuery, hideEnabled, currentTheme, enabledScripts])

    useEffect(() => {
        if (searchQuery.trim()) {
            setDisplayedCount(mergedAddons.length)
            setIsListFullyLoaded(true)
        } else {
            setDisplayedCount(0)
            if (mergedAddons.length > 0) {
                const interval = setInterval(() => {
                    setDisplayedCount(prev => {
                        if (prev < mergedAddons.length) return prev + 1
                        clearInterval(interval)
                        setIsListFullyLoaded(true)
                        return prev
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

    useEffect(() => {
        if (!selectedAddon && isListFullyLoaded && mergedAddons.length > 0) {
            setSelectedAddon(mergedAddons[0])
        }
    }, [isListFullyLoaded, mergedAddons, selectedAddon])

    const toggleTag = (tag: string) => {
        setSelectedTags(prev => {
            const next = new Set(prev)
            if (next.has(tag)) next.delete(tag)
            else next.add(tag)
            return next
        })
    }

    const handleAddonClick = (addon: AddonInterface) => setSelectedAddon(addon)
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

    const activeTagCount = selectedTags.size + (hideEnabled ? 1 : 0)
    const allTags = Array.from(new Set(addons.flatMap(addon => addon.tags || [])))

    const toggleFilterPanel = () => {
        setShowTagFilter(prev => !prev)
        setOptionMenu(false)
    }

    const toggleOptionMenu = () => {
        setOptionMenu(prev => !prev)
        setShowTagFilter(false)
    }

    return (
        <Layout title="Аддоны">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <ContainerV2 titleName="Addons" imageName="extension" />
                        <div ref={containerRef}>
                            {showTagFilter && <TagFilterPanel allTags={allTags} selectedTags={selectedTags} toggleTag={toggleTag} />}

                            {optionMenu && (
                                <div className={extensionStylesV2.containerOtional}>
                                    <button
                                        className={`${extensionStylesV2.toolbarButton} ${extensionStylesV2.refreshButton}`}
                                        onClick={handleReloadAddons}
                                    >
                                        <ArrowRefreshImg /> Перезагрузить расширения
                                    </button>
                                    <button className={extensionStylesV2.toolbarButton} onClick={handleOpenAddonsDirectory}>
                                        <FileImg /> Директория аддонов
                                    </button>
                                    <button className={extensionStylesV2.toolbarButton} onClick={handleCreateTheme}>
                                        <FileAddImg /> Создать новое расширение
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className={extensionStylesV2.container}>
                            <Scrollbar className={extensionStylesV2.leftSide} classNameInner={extensionStylesV2.leftSideInner}>
                                <div className={extensionStylesV2.searchContainer}>
                                    <input
                                        type="text"
                                        placeholder="Поиск..."
                                        value={searchQuery}
                                        onChange={handleSearchChange}
                                        className={extensionStylesV2.searchInput}
                                    />
                                    <button ref={filterButtonRef} className={extensionStylesV2.filterButton} onClick={toggleFilterPanel}>
                                        <MdFilterList />
                                        {activeTagCount > 0 && (
                                            <div className={extensionStylesV2.count}>{activeTagCount > 9 ? '9+' : activeTagCount}</div>
                                        )}
                                    </button>
                                    <button
                                        ref={optionButtonRef}
                                        className={`${extensionStylesV2.optionsButton} ${optionMenu ? extensionStylesV2.optionsButtonActive : ''}`}
                                        onClick={toggleOptionMenu}
                                    >
                                        <MdMoreHoriz />
                                    </button>
                                </div>

                                <div className={extensionStylesV2.tagSelectorContainer}>
                                    {Array.from(selectedTags).map(tag => (
                                        <div
                                            key={tag}
                                            className={extensionStylesV2.selectedTag}
                                            onClick={() => {
                                                setSelectedTags(prev => {
                                                    const newSet = new Set(prev)
                                                    newSet.delete(tag)
                                                    return newSet
                                                })
                                            }}
                                        >
                                            {tag}
                                        </div>
                                    ))}
                                </div>

                                <div className={extensionStylesV2.addonList}>
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
                                                        className={`${extensionStylesV2.checkSelect} ${addon.type === 'theme' ? extensionStylesV2.checkMarkTheme : extensionStylesV2.checkMarkScript}`}
                                                        style={{ marginRight: '12px', opacity: 1, cursor: 'pointer' }}
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
                                                    <div className={extensionStylesV2.addonName}>{addon.name}</div>
                                                    <div className={extensionStylesV2.addonType}>
                                                        {addon.type === 'theme' ? <MdColorLens size={21} /> : <MdTextSnippet size={21} />}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>

                                    <div className={extensionStylesV2.line}></div>

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
                                                        className={`${extensionStylesV2.checkSelect} ${addon.type === 'theme' ? extensionStylesV2.checkMarkTheme : extensionStylesV2.checkMarkScript}`}
                                                        style={{ color: '#565F77' }}
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
                                                    <div className={extensionStylesV2.addonName}>{addon.name}</div>
                                                    <div className={extensionStylesV2.addonType}>
                                                        {addon.type === 'theme' ? <MdColorLens size={21} /> : <MdTextSnippet size={21} />}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            </Scrollbar>

                            <div className={extensionStylesV2.rightSide}>
                                {selectedAddon && (
                                    <ExtensionView
                                        addon={selectedAddon}
                                        isEnabled={
                                            selectedAddon.type === 'theme'
                                                ? selectedAddon.directoryName === currentTheme
                                                : enabledScripts.includes(selectedAddon.directoryName)
                                        }
                                        onToggleEnabled={enabled => handleCheckboxChange(selectedAddon, enabled)}
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
