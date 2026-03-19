import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'

import userContext from '@entities/user/model/context'
import Addon from '@entities/addon/model/addon.interface'
import { AddonWhitelistItem } from '@entities/addon/model/addonWhitelist.interface'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'

import toast from '@shared/ui/toast'

import PageLayout from '@widgets/layout/PageLayout'
import Loader from '@shared/ui/PSUI/Loader'

import ExtensionView from '@pages/extension/route/extensionview'
import { clearAddonFilesCache, preloadAddonFiles } from '@pages/extension/route/extBox/hooks'
import {
    buildAddonImagePath,
    checkAddonVersionSupported,
    createWhitelistedAddonNames,
    defaultOrder,
    filterAndSortAddons,
    getUniqueAddonCreators,
    getUniqueAddonTags,
    safeStoreGet,
    SortKey,
    useDebouncedValue,
} from '@pages/extension/model/addonCatalog'
import ExtensionSidebar from '@pages/extension/ui/ExtensionSidebar'
import EnableAddonModal from '@pages/extension/ui/EnableAddonModal'
import ThemeNotFound from '@pages/extension/ui/ThemeNotFound'

import * as extensionStylesV2 from '@pages/extension/extension.module.scss'
import addonInitials from '@entities/addon/model/addon.initials'

import MainEvents from '@common/types/mainEvents'
import { staticAsset } from '@shared/lib/staticAssets'
import apolloClient from '@shared/api/apolloClient'
import GetAddonWhitelistQuery from '@entities/addon/api/getAddonWhitelist.query'
import { useTranslation } from 'react-i18next'
import { fetchOwnStoreAddons, submitAddonForStore } from '@entities/addon/api/storeAddons'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'

