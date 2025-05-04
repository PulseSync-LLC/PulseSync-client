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
import Scrollbar from '../../components/PSUI/Scrollbar'
import AddonFilters from '../../components/PSUI/AddonFilters'

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
    const [displayedCount, setDisplayedCount] = useState(0)
    const [optionMenu, setOptionMenu] = useState(false)
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

    // Состояния для нового фильтра
    const [showFilters, setShowFilters] = useState(false)
    const [sort, setSort] = useState<'alphabet' | 'date' | 'size' | 'author' | 'type'>('type')
    const [type, setType] = useState<'all' | 'theme' | 'script'>('all')
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
    const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set())

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
                setShowFilters(false)
                setOptionMenu(false)
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
        loadAddons()
    }, [])

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

    const handleTypeChange = (newType: 'all' | 'theme' | 'script') => {
        setType(newType)
    }

    const toggleSet = (set: Set<string>, value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
        const newSet = new Set(set)
        if (newSet.has(value)) {
            newSet.delete(value)
        } else {
            newSet.add(value)
        }
        setter(newSet)
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

    const handleSortChange = (option: 'alphabet' | 'date' | 'size' | 'author' | 'type') => {
        if (option === sort) {
            setSortOrder(prev => (prev === 'asc' ? 'desc' : 'desc'))
        } else {
            setSort(option)
            setSortOrder('desc')
        }
    }

    const mergedAddons = useMemo(() => {
        let result = addons.filter(a => a.name !== 'Default')

        // Фильтрация по типу
        if (type !== 'all') {
            result = result.filter(addon => addon.type === type)
        }

        // Фильтрация по тегам
        if (selectedTags.size > 0) {
            result = result.filter(addon => addon.tags?.some(tag => selectedTags.has(tag)))
        }

        // Фильтрация по авторам
        if (selectedCreators.size > 0) {
            result = result.filter(addon => typeof addon.author === 'string' && selectedCreators.has(addon.author))
        }

        // Сортировка
        switch (sort) {
            case 'type':
                result.sort((a, b) => {
                    const typeA = a.type || ''
                    const typeB = b.type || ''
                    const comparison = typeA.localeCompare(typeB) // Сравнение типов
                    return sortOrder === 'asc' ? comparison : -comparison // Если сортировка по убыванию
                })
                break
            case 'alphabet':
                result.sort((a, b) => {
                    const comparison = a.name.localeCompare(b.name)
                    return sortOrder === 'asc' ? comparison : -comparison
                })
                break
            case 'date':
                result.sort((a, b) => {
                    const dateA = parseFloat(a.lastModified || '0') || 0
                    const dateB = parseFloat(b.lastModified || '0') || 0
                    return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
                })
                break
            case 'size':
                result.sort((a, b) => {
                    const sizeA = parseFloat(a.size || '0') || 0
                    const sizeB = parseFloat(b.size || '0') || 0
                    return sortOrder === 'asc' ? sizeA - sizeB : sizeB - sizeA
                })
                break
            case 'author':
                result.sort((a, b) => {
                    const authorA = typeof a.author === 'string' ? a.author : ''
                    const authorB = typeof b.author === 'string' ? b.author : ''
                    const comparison = authorA.localeCompare(authorB)
                    return sortOrder === 'asc' ? comparison : -comparison
                })
                break
        }

        // Удаление включенных аддонов, если `hideEnabled` включен
        if (hideEnabled) {
            result = result.filter(addon => {
                return addon.type === 'theme' ? addon.directoryName !== currentTheme : !enabledScripts.includes(addon.directoryName)
            })
        }

        return result
    }, [addons, type, selectedTags, selectedCreators, searchQuery, sort, sortOrder, hideEnabled, currentTheme, enabledScripts])

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
        if (!selectedAddon && isListFullyLoaded && mergedAddons.length > 0) {
            setSelectedAddon(mergedAddons[0])
        }
    }, [isListFullyLoaded, mergedAddons, selectedAddon])

    const handleAddonClick = (addon: AddonInterface) => setSelectedAddon(addon)

    const toggleFilterPanel = () => {
        setShowFilters(prev => !prev)
        setOptionMenu(false)
    }

    const toggleOptionMenu = () => {
        setOptionMenu(prev => !prev)
        setShowFilters(false)
    }

    return (
        <Layout title="Аддоны">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <ContainerV2 titleName="Addons" imageName="extension" />
                        <div ref={containerRef}>
                            {showFilters && (
                                <AddonFilters
                                    tags={Array.from(new Set(addons.flatMap(addon => addon.tags || [])))}
                                    creators={Array.from(new Set(addons.map(addon => (typeof addon.author === 'string' ? addon.author : ''))))}
                                    sort={sort}
                                    sortOrder={sortOrder}
                                    type={type}
                                    selectedTags={selectedTags}
                                    selectedCreators={selectedCreators}
                                    onSortChange={handleSortChange}
                                    onTypeChange={handleTypeChange}
                                    onToggleTag={tag => toggleSet(selectedTags, tag, setSelectedTags)}
                                    onToggleCreator={creator => toggleSet(selectedCreators, creator, setSelectedCreators)}
                                    setType={setType}
                                    setSelectedTags={setSelectedTags}
                                    setSelectedCreators={setSelectedCreators}
                                    onSortOrderChange={setSortOrder}
                                />
                            )}
                            {optionMenu && (
                                <div className={extensionStylesV2.containerOtional}>
                                    <button
                                        className={`${extensionStylesV2.toolbarButton} ${extensionStylesV2.refreshButton}`}
                                        onClick={() => {
                                            loadAddons()
                                            toast.custom('info', 'Информация', 'Аддоны перезагружены')
                                        }}
                                    >
                                        <ArrowRefreshImg /> Перезагрузить расширения
                                    </button>
                                    <button
                                        className={extensionStylesV2.toolbarButton}
                                        onClick={() => window.desktopEvents?.send('openPath', { action: 'themePath' })}
                                    >
                                        <FileImg /> Директория аддонов
                                    </button>
                                    <button
                                        className={extensionStylesV2.toolbarButton}
                                        onClick={() => {
                                            window.desktopEvents.invoke('create-new-extension').then(res => {
                                                if (res.success) {
                                                    toast.custom('success', 'Вжух!', 'Новое расширение создано: ' + res.name)
                                                    setAddons([])
                                                    loadAddons()
                                                }
                                            })
                                        }}
                                    >
                                        <FileAddImg /> Создать новое расширение
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className={extensionStylesV2.container}>
                            <Scrollbar className={extensionStylesV2.leftSide} classNameInner={extensionStylesV2.leftSideInner}>
                                <div className={extensionStylesV2.topContainer}>
                                    <div className={extensionStylesV2.searchContainer}>
                                        <input
                                            type="text"
                                            placeholder="Поиск..."
                                            value={searchQuery}
                                            onChange={handleSearchChange}
                                            className={extensionStylesV2.searchInput}
                                        />
                                        <button
                                            ref={filterButtonRef}
                                            className={`${extensionStylesV2.filterButton}`}
                                            style={showFilters ? { background: '#98FFD6', color: '#181818' } : undefined}
                                            onClick={toggleFilterPanel}
                                        >
                                            <MdFilterList />
                                            {selectedTags.size + selectedCreators.size > 0 && (
                                                <div className={extensionStylesV2.count}>
                                                    {selectedTags.size + selectedCreators.size > 9 ? '9+' : selectedTags.size + selectedCreators.size}
                                                </div>
                                            )}
                                        </button>
                                    </div>
                                    <button
                                        ref={optionButtonRef}
                                        className={`${extensionStylesV2.optionsButton} ${optionMenu ? extensionStylesV2.optionsButtonActive : ''}`}
                                        style={optionMenu ? { background: '#98FFD6', color: '#181818' } : undefined}
                                        onClick={toggleOptionMenu}
                                    >
                                        <MdMoreHoriz />
                                    </button>
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
