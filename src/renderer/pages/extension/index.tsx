import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { MdCheckCircle, MdFilterList, MdIntegrationInstructions, MdInvertColors, MdMoreHoriz } from 'react-icons/md'
import stringSimilarity from 'string-similarity'

import userContext from '../../api/context/user.context'
import Addon from '../../api/interfaces/addon.interface'

import toast from '../../components/toast'

import Layout from '../../components/layout'
import Scrollbar from '../../components/PSUI/Scrollbar'
import AddonFilters from '../../components/PSUI/AddonFilters'
import OptionMenu from '../../components/PSUI/OptionMenu'
import Loader from '../../components/PSUI/Loader'

import ExtensionView from './route/extensionview'

import * as extensionStylesV2 from './extension.module.scss'
import * as styles from '../../../../static/styles/page/index.module.scss'
import addonInitials from '../../api/initials/addon.initials'

import config from '../../api/config'
import MainEvents from '../../../common/types/mainEvents'
import CustomModalPS from '../../components/PSUI/CustomModalPS'

const defaultOrder = {
    alphabet: 'asc',
    author: 'asc',
    date: 'asc',
    size: 'desc',
    type: 'asc',
} as const

type SortKey = keyof typeof defaultOrder

function safeStoreGet<T>(path: string, fallback: T): T {
    try {
        // @ts-ignore
        const val = window?.electron?.store?.get?.(path)
        return (val ?? fallback) as T
    } catch {
        return fallback
    }
}

function useDebouncedValue<T>(value: T, delay: number) {
    const [debounced, setDebounced] = useState(value)
    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), delay)
        return () => clearTimeout(id)
    }, [value, delay])
    return debounced
}