export default function ExtensionPage() {
    const { t } = useTranslation()
    const { addons, setAddons, musicVersion, user } = useContext(userContext)
    const { isExperimentEnabled } = useExperiments()
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
    const [storePublications, setStorePublications] = useState<StoreAddon[]>([])
    const [publicationBusy, setPublicationBusy] = useState(false)

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

    const refreshOwnPublications = useCallback(async () => {
        if (!user?.id || user.id === '-1') {
            setStorePublications([])
            return
        }

        try {
            const ownAddons = await fetchOwnStoreAddons()
            setStorePublications(ownAddons)
        } catch (error) {
            console.error('[ExtensionPage] failed to load own store addons', error)
            setStorePublications([])
        }
    }, [user?.id])

    useEffect(() => {
        void refreshOwnPublications()
    }, [refreshOwnPublications])

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

    const uniqueTags = useMemo(() => getUniqueAddonTags(addons), [addons])
    const uniqueCreators = useMemo(() => getUniqueAddonCreators(addons), [addons])

    const mergedAddons = useMemo(
        () =>
            filterAndSortAddons({
                addons,
                type,
                selectedTags,
                selectedCreators,
                searchQuery: debouncedSearchQuery,
                sort,
                sortOrder,
            }),
        [addons, debouncedSearchQuery, selectedCreators, selectedTags, sort, sortOrder, type],
    )

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
        if (!matched) return

        setSelectedAddonId(prevSelectedAddonId => {
            if (prevSelectedAddonId === matched.directoryName) return prevSelectedAddonId
            return matched.directoryName
        })
    }, [mergedAddons, requestedAddonId])

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

    const getImagePath = useCallback((addon: Addon) => buildAddonImagePath(addon, fallbackAddonImage), [fallbackAddonImage])

    const handleReloadAddons = useCallback(async () => {
        try {
            clearAddonFilesCache()
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

    const selectedAddonAuthors = useMemo(() => {
        if (!selectedAddon) return []
        if (typeof selectedAddon.author === 'string') {
            return selectedAddon.author
                .split(',')
                .map(name => name.trim())
                .filter(Boolean)
        }
        return selectedAddon.author.map(name => String(name).trim()).filter(Boolean)
    }, [selectedAddon])

    const storePublishingEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientExtensionStorePublishing, true)

    const canManagePublication = useMemo(() => {
        if (!storePublishingEnabled || !selectedAddon || !user) return false

        const me = [user.username, user.nickname]
            .map(value => String(value || '').trim().toLowerCase())
            .filter(Boolean)

        if (!me.length) return false

        return selectedAddonAuthors.some(authorName => me.includes(authorName.toLowerCase()))
    }, [selectedAddon, selectedAddonAuthors, storePublishingEnabled, user])

    const selectedPublication = useMemo(() => {
        if (!selectedAddon) return null

        const addonName = selectedAddon.name.trim().toLowerCase()
        const exactVersion = selectedAddon.version?.trim().toLowerCase()

        const sameName = storePublications.filter(item => item.name.trim().toLowerCase() === addonName)
        if (!sameName.length) return null

        return (
            sameName.find(item => item.version.trim().toLowerCase() === exactVersion) ||
            sameName.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
        )
    }, [selectedAddon, storePublications])

    const handleSubmitAddon = useCallback(
        async (mode: 'create' | 'update') => {
            if (!selectedAddon || !storePublishingEnabled) return

            setPublicationBusy(true)
            try {
                await submitAddonForStore(selectedAddon, mode === 'update' ? selectedPublication?.id : undefined)
                await refreshOwnPublications()
                toast.custom(
                    'success',
                    t('extensions.publication.successTitle'),
                    mode === 'update' ? t('extensions.publication.updateSuccess') : t('extensions.publication.publishSuccess'),
                )
            } catch (error) {
                console.error('[ExtensionPage] failed to submit addon', error)
                toast.custom(
                    'error',
                    t('common.errorTitle'),
                    mode === 'update' ? t('extensions.publication.updateError') : t('extensions.publication.publishError'),
                )
            } finally {
                setPublicationBusy(false)
            }
        },
        [refreshOwnPublications, selectedAddon, selectedPublication?.id, storePublishingEnabled, t],
    )

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

    const whitelistedAddonNames = useMemo(() => createWhitelistedAddonNames(addonWhitelist), [addonWhitelist])

    const isAddonVersionSupported = useCallback(
        (addon: Addon, version: string | undefined | null) => {
            return checkAddonVersionSupported(addon, version, whitelistedAddonNames)
        },
        [whitelistedAddonNames],
    )

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
            <EnableAddonModal
                addon={modalAddon}
                isOpen={modalOpen}
                musicVersion={musicVersion}
                onClose={() => {
                    setModalOpen(false)
                    setModalAddon(null)
                }}
                onConfirm={addon => {
                    handleCheckboxChange(
                        addon,
                        !(addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)),
                        true,
                    )
                }}
                getAddonModalText={getAddonModalText}
            />
            <div className={extensionStylesV2.container}>
                <ExtensionSidebar
                    containerRef={containerRef}
                    currentTheme={currentTheme}
                    disabledAddons={disabledAddons}
                    enabledAddons={enabledAddons}
                    enabledScripts={enabledScripts}
                    fallbackAddonImage={fallbackAddonImage}
                    filterButtonRef={filterButtonRef}
                    getImagePath={getImagePath}
                    onAddonClick={handleAddonClick}
                    onCreateNewAddon={handleCreateNewAddon}
                    onDisableAddon={addon => handleCheckboxChange(addon, false, true)}
                    onEnableAddon={handleEnableAddon}
                    onOpenAddonsDirectory={handleOpenAddonsDirectory}
                    onReloadAddons={handleReloadAddons}
                    onSearchChange={handleSearchChange}
                    onSortChange={handleSortChange}
                    onToggleCreator={creator => toggleSet(selectedCreators, creator, setSelectedCreators)}
                    onToggleFilters={toggleFilterPanel}
                    onToggleOptionMenu={toggleOptionMenu}
                    onToggleTag={tag => toggleSet(selectedTags, tag, setSelectedTags)}
                    optionButtonRef={optionButtonRef}
                    optionMenu={optionMenu}
                    searchQuery={searchQuery}
                    selectedAddon={selectedAddon}
                    selectedCreators={selectedCreators}
                    selectedTags={selectedTags}
                    setSelectedCreators={setSelectedCreators}
                    setSelectedTags={setSelectedTags}
                    setSortOrder={setSortOrder}
                    setType={setType}
                    showFilters={showFilters}
                    sort={sort}
                    sortOrder={sortOrder}
                    t={t}
                    type={type}
                    uniqueCreators={uniqueCreators}
                    uniqueTags={uniqueTags}
                />
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
                            publication={selectedPublication}
                            canManagePublication={canManagePublication}
                            publicationBusy={publicationBusy}
                            onPublishAddon={() => {
                                void handleSubmitAddon('create')
                            }}
                            onUpdateAddon={() => {
                                void handleSubmitAddon('update')
                            }}
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
