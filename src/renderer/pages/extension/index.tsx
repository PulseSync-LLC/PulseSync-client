import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import semver from 'semver'

import { MdCheckCircle, MdFilterList, MdIntegrationInstructions, MdInvertColors, MdMoreHoriz } from 'react-icons/md'
import stringSimilarity from 'string-similarity'

import userContext from '../../api/context/user.context'
import Addon from '../../api/interfaces/addon.interface'
import { AddonWhitelistItem } from '../../api/interfaces/addonWhitelist.interface'

import toast from '../../components/toast'

import PageLayout from '../PageLayout'
import Scrollbar from '../../components/PSUI/Scrollbar'
import AddonFilters from '../../components/PSUI/AddonFilters'
import OptionMenu from '../../components/PSUI/OptionMenu'
import Loader from '../../components/PSUI/Loader'

import ExtensionView from './route/extensionview'
import { preloadAddonFiles } from './route/extBox/hooks'

import * as extensionStylesV2 from './extension.module.scss'
import addonInitials from '../../api/initials/addon.initials'

import config from '../../api/web_config'
import MainEvents from '../../../common/types/mainEvents'
import CustomModalPS from '../../components/PSUI/CustomModalPS'
import { staticAsset } from '../../utils/staticAssets'
import apolloClient from '../../api/apolloClient'
import GetAddonWhitelistQuery from '../../api/queries/getAddonWhitelist.query'
import { useTranslation } from 'react-i18next'

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
    const { t } = useTranslation()
    const { addons, setAddons, musicVersion } = useContext(userContext)
    const { contactId } = useParams()
    const location = useLocation()
    const [currentTheme, setCurrentTheme] = useState<string>(() => safeStoreGet<string>('addons.theme', 'Default'))
    const [enabledScripts, setEnabledScripts] = useState<string[]>(() => safeStoreGet<string[]>('addons.scripts', []))
    const [searchQuery, setSearchQuery] = useState('')
    const debouncedSearchQuery = useDebouncedValue(searchQuery.toLowerCase(), 250)

    const [selectedAddonId, setSelectedAddonId] = useState<string | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)
    const [modalAddon, setModalAddon] = useState<Addon | null>(null)
    const [addonWhitelist, setAddonWhitelist] = useState<AddonWhitelistItem[]>([])

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
    const fallbackAddonImage = staticAsset('assets/images/no_themeImage.png')

    const loadedRef = useRef(false)
    const requestedAddonId = useMemo(() => {
        const stateAddon = (location.state as { theme?: Addon } | null)?.theme
        const raw = stateAddon?.directoryName ?? stateAddon?.name ?? contactId
        if (!raw) return null
        try {
            return decodeURIComponent(raw)
        } catch {
            return raw
        }
    }, [contactId, location.state])

    useEffect(() => {
        const init = async () => {
            try {
                await loadAddons()
                loadedRef.current = true
                setIsLoaded(true)
            } catch (e) {
                console.error(t('extensions.initError'), e)
                toast.custom('error', t('common.oopsTitle'), t('extensions.loadFailed'))
                setIsLoaded(true)
            }
        }
        if (!loadedRef.current) {
            init()
        }
    }, [])

    useEffect(() => {
        const fetchAddonWhitelist = async () => {
            try {
                const res = await apolloClient.query<{ getAddonWhitelist: AddonWhitelistItem[] }>({
                    query: GetAddonWhitelistQuery,
                    fetchPolicy: 'no-cache',
                })
                if (Array.isArray(res.data?.getAddonWhitelist)) {
                    setAddonWhitelist(res.data.getAddonWhitelist)
                }
            } catch (error) {
                console.error(t('extensions.whitelistLoadError'), error)
            }
        }

        fetchAddonWhitelist()
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
                console.error(t('extensions.loadError'), error)
                throw error
            }
        },
        [setAddons, t],
    )

    const handleCheckboxChange = useCallback(
        (addon: Addon, newChecked: boolean, showToast: boolean = true) => {
            if (addon.type === 'theme') {
                if (newChecked) {
                    setCurrentTheme(addon.directoryName)
                    window.electron.store.set('addons.theme', addon.directoryName)
                    window.desktopEvents?.send(MainEvents.THEME_CHANGED, addonInitials[0])
                    window.desktopEvents?.send(MainEvents.THEME_CHANGED, addon)
                    if (showToast) {
                        toast.custom('success', t('extensions.themeActivated'), t('extensions.themeActivatedMessage', { name: addon.name }))
                    }
                } else {
                    setCurrentTheme('Default')
                    window.electron.store.set('addons.theme', 'Default')
                    window.desktopEvents?.send(MainEvents.THEME_CHANGED, addonInitials[0])
                    if (showToast) {
                        toast.custom('info', t('extensions.themeDeactivated'), t('extensions.defaultThemeSet'))
                    }
                }
            } else {
                const updated = newChecked ? [...enabledScripts, addon.directoryName] : enabledScripts.filter(name => name !== addon.directoryName)
                if (showToast) {
                    toast.custom(
                        newChecked ? 'success' : 'info',
                        newChecked ? t('extensions.scriptEnabled') : t('extensions.scriptDisabled'),
                        t('extensions.scriptStatusMessage', { name: addon.name, status: newChecked ? t('common.enabled') : t('common.disabled') }),
                    )
                }
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

    const requestedAddonExists = useMemo(
        () => !!requestedAddonId && mergedAddons.some(addon => addon.directoryName === requestedAddonId || addon.name === requestedAddonId),
        [mergedAddons, requestedAddonId],
    )

    useEffect(() => {
        if (!selectedAddonId) {
            const activeAddon = mergedAddons.find(addon =>
                addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName),
            )
            if (!requestedAddonExists) {
                setSelectedAddonId((activeAddon || mergedAddons[0])?.directoryName || null)
            }
        }
    }, [currentTheme, enabledScripts, mergedAddons, requestedAddonExists, selectedAddonId])

    useEffect(() => {
        if (!requestedAddonId || !mergedAddons.length) return
        const matched = mergedAddons.find(addon => addon.directoryName === requestedAddonId || addon.name === requestedAddonId)
        if (matched && selectedAddonId !== matched.directoryName) {
            setSelectedAddonId(matched.directoryName)
        }
    }, [mergedAddons, requestedAddonId, selectedAddonId])

    useEffect(() => {
        if (selectedAddonId && !mergedAddons.some(addon => addon.directoryName === selectedAddonId)) {
            if (requestedAddonExists && requestedAddonId) {
                const matched = mergedAddons.find(addon => addon.directoryName === requestedAddonId || addon.name === requestedAddonId)
                setSelectedAddonId(matched?.directoryName || mergedAddons[0]?.directoryName || null)
            } else {
                setSelectedAddonId(mergedAddons[0]?.directoryName || null)
            }
        }
    }, [mergedAddons, requestedAddonExists, requestedAddonId, selectedAddonId])

    const handleAddonClick = useCallback((addon: Addon) => setSelectedAddonId(addon.directoryName), [])

    const toggleFilterPanel = useCallback(() => {
        setShowFilters(prev => !prev)
        setOptionMenu(false)
    }, [])

    const toggleOptionMenu = useCallback(() => {
        setOptionMenu(prev => !prev)
        setShowFilters(false)
    }, [])

    const getImagePath = useCallback(
        (addon: Addon) => {
            if (!addon.image) return fallbackAddonImage
            if (/^(https?:\/\/|data:)/i.test(addon.image.trim())) return addon.image
            return (
                `http://127.0.0.1:${config.MAIN_PORT}/addon_file` +
                `?name=${encodeURIComponent(addon.name)}` +
                `&file=${encodeURIComponent(addon.image)}`
            )
        },
        [fallbackAddonImage],
    )

    const handleReloadAddons = useCallback(async () => {
        try {
            window.desktopEvents?.send(MainEvents.REFRESH_EXTENSIONS)
            await loadAddons(true)
            setSelectedAddonId(null)
            toast.custom('success', t('common.doneTitle'), t('extensions.reloadSuccess'))
        } catch (e) {
            console.error(e)
            toast.custom('error', t('common.oopsTitle'), t('extensions.reloadFailed'))
        }
    }, [loadAddons, t])

    const handleOpenAddonsDirectory = useCallback(() => {
        window.desktopEvents?.send(MainEvents.OPEN_PATH, {
            action: 'addonsPath',
        })
    }, [])

    const handleCreateNewAddon = useCallback(() => {
        window.desktopEvents.invoke(MainEvents.CREATE_NEW_EXTENSION).then(async res => {
            if (res?.success) {
                toast.custom('success', t('extensions.addonCreatedTitle'), t('extensions.addonCreatedMessage', { name: res.name }))
                setAddons([])
                await loadAddons(true)
            }
        })
    }, [loadAddons, setAddons, t])

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

    useEffect(() => {
        if (!mergedAddons.length) return

        const preloadTargets = selectedAddon
            ? [selectedAddon, ...mergedAddons.filter(addon => addon.directoryName !== selectedAddon.directoryName).slice(0, 7)]
            : mergedAddons.slice(0, 8)

        const timeoutId = window.setTimeout(() => {
            preloadTargets.forEach(addon => {
                void preloadAddonFiles(addon)
            })
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [mergedAddons, selectedAddon])

    const whitelistedAddonNames = useMemo(() => {
        return new Set(addonWhitelist.map(addon => addon.name.toLowerCase()))
    }, [addonWhitelist])

    const isAddonWhitelisted = useCallback(
        (addon: Addon) => {
            const name = addon.name.toLowerCase()
            const directoryName = addon.directoryName.toLowerCase()
            return whitelistedAddonNames.has(name) || whitelistedAddonNames.has(directoryName)
        },
        [whitelistedAddonNames],
    )

    const isAddonVersionSupported = useCallback(
        (addon: Addon, version: string | undefined | null) => {
            if (isAddonWhitelisted(addon)) {
                return true
            }
            if (!version) {
                return false
            }
            return addon.supportedVersions?.some(range => semver.valid(version) && semver.satisfies(version, range)) ?? false
        },
        [isAddonWhitelisted],
    )

    function ThemeNotFound({ hasAnyAddons }: { hasAnyAddons: boolean }) {
        return (
            <div className={extensionStylesV2.notFound}>
                <h2>{hasAnyAddons ? t('extensions.notFound.titleFiltered') : t('extensions.notFound.titleEmpty')}</h2>
                <p>{hasAnyAddons ? t('extensions.notFound.filteredDescription') : t('extensions.notFound.emptyDescription')}</p>
                <a href="https://discord.gg/qy42uGTzRy" target="_blank" rel="noopener noreferrer">
                    {t('extensions.notFound.discordLink')}
                </a>
            </div>
        )
    }

    const getAddonModalText = useCallback(
        (addon: Addon, musicVersion: string | undefined) => {
            const supported = addon.supportedVersions ? addon.supportedVersions.join(', ') : t('extensions.supportedVersionsUnknown')

            const isSupported = isAddonVersionSupported(addon, musicVersion)
            const minSupported = addon.supportedVersions?.[0]
            if (musicVersion && minSupported && !isSupported) {
                return t('extensions.supportedVersionsWarning', { supported, musicVersion })
            }
            return t('extensions.supportedVersionsInfo', { supported })
        },
        [isAddonVersionSupported, t],
    )

    const handleEnableAddon = useCallback(
        (addon: Addon) => {
            const isSupported = isAddonVersionSupported(addon, musicVersion)
            if (musicVersion && addon.supportedVersions?.length && !isSupported) {
                setModalAddon(addon)
                setModalOpen(true)
                return
            }
            handleCheckboxChange(
                addon,
                !(addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)),
                true,
            )
        },
        [currentTheme, enabledScripts, handleCheckboxChange, isAddonVersionSupported, musicVersion],
    )

    return (
        <PageLayout title={t('extensions.pageTitle')}>
            <CustomModalPS
                isOpen={modalOpen}
                onClose={() => {
                    setModalOpen(false)
                    setModalAddon(null)
                }}
                title={t('extensions.confirmTitle')}
                text={modalAddon ? getAddonModalText(modalAddon, musicVersion) : ''}
                subText={t('extensions.versionLabel', { version: musicVersion || t('common.notAvailable') })}
                buttons={[
                    {
                        text: t('extensions.enableAnyway'),
                        onClick: () => {
                            if (modalAddon) {
                                handleCheckboxChange(
                                    modalAddon,
                                    !(modalAddon.type === 'theme'
                                        ? modalAddon.directoryName === currentTheme
                                        : enabledScripts.includes(modalAddon.directoryName)),
                                    true,
                                )
                            }
                            setModalOpen(false)
                            setModalAddon(null)
                        },
                        variant: 'danger',
                    },
                    {
                        text: t('common.cancel'),
                        onClick: () => {
                            setModalOpen(false)
                            setModalAddon(null)
                        },
                        variant: 'secondary',
                    },
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
                                placeholder={t('extensions.searchPlaceholder')}
                                value={searchQuery}
                                onChange={handleSearchChange}
                                className={extensionStylesV2.searchInput}
                            />
                            <button
                                ref={filterButtonRef}
                                className={extensionStylesV2.filterButton}
                                style={showFilters ? { background: '#98FFD6', color: '#181818' } : undefined}
                                onClick={toggleFilterPanel}
                                aria-label={t('extensions.filtersLabel')}
                            >
                                <MdFilterList />
                                {(() => {
                                    const activeFiltersCount =
                                        (type !== 'all' ? 1 : 0) + (sort !== 'type' ? 1 : 0) + selectedTags.size + selectedCreators.size
                                    return activeFiltersCount > 0 ? (
                                        <div className={extensionStylesV2.count}>{activeFiltersCount > 9 ? '9+' : activeFiltersCount}</div>
                                    ) : null
                                })()}
                            </button>
                        </div>
                        <button
                            ref={optionButtonRef}
                            className={`${extensionStylesV2.optionsButton} ${optionMenu ? extensionStylesV2.optionsButtonActive : ''}`}
                            style={optionMenu ? { background: '#98FFD6', color: '#181818' } : undefined}
                            onClick={toggleOptionMenu}
                            aria-label={t('extensions.optionsLabel')}
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
                                            if (
                                                addon.type === 'theme'
                                                    ? addon.directoryName === currentTheme
                                                    : enabledScripts.includes(addon.directoryName)
                                            ) {
                                                handleCheckboxChange(addon, false, true)
                                            } else {
                                                handleEnableAddon(addon)
                                            }
                                        }}
                                    >
                                        <MdCheckCircle size={18} />
                                    </div>
                                    <img
                                        src={getImagePath(addon)}
                                        alt={addon.name}
                                        className={extensionStylesV2.addonImage}
                                        loading="lazy"
                                        onError={event => {
                                            event.currentTarget.src = fallbackAddonImage
                                        }}
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
                                <div className={extensionStylesV2.noResults}>{t('extensions.noResults')}</div>
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
                                        src={getImagePath(addon)}
                                        alt={addon.name}
                                        className={extensionStylesV2.addonImage}
                                        loading="lazy"
                                        onError={event => {
                                            event.currentTarget.src = fallbackAddonImage
                                        }}
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
                        <Loader text={t('extensions.analyzingAddons')} />
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
                                    handleCheckboxChange(selectedAddon, false, true)
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
        </PageLayout>
    )
}