export default function ExtensionPage() {
    const { addons, setAddons, musicVersion } = useContext(userContext)
    const [currentTheme, setCurrentTheme] = useState<string>(() => safeStoreGet<string>('addons.theme', 'Default'))
    const [enabledScripts, setEnabledScripts] = useState<string[]>(() => safeStoreGet<string[]>('addons.scripts', []))
    const [searchQuery, setSearchQuery] = useState('')
    const debouncedSearchQuery = useDebouncedValue(searchQuery.toLowerCase(), 250)

    const [selectedAddonId, setSelectedAddonId] = useState<string | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)
    const [modalAddon, setModalAddon] = useState<Addon | null>(null)

    const filterButtonRef = useRef<HTMLButtonElement>(null)
    const optionButtonRef = useRef<HTMLButtonElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [optionMenu, setOptionMenu] = useState(false)
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

    const [showFilters, setShowFilters] = useState(false)
    const [sort, setSort] = useState<SortKey>('type')
    const [type, setType] = useState<'all' | 'theme' | 'script'>('all')
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
    const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set())

    const [imageCache, setImageCache] = useState<Record<string, string>>({})

    const previewCacheRef = useRef<Map<string, string>>(new Map())
    const loadedRef = useRef(false)

    useEffect(() => {
        const init = async () => {
            try {
                await loadAddons()
                loadedRef.current = true
                setIsLoaded(true)
            } catch (e) {
                console.error('Ошибка при инициализации аддонов:', e)
                toast.custom('error', 'Упс', 'Не удалось загрузить аддоны')
                setIsLoaded(true)
            }
        }
        if (!loadedRef.current) {
            init()
        }
    }, [])

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

    const loadAddons = useCallback(
        async (force = false) => {
            try {
                const result = await window.desktopEvents?.invoke(MainEvents.GET_ADDONS, { force })
                const fetchedAddons: Addon[] = Array.isArray(result) ? result : []
                const filtered = fetchedAddons.filter(a => a.name !== 'Default')
                setAddons(filtered)
                const themeFromStore = safeStoreGet<string>('addons.theme', 'Default')
                setCurrentTheme(themeFromStore)
            } catch (error) {
                console.error('Ошибка при загрузке аддонов:', error)
                throw error
            }
        },
        [setAddons],
    )

    const handleCheckboxChange = useCallback(
        (addon: Addon, newChecked: boolean) => {
            if (addon.type === 'theme') {
                if (newChecked) {
                    setCurrentTheme(addon.directoryName)
                    window.electron.store.set('addons.theme', addon.directoryName)
                    window.desktopEvents?.send(MainEvents.THEME_CHANGED, addonInitials[0])
                    window.desktopEvents?.send(MainEvents.THEME_CHANGED, addon)
                    toast.custom('success', 'Тема активирована', `${addon.name} теперь активна`)
                } else {
                    setCurrentTheme('Default')
                    window.electron.store.set('addons.theme', 'Default')
                    window.desktopEvents?.send(MainEvents.THEME_CHANGED, addonInitials[0])
                    toast.custom('info', 'Тема деактивирована', 'Установлена тема по умолчанию')
                }
            } else {
                const updated = newChecked ? [...enabledScripts, addon.directoryName] : enabledScripts.filter(name => name !== addon.directoryName)
                toast.custom(
                    newChecked ? 'success' : 'info',
                    newChecked ? 'Скрипт включен' : 'Скрипт выключен',
                    `${addon.name} ${newChecked ? 'теперь активен' : 'деактивирован'}`,
                )
                window.electron.store.set('addons.scripts', updated)
                window.desktopEvents?.send(MainEvents.REFRESH_EXTENSIONS)
                setEnabledScripts(updated)
            }
        },
        [enabledScripts],
    )

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value)
    }, [])

    const handleTypeChange = useCallback((newType: 'all' | 'theme' | 'script') => {
        setType(newType)
    }, [])

    const toggleSet = useCallback((setVal: Set<string>, value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
        const newSet = new Set(setVal)
        if (newSet.has(value)) {
            newSet.delete(value)
        } else {
            newSet.add(value)
        }
        setter(newSet)
    }, [])

    const handleSortChange = useCallback(
        (option: SortKey) => {
            if (option === sort) {
                setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
            } else {
                setSort(option)
                setSortOrder(defaultOrder[option])
            }
        },
        [sort],
    )

    const uniqueTags = useMemo(() => {
        const src = addons.filter(ad => ad.name !== 'Default')
        const tags = new Set<string>()
        src.forEach(ad => (ad.tags || []).forEach(t => tags.add(t)))
        return Array.from(tags)
    }, [addons])

    const uniqueCreators = useMemo(() => {
        const src = addons.filter(ad => ad.name !== 'Default')
        const creators = new Set<string>()
        src.forEach(ad => {
            if (typeof ad.author === 'string' && ad.author.trim() !== '') creators.add(ad.author)
        })
        return Array.from(creators)
    }, [addons])

    const mergedAddons = useMemo(() => {
        let result = addons.filter(a => a.name !== 'Default')
        if (type !== 'all') {
            result = result.filter(addon => addon.type === type)
        }
        if (selectedTags.size > 0) {
            result = result.filter(addon => addon.tags?.some(tag => selectedTags.has(tag)))
        }
        if (selectedCreators.size > 0) {
            result = result.filter(addon => typeof addon.author === 'string' && selectedCreators.has(addon.author))
        }
        if (debouncedSearchQuery.trim()) {
            const q = debouncedSearchQuery
            result = result.filter(item => {
                const authorString =
                    typeof item.author === 'string'
                        ? item.author.toLowerCase()
                        : Array.isArray(item.author)
                          ? item.author.map(id => String(id).toLowerCase()).join(', ')
                          : ''
                let matches = item.name.toLowerCase().includes(q) || authorString.includes(q)
                if (!matches && q.length > 2) {
                    matches =
                        stringSimilarity.compareTwoStrings(item.name.toLowerCase(), q) > 0.35 ||
                        stringSimilarity.compareTwoStrings(authorString, q) > 0.35
                }
                return matches
            })
        }
        switch (sort) {
            case 'type': {
                result = result.slice().sort((a, b) => {
                    const typeA = a.type || ''
                    const typeB = b.type || ''
                    const cmp = typeA.localeCompare(typeB)
                    return sortOrder === 'asc' ? cmp : -cmp
                })
                break
            }
            case 'alphabet': {
                result = result.slice().sort((a, b) => {
                    const cmp = a.name.localeCompare(b.name)
                    return sortOrder === 'asc' ? cmp : -cmp
                })
                break
            }
            case 'date': {
                result = result.slice().sort((a, b) => {
                    const dateA = parseFloat(a.lastModified || '0') || 0
                    const dateB = parseFloat(b.lastModified || '0') || 0
                    return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
                })
                break
            }
            case 'size': {
                result = result.slice().sort((a, b) => {
                    const sizeA = parseFloat(a.size || '0') || 0
                    const sizeB = parseFloat(b.size || '0') || 0
                    return sortOrder === 'asc' ? sizeA - sizeB : sizeB - sizeA
                })
                break
            }
            case 'author': {
                result = result.slice().sort((a, b) => {
                    const authorA = typeof a.author === 'string' ? a.author : ''
                    const authorB = typeof b.author === 'string' ? b.author : ''
                    const cmp = authorA.localeCompare(authorB)
                    return sortOrder === 'asc' ? cmp : -cmp
                })
                break
            }
        }
        return result
    }, [addons, type, selectedTags, selectedCreators, debouncedSearchQuery, sort, sortOrder])

    useEffect(() => {
        const updates: Record<string, string> = {}
        const controller = new AbortController()
        const signal = controller.signal
        let stopped = false
        const run = async () => {
            await Promise.all(
                mergedAddons.map(async addon => {
                    if (!addon.image) return
                    if (previewCacheRef.current.has(addon.directoryName) || imageCache[addon.directoryName]) return
                    const url =
                        `http://127.0.0.1:${config.MAIN_PORT}/addon_file` +
                        `?name=${encodeURIComponent(addon.name)}` +
                        `&file=${encodeURIComponent(addon.image)}`
                    try {
                        const res = await fetch(url, { signal })
                        if (!res.ok) throw new Error('404')
                        const blob = await res.blob()
                        if (stopped) return
                        const blobUrl = URL.createObjectURL(blob)
                        previewCacheRef.current.set(addon.directoryName, blobUrl)
                        updates[addon.directoryName] = blobUrl
                    } catch {
                        if (stopped) return
                        previewCacheRef.current.set(addon.directoryName, 'static/assets/images/no_themeImage.png')
                        updates[addon.directoryName] = 'static/assets/images/no_themeImage.png'
                    }
                }),
            )
            if (Object.keys(updates).length) {
                setImageCache(prev => ({ ...prev, ...updates }))
            }
        }
        run()
        return () => {
            stopped = true
            controller.abort()
        }
    }, [mergedAddons])

    useEffect(() => {
        if (!selectedAddonId) {
            const activeAddon = mergedAddons.find(addon =>
                addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName),
            )
            setSelectedAddonId((activeAddon || mergedAddons[0])?.directoryName || null)
        }
    }, [currentTheme, enabledScripts, mergedAddons, selectedAddonId])

    useEffect(() => {
        if (selectedAddonId && !mergedAddons.some(addon => addon.directoryName === selectedAddonId)) {
            setSelectedAddonId(mergedAddons[0]?.directoryName || null)
        }
    }, [mergedAddons, selectedAddonId])

    useEffect(() => {
        return () => {
            Object.values(imageCache).forEach(url => {
                if (typeof url === 'string' && url.startsWith('blob:')) {
                    URL.revokeObjectURL(url)
                }
            })
            previewCacheRef.current.forEach(url => {
                if (typeof url === 'string' && url.startsWith('blob:')) {
                    URL.revokeObjectURL(url)
                }
            })
            previewCacheRef.current.clear()
        }
    }, [])

    const handleAddonClick = useCallback((addon: Addon) => setSelectedAddonId(addon.directoryName), [])

    const toggleFilterPanel = useCallback(() => {
        setShowFilters(prev => !prev)
        setOptionMenu(false)
    }, [])

    const toggleOptionMenu = useCallback(() => {
        setOptionMenu(prev => !prev)
        setShowFilters(false)
    }, [])

    const getImagePath = useCallback((addon: Addon, cache: Record<string, string>) => {
        if (!addon.image) return 'static/assets/images/no_themeImage.png'
        if (/^(https?:\/\/|data:)/i.test(addon.image.trim())) return addon.image
        if (cache[addon.directoryName]) return cache[addon.directoryName]
        return 'static/assets/images/no_themeImage.png'
    }, [])

    const handleReloadAddons = useCallback(async () => {
        try {
            window.desktopEvents?.send('REFRESH_EXTENSIONS')
            Object.values(imageCache).forEach(url => {
                if (typeof url === 'string' && url.startsWith('blob:')) {
                    URL.revokeObjectURL(url)
                }
            })
            previewCacheRef.current.forEach(url => {
                if (typeof url === 'string' && url.startsWith('blob:')) {
                    URL.revokeObjectURL(url)
                }
            })
            previewCacheRef.current.clear()
            setImageCache({})
            await loadAddons(true)
            setSelectedAddonId(null)
            toast.custom('success', 'Готово', 'Аддоны перезагруж��ны')
        } catch (e) {
            console.error(e)
            toast.custom('error', 'Упс', 'Не удалось перезагрузить аддоны')
        }
    }, [imageCache, loadAddons])

    const handleOpenAddonsDirectory = useCallback(() => {
        window.desktopEvents?.send('openPath', { action: 'themePath' })
    }, [])

    const handleCreateNewAddon = useCallback(() => {
        window.desktopEvents.invoke(MainEvents.CREATE_NEW_EXTENSION).then(async res => {
            if (res?.success) {
                toast.custom('success', 'Вжух!', 'Новое расширение создано: ' + res.name)
                setAddons([])
                await loadAddons(true)
            }
        })
    }, [loadAddons, setAddons])

    const enabledAddons = useMemo(
        () =>
            mergedAddons.filter(addon =>
                addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName),
            ),
        [mergedAddons, currentTheme, enabledScripts],
    )

    const disabledAddons = useMemo(
        () =>
            mergedAddons.filter(
                addon => !(addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)),
            ),
        [mergedAddons, currentTheme, enabledScripts],
    )

    const selectedAddon = useMemo(() => mergedAddons.find(a => a.directoryName === selectedAddonId) || null, [mergedAddons, selectedAddonId])

    const hasAnyInstalled = useMemo(() => addons.some(ad => ad.name !== 'Default'), [addons])

    function ThemeNotFound({ hasAnyAddons }: { hasAnyAddons: boolean }) {
        return (
            <div className={extensionStylesV2.notFound}>
                <h2>{hasAnyAddons ? 'Расширение не найдено' : 'Аддоны не найдены'}</h2>
                <p>
                    {hasAnyAddons
                        ? 'Возможно, расширение было удалено, отфильтровано или ещё не установлено.'
                        : 'Похоже, у вас ещё нет установленных аддонов.'}
                </p>
                <a href="https://discord.gg/qy42uGTzRy" target="_blank" rel="noopener noreferrer">
                    Перейдите в официальный Discord сервер для скачивания аддонов
                </a>
            </div>
        )
    }

    const getAddonModalText = (addon: Addon, musicVersion: string | undefined) => {
        const supported = addon.supportedVersions ? addon.supportedVersions.join(', ') : 'неизвестно'
        const minSupported = addon.supportedVersions?.[0]
        if (musicVersion && minSupported && musicVersion < minSupported) {
            return `Этот аддон работает на версиях Яндекс Музыки: ${supported}.
\nВаша версия Яндекс Музыки (${musicVersion}) ниже минимально поддерживаемой (${minSupported}). Возможны ошибки или некорректная работа!`
        }
        return `Этот аддон работает на версиях Яндекс Музыки: ${supported}.`
    }

    const handleEnableAddon = (addon: Addon) => {
        const minSupported = addon.supportedVersions?.[0]
        if (musicVersion && minSupported && musicVersion < minSupported) {
            setModalAddon(addon)
            setModalOpen(true)
            return
        }
        handleCheckboxChange(addon, !(addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)))
    }

    return (
        <Layout title="Аддоны">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <CustomModalPS
                            isOpen={modalOpen}
                            onClose={() => { setModalOpen(false); setModalAddon(null); }}
                            title="Вы уверены?"
                            text={modalAddon ? getAddonModalText(modalAddon, musicVersion) : ''}
                            subText={`У вас версия: ${musicVersion || 'unknown'}`}
                            buttons={[
                                { text: 'Отмена', onClick: () => { setModalOpen(false); setModalAddon(null); }, variant: 'secondary' },
                                { text: 'Всё равно включить', onClick: () => {
                                    if (modalAddon) {
                                        handleCheckboxChange(modalAddon, !(modalAddon.type === 'theme' ? modalAddon.directoryName === currentTheme : enabledScripts.includes(modalAddon.directoryName)))
                                    }
                                    setModalOpen(false)
                                    setModalAddon(null)
                                }, variant: 'danger' },
                            ]}
                        />
                        <div ref={containerRef}>
                            {showFilters && (
                                <AddonFilters
                                    tags={uniqueTags}
                                    creators={uniqueCreators}
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
                                <OptionMenu
                                    onReloadAddons={handleReloadAddons}
                                    onOpenAddonsDirectory={handleOpenAddonsDirectory}
                                    onCreateNewAddon={handleCreateNewAddon}
                                />
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
                                            className={extensionStylesV2.filterButton}
                                            style={showFilters ? { background: '#98FFD6', color: '#181818' } : undefined}
                                            onClick={toggleFilterPanel}
                                            aria-label="Фильтры"
                                        >
                                            <MdFilterList />
                                            {(() => {
                                                const activeFiltersCount =
                                                    (type !== 'all' ? 1 : 0) + (sort !== 'type' ? 1 : 0) + selectedTags.size + selectedCreators.size
                                                return activeFiltersCount > 0 ? (
                                                    <div className={extensionStylesV2.count}>
                                                        {activeFiltersCount > 9 ? '9+' : activeFiltersCount}
                                                    </div>
                                                ) : null
                                            })()}
                                        </button>
                                    </div>
                                    <button
                                        ref={optionButtonRef}
                                        className={`${extensionStylesV2.optionsButton} ${optionMenu ? extensionStylesV2.optionsButtonActive : ''}`}
                                        style={optionMenu ? { background: '#98FFD6', color: '#181818' } : undefined}
                                        onClick={toggleOptionMenu}
                                        aria-label="Опции"
                                    >
                                        <MdMoreHoriz />
                                    </button>
                                </div>
                                <div className={extensionStylesV2.addonList}>
                                    <div className={extensionStylesV2.enabledAddons}>
                                        {enabledAddons.map(addon => (
                                            <div
                                                key={addon.directoryName}
                                                className={`${extensionStylesV2.addonCard} ${
                                                    selectedAddon?.directoryName === addon.directoryName ? extensionStylesV2.addonCardSelected : ''
                                                }`}
                                                onClick={() => handleAddonClick(addon)}
                                            >
                                                <div
                                                    className={`${extensionStylesV2.checkSelect} ${
                                                        addon.type === 'theme' ? extensionStylesV2.checkMarkTheme : extensionStylesV2.checkMarkScript
                                                    }`}
                                                    style={{ marginRight: '12px', opacity: 1, cursor: 'pointer' }}
                                                    onClick={e => {
                                                        e.stopPropagation()
                                                        if (addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)) {
                                                            handleCheckboxChange(
                                                                addon,
                                                                false
                                                            )
                                                        } else {
                                                            handleEnableAddon(addon)
                                                        }
                                                    }}
                                                >
                                                    <MdCheckCircle size={18} />
                                                </div>
                                                <img
                                                    src={getImagePath(addon, imageCache)}
                                                    alt={addon.name}
                                                    className={extensionStylesV2.addonImage}
                                                    loading="lazy"
                                                />
                                                <div className={extensionStylesV2.addonName}>{addon.name}</div>
                                                <div className={extensionStylesV2.addonType}>
                                                    {addon.type === 'theme' ? <MdInvertColors size={24} /> : <MdIntegrationInstructions size={24} />}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {enabledAddons.length > 0 && disabledAddons.length > 0 && <div className={extensionStylesV2.line}></div>}
                                    {enabledAddons.length === 0 && disabledAddons.length === 0 && (
                                        <div className={extensionStylesV2.noFix}>
                                            <div className={extensionStylesV2.noResults}>Ничего не найдено</div>
                                        </div>
                                    )}
                                    <div className={extensionStylesV2.disabledAddons}>
                                        {disabledAddons.map(addon => (
                                            <div
                                                key={addon.directoryName}
                                                className={`${extensionStylesV2.addonCard} ${
                                                    selectedAddon?.directoryName === addon.directoryName ? extensionStylesV2.addonCardSelected : ''
                                                }`}
                                                onClick={() => handleAddonClick(addon)}
                                            >
                                                <div
                                                    className={`${extensionStylesV2.checkSelect} ${
                                                        addon.type === 'theme' ? extensionStylesV2.checkMarkTheme : extensionStylesV2.checkMarkScript
                                                    }`}
                                                    style={{ color: '#565F77' }}
                                                    onClick={e => {
                                                        e.stopPropagation()
                                                        handleEnableAddon(addon)
                                                    }}
                                                >
                                                    <MdCheckCircle size={18} />
                                                </div>
                                                <img
                                                    src={getImagePath(addon, imageCache)}
                                                    alt={addon.name}
                                                    className={extensionStylesV2.addonImage}
                                                    loading="lazy"
                                                />
                                                <div className={extensionStylesV2.addonName}>{addon.name}</div>
                                                <div className={extensionStylesV2.addonType}>
                                                    {addon.type === 'theme' ? <MdInvertColors size={21} /> : <MdIntegrationInstructions size={21} />}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Scrollbar>
                            <div className={extensionStylesV2.rightSide}>
                                {!isLoaded ? (
                                    <Loader text="Анализирую аддоны…" />
                                ) : selectedAddon ? (
                                    <ExtensionView
                                        addon={selectedAddon}
                                        isEnabled={
                                            selectedAddon.type === 'theme'
                                                ? selectedAddon.directoryName === currentTheme
                                                : enabledScripts.includes(selectedAddon.directoryName)
                                        }
                                        onToggleEnabled={enabled => {
                                            if (enabled) {
                                                handleEnableAddon(selectedAddon)
                                            } else {
                                                handleCheckboxChange(selectedAddon, false)
                                            }
                                        }}
                                        setSelectedTags={setSelectedTags}
                                        setShowFilters={setShowFilters}
                                    />
                                ) : (
                                    <ThemeNotFound hasAnyAddons={hasAnyInstalled} />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
