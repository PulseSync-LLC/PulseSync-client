import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'

import userContext from '@entities/user/model/context'
import Addon from '@entities/addon/model/addon.interface'
import { AddonWhitelistItem } from '@entities/addon/model/addonWhitelist.interface'
import { normalizeStoreAddonChangelogMarkdown } from '@entities/addon/lib/storeAddonChangelog'
import type { StoreAddon, StoreAddonsPayload } from '@entities/addon/model/storeAddon.interface'
import { buildStoreAddonMetrics } from '@entities/addon/lib/storeAddonMetrics'

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
    isAddonWhitelisted,
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
import GetStoreAddonsQuery from '@entities/addon/api/getStoreAddons.query'
import { useTranslation } from 'react-i18next'
import { AddonStoreSubmitError, fetchOwnStoreAddons, persistAddonStoreLink, submitAddonForStore } from '@entities/addon/api/storeAddons'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import { compareVersions } from '@shared/lib/utils'
import { useModalContext } from '@app/providers/modal'
import OutgoingGatewayEvents from '@shared/api/socket/enums/outgoingGatewayEvents'

type StoreAddonsQuery = {
    getStoreAddons: StoreAddonsPayload
}

const REPUBLISH_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000
const getUntrustedAddonWarningKey = (addon: Addon) => `untrusted-addon-warning:${encodeURIComponent(addon.directoryName)}`

function normalizeChangelogInput(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function isGithubUrl(value: string): boolean {
    const trimmed = value.trim()
    if (!trimmed) return false

    try {
        const url = new URL(trimmed)
        return (url.protocol === 'http:' || url.protocol === 'https:') && ['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())
    } catch {
        return false
    }
}

function readEnabledScriptsState(): string[] {
    const rawValue = safeStoreGet<string[] | string>('addons.scripts', [])

    if (typeof rawValue === 'string') {
        return rawValue
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean)
    }

    return Array.isArray(rawValue) ? rawValue.map(entry => String(entry || '').trim()).filter(Boolean) : []
}

function buildEnabledAddonKeys(theme: string, scripts: string[]): Set<string> {
    const next = new Set<string>()

    if (theme && theme !== 'Default') {
        next.add(theme)
    }

    scripts.forEach(script => {
        if (script) {
            next.add(script)
        }
    })

    return next
}

export default function ExtensionPage() {
    const { i18n, t } = useTranslation()
    const { addons, setAddons, musicVersion, user, emitGateway } = useContext(userContext)
    const { isExperimentEnabled } = useExperiments()
    const { Modals, openModal, isModalOpen, setModalState } = useModalContext()
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
    const [storeCatalog, setStoreCatalog] = useState<StoreAddon[]>([])
    const addonRelationsEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientAddonRelations, false)
    const [storeCatalogLoaded, setStoreCatalogLoaded] = useState(false)
    const [publicationBusy, setPublicationBusy] = useState(false)
    const [publicationChangelogText, setPublicationChangelogText] = useState('')
    const [publicationGithubUrlText, setPublicationGithubUrlText] = useState('')
    const [storeUpdateBusy, setStoreUpdateBusy] = useState(false)

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
        let active = true

        const loadStoreCatalog = async () => {
            try {
                const response = await apolloClient.query<StoreAddonsQuery>({
                    query: GetStoreAddonsQuery,
                    variables: {
                        page: 1,
                        pageSize: 100,
                    },
                    fetchPolicy: 'no-cache',
                })

                if (!active) return
                setStoreCatalog(Array.isArray(response.data?.getStoreAddons?.addons) ? response.data.getStoreAddons.addons : [])
            } catch (error) {
                console.error('[ExtensionPage] failed to load store catalog', error)
                if (active) {
                    setStoreCatalog([])
                }
            } finally {
                if (active) {
                    setStoreCatalogLoaded(true)
                }
            }
        }

        void loadStoreCatalog()

        return () => {
            active = false
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
        async (force = false): Promise<Addon[]> => {
            try {
                const result = await window.desktopEvents?.invoke(MainEvents.GET_ADDONS, { force })
                const fetchedAddons: Addon[] = Array.isArray(result) ? result : []
                const filtered = fetchedAddons.filter(a => a.name !== 'Default')
                setAddons(filtered)
                const themeFromStore = safeStoreGet<string>('addons.theme', 'Default') || 'Default'
                setCurrentTheme(themeFromStore)
                setEnabledScripts(readEnabledScriptsState())
                return filtered
            } catch (error) {
                console.error(t('extensions.loadError'), error)
                throw error
            }
        },
        [setAddons, t],
    )

    const sendStoreAddonMetrics = useCallback(
        (nextTheme: string, nextEnabledScripts: string[]) => {
            const metrics = buildStoreAddonMetrics(addons, nextTheme, nextEnabledScripts)
            console.log('[AddonMetrics] send on addon toggle', metrics)
            emitGateway(OutgoingGatewayEvents.SEND_METRICS, {
                addons: metrics,
            })
        },
        [addons, emitGateway],
    )

    const relationLabels = useMemo(() => {
        const labels: Record<string, string> = {}

        addons.forEach(addon => {
            const ids = [addon.id, addon.storeAddonId].map(value => String(value || '').trim()).filter(Boolean)
            ids.forEach(id => {
                labels[id] = addon.name
            })
        })

        storeCatalog.forEach(addon => {
            const storeId = String(addon.id || '').trim()
            if (storeId && !labels[storeId]) {
                labels[storeId] = addon.name
            }
        })

        return labels
    }, [addons, storeCatalog])

    const installedRelationAddons = useMemo(() => {
        const entries = new Map<string, Addon>()

        addons.forEach(addon => {
            const ids = [addon.id, addon.storeAddonId].map(value => String(value || '').trim()).filter(Boolean)
            ids.forEach(id => entries.set(id, addon))
        })

        return entries
    }, [addons])

    const getMissingDependencyLabels = useCallback(
        (addon: Addon): string[] => {
            const dependencyIds = Array.isArray(addon.dependencies) ? addon.dependencies.map(value => String(value || '').trim()).filter(Boolean) : []

            return dependencyIds
                .filter(dependencyId => {
                    const dependencyAddon = installedRelationAddons.get(dependencyId)
                    if (!dependencyAddon) {
                        return true
                    }

                    return addon.type === 'theme' && dependencyAddon.type === 'theme' && dependencyAddon.directoryName !== addon.directoryName
                })
                .map(dependencyId => relationLabels[dependencyId] || dependencyId)
        },
        [installedRelationAddons, relationLabels],
    )

    const getActiveConflictLabels = useCallback((addon: Addon, availableAddons: Addon[] = addons): string[] => {
        const addonConflictIds = new Set(
            Array.isArray(addon.conflictsWith) ? addon.conflictsWith.map(value => String(value || '').trim()).filter(Boolean) : [],
        )
        const addonIdentifiers = new Set([addon.id, addon.storeAddonId].map(value => String(value || '').trim()).filter(Boolean))

        return availableAddons
            .filter(candidate => {
                if (!candidate.enabled || candidate.directoryName === addon.directoryName) {
                    return false
                }

                const candidateIdentifiers = [candidate.id, candidate.storeAddonId].map(value => String(value || '').trim()).filter(Boolean)
                const candidateConflictIds = Array.isArray(candidate.conflictsWith) ?
                        candidate.conflictsWith.map(value => String(value || '').trim()).filter(Boolean)
                    :   []

                return (
                    candidateIdentifiers.some(identifier => addonConflictIds.has(identifier)) ||
                    candidateConflictIds.some(conflictId => addonIdentifiers.has(conflictId))
                )
            })
            .map(candidate => candidate.name)
    }, [addons])

    const getDependentAddonLabels = useCallback((addon: Addon, availableAddons: Addon[] = addons): string[] => {
        const addonIdentifiers = new Set(
            [addon.directoryName, addon.name, addon.id, addon.storeAddonId]
                .map(value => String(value || '').trim())
                .filter(Boolean)
                .flatMap(value => [value, value.toLowerCase()]),
        )

        return availableAddons
            .filter(candidate => {
                if (!candidate.enabled || candidate.directoryName === addon.directoryName) {
                    return false
                }

                return (candidate.dependencies || [])
                    .map(value => String(value || '').trim())
                    .filter(Boolean)
                    .some(dependencyId => addonIdentifiers.has(dependencyId) || addonIdentifiers.has(dependencyId.toLowerCase()))
            })
            .map(candidate => candidate.name)
    }, [addons])

    const handleCheckboxChange = useCallback(
        async (addon: Addon, newChecked: boolean, showToast: boolean = true) => {
            const previousTheme = currentTheme || 'Default'
            const previousScripts = [...enabledScripts]
            const previousEnabledKeys = buildEnabledAddonKeys(previousTheme, previousScripts)

            if (addon.type === 'theme') {
                if (newChecked) {
                    window.electron.store.set('addons.theme', addon.directoryName)
                } else {
                    window.electron.store.set('addons.theme', 'Default')
                }
            } else {
                const updated = newChecked ? [...enabledScripts, addon.directoryName] : enabledScripts.filter(name => name !== addon.directoryName)
                window.electron.store.set('addons.scripts', updated)
            }

            window.desktopEvents?.send(MainEvents.REFRESH_EXTENSIONS)
            const refreshedAddons = await loadAddons(true)
            const nextTheme = safeStoreGet<string>('addons.theme', 'Default') || 'Default'
            const nextEnabledScripts = readEnabledScriptsState()
            const nextEnabledKeys = buildEnabledAddonKeys(nextTheme, nextEnabledScripts)
            const resolvedEnabled =
                addon.type === 'theme' ? nextTheme === addon.directoryName : nextEnabledScripts.includes(addon.directoryName)
            const nextThemeAddon =
                nextTheme === 'Default' ? addonInitials[0] : refreshedAddons.find(item => item.type === 'theme' && item.directoryName === nextTheme) || addonInitials[0]

            if (previousTheme !== nextTheme) {
                window.desktopEvents?.send(MainEvents.THEME_CHANGED, nextThemeAddon)
            }
            sendStoreAddonMetrics(nextTheme, nextEnabledScripts)

            if (showToast) {
                const autoEnabled = Array.from(nextEnabledKeys).filter(key => !previousEnabledKeys.has(key) && key !== addon.directoryName)
                const autoDisabled = Array.from(previousEnabledKeys).filter(key => !nextEnabledKeys.has(key) && key !== addon.directoryName)
                const disabledAddonIdentifiers = new Set(
                    [addon.directoryName, addon.name, addon.id, addon.storeAddonId]
                        .map(value => String(value || '').trim())
                        .filter(Boolean)
                        .flatMap(value => [value, value.toLowerCase()]),
                )
                const autoDisabledAddons = addons.filter(candidate => autoDisabled.includes(candidate.directoryName))
                const dependentAutoDisabledAddons = !newChecked ?
                        autoDisabledAddons.filter(candidate =>
                            (candidate.dependencies || [])
                                .map(value => String(value || '').trim())
                                .filter(Boolean)
                                .some(dependencyId => disabledAddonIdentifiers.has(dependencyId) || disabledAddonIdentifiers.has(dependencyId.toLowerCase())),
                        )
                    :   []
                const dependentAutoDisabledKeys = new Set(dependentAutoDisabledAddons.map(candidate => candidate.directoryName))
                const remainingAutoDisabledLabels = autoDisabled
                    .filter(key => !dependentAutoDisabledKeys.has(key))
                    .map(key => relationLabels[key] || key)
                const relationMessages =
                    addonRelationsEnabled ?
                        [
                            autoEnabled.length ?
                                t('extensions.relations.autoEnabled', {
                                    value: autoEnabled.map(key => relationLabels[key] || key).join(', '),
                                })
                            :   '',
                            dependentAutoDisabledAddons.length ?
                                t('extensions.relations.autoDisabledDependents', {
                                    dependency: addon.name,
                                    value: dependentAutoDisabledAddons.map(item => item.name).join(', '),
                                })
                            :   '',
                            remainingAutoDisabledLabels.length ?
                                t('extensions.relations.autoDisabled', {
                                    value: remainingAutoDisabledLabels.join(', '),
                                })
                            :   '',
                        ].filter(Boolean)
                    :   []
                const toastId = `addon-toggle:${addon.directoryName}:${newChecked ? 'enable' : 'disable'}`

                if (newChecked && !resolvedEnabled) {
                    const missingDependencyLabels = addonRelationsEnabled ? getMissingDependencyLabels(addon) : []
                    const activeConflictLabels = addonRelationsEnabled ? getActiveConflictLabels(addon, refreshedAddons) : []
                    const blockingMessages = [
                        missingDependencyLabels.length ?
                            t('extensions.relations.blockedByDependencies', {
                                value: missingDependencyLabels.join(', '),
                            })
                        :   '',
                        activeConflictLabels.length ?
                            t('extensions.relations.blockedByConflicts', {
                                value: activeConflictLabels.join(', '),
                            })
                        :   '',
                    ].filter(Boolean)

                    toast.custom(
                        'error',
                        t('common.errorTitle'),
                        [
                            t('extensions.relations.enableBlockedResolved', { name: addon.name }),
                            ...blockingMessages,
                            ...relationMessages,
                        ].join('\n'),
                        { id: toastId },
                    )
                } else if (!newChecked && resolvedEnabled) {
                    const dependentAddonLabels = addonRelationsEnabled ? getDependentAddonLabels(addon, refreshedAddons) : []
                    const blockingMessages = [
                        dependentAddonLabels.length ?
                            t('extensions.relations.disableBlockedByDependents', {
                                value: dependentAddonLabels.join(', '),
                            })
                        :   t('extensions.relations.disableBlockedResolved', { name: addon.name }),
                        ...relationMessages,
                    ].filter(Boolean)

                    toast.custom('error', t('common.errorTitle'), blockingMessages.join('\n'), { id: toastId })
                } else if (addon.type === 'theme') {
                    toast.custom(
                        newChecked ? 'success' : 'info',
                        newChecked ? t('extensions.themeActivated') : t('extensions.themeDeactivated'),
                        [
                            newChecked ? t('extensions.themeActivatedMessage', { name: addon.name }) : t('extensions.themeDeactivatedMessage'),
                            ...relationMessages,
                        ].join('\n'),
                        { id: toastId },
                    )
                } else {
                    toast.custom(
                        newChecked ? 'success' : 'info',
                        newChecked ? t('extensions.scriptEnabled') : t('extensions.scriptDisabled'),
                        [
                            newChecked ?
                                t('extensions.scriptEnabledMessage', { name: addon.name })
                            :   t('extensions.scriptDisabledMessage', { name: addon.name }),
                            ...relationMessages,
                        ].join('\n'),
                        { id: toastId },
                    )
                }
            }
        },
        [addonRelationsEnabled, currentTheme, enabledScripts, getActiveConflictLabels, getDependentAddonLabels, getMissingDependencyLabels, loadAddons, relationLabels, sendStoreAddonMetrics, t],
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
                return
            }

            if (!res?.canceled) {
                toast.custom('error', t('common.oopsTitle'), res?.error || t('extensions.addonCreateFailed'))
            }
        })
    }, [t])

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

    const selectedAddonMissingDependencies = useMemo(
        () => (selectedAddon && addonRelationsEnabled ? getMissingDependencyLabels(selectedAddon) : []),
        [addonRelationsEnabled, getMissingDependencyLabels, selectedAddon],
    )

    const selectedAddonEnableBlockedReason = useMemo(
        () =>
            selectedAddonMissingDependencies.length ?
                t('extensions.relations.enableBlockedHintMissing', {
                    value: selectedAddonMissingDependencies.join(', '),
                })
            :   null,
        [selectedAddonMissingDependencies, t],
    )

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

    const storePublishingEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientExtensionStorePublishing, false)

    const canManagePublication = useMemo(() => {
        if (!storePublishingEnabled || !selectedAddon || !user) return false

        const me = [user.username, user.nickname]
            .map(value =>
                String(value || '')
                    .trim()
                    .toLowerCase(),
            )
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
            sameName.find(item => item.currentRelease?.version.trim().toLowerCase() === exactVersion) ||
            sameName.sort(
                (a, b) =>
                    new Date(b.currentRelease?.updatedAt || b.updatedAt).getTime() - new Date(a.currentRelease?.updatedAt || a.updatedAt).getTime(),
            )[0]
        )
    }, [selectedAddon, storePublications])

    const selectedStoreUpdate = useMemo(() => {
        if (!selectedAddon || selectedAddon.installSource !== 'store' || !selectedAddon.storeAddonId) {
            return null
        }

        const publishedAddon = storeCatalog.find(item => item.id === selectedAddon.storeAddonId)
        if (!publishedAddon?.currentRelease) {
            return null
        }

        return compareVersions(publishedAddon.currentRelease.version, selectedAddon.version) > 0 ? publishedAddon : null
    }, [selectedAddon, storeCatalog])

    const selectedPublishedAddon = useMemo(() => {
        if (!selectedAddon) {
            return null
        }

        if (selectedAddon.installSource === 'store' && selectedAddon.storeAddonId) {
            return storeCatalog.find(item => item.id === selectedAddon.storeAddonId) ?? null
        }

        return selectedPublication
    }, [selectedAddon, selectedPublication, storeCatalog])

    const visiblePublicationReleases = useMemo(() => {
        if (!selectedAddon || selectedAddon.installSource !== 'store' || !selectedAddon.storeAddonId) {
            return []
        }

        return selectedPublishedAddon?.releases ?? []
    }, [selectedAddon, selectedPublishedAddon])

    const isPublicationModalOpen = isModalOpen(Modals.EXTENSION_PUBLICATION_MODAL)

    useEffect(() => {
        setPublicationChangelogText(normalizeStoreAddonChangelogMarkdown(selectedPublishedAddon?.currentRelease?.changelog))
    }, [
        selectedAddon?.directoryName,
        selectedPublishedAddon?.id,
        selectedPublishedAddon?.currentRelease?.id,
        selectedPublishedAddon?.currentRelease?.updatedAt,
    ])

    useEffect(() => {
        setPublicationGithubUrlText(selectedPublishedAddon?.currentRelease?.githubUrl || '')
    }, [
        selectedAddon?.directoryName,
        selectedPublishedAddon?.id,
        selectedPublishedAddon?.currentRelease?.id,
        selectedPublishedAddon?.currentRelease?.githubUrl,
    ])

    useEffect(() => {
        if (!isPublicationModalOpen) {
            return
        }

        setModalState(Modals.EXTENSION_PUBLICATION_MODAL, {
            publication: selectedPublication ?? null,
            publicationBusy,
            githubUrlText: publicationGithubUrlText,
        })
    }, [Modals.EXTENSION_PUBLICATION_MODAL, isPublicationModalOpen, publicationBusy, publicationGithubUrlText, selectedPublication, setModalState])

    const publicationActionMode = useMemo<'publish' | 'update' | 'none'>(() => {
        if (!selectedAddon) {
            return 'none'
        }

        if (!selectedPublication) {
            return 'publish'
        }

        const localVersion = selectedAddon.version?.trim().toLowerCase()
        const publishedVersion = selectedPublication.currentRelease?.version?.trim().toLowerCase()

        if (selectedPublication.currentRelease?.status === 'rejected') {
            const rejectedAt = new Date(selectedPublication.currentRelease.updatedAt).getTime()
            if (Number.isFinite(rejectedAt) && Date.now() < rejectedAt + REPUBLISH_COOLDOWN_MS) {
                return 'none'
            }

            return localVersion && publishedVersion && localVersion !== publishedVersion ? 'update' : 'publish'
        }

        if (localVersion && publishedVersion && localVersion !== publishedVersion) {
            return 'update'
        }

        return 'none'
    }, [selectedAddon, selectedPublication])

    const handleSubmitAddon = useCallback(
        async (mode: 'create' | 'update', changelogTextOverride?: string, githubUrlOverride?: string, usedAiDuringDevelopmentOverride?: boolean) => {
            if (!selectedAddon || !storePublishingEnabled) return

            const changelog = normalizeChangelogInput(changelogTextOverride ?? publicationChangelogText)
            if (!changelog) {
                toast.custom('error', t('common.errorTitle'), t('extensions.publication.changelogRequired'))
                return
            }

            const githubUrl = (githubUrlOverride ?? publicationGithubUrlText).trim()
            const currentGithubUrl = selectedPublication?.currentRelease?.githubUrl?.trim() || ''
            const effectiveGithubUrl = githubUrl || currentGithubUrl
            const usedAiDuringDevelopment = usedAiDuringDevelopmentOverride ?? Boolean(selectedPublication?.currentRelease?.usedAiDuringDevelopment)

            if (mode === 'create' && !effectiveGithubUrl) {
                toast.custom('error', t('common.errorTitle'), t('extensions.publication.githubUrlRequired'))
                return
            }

            if (githubUrl && !isGithubUrl(githubUrl)) {
                toast.custom('error', t('common.errorTitle'), t('extensions.publication.githubUrlInvalid'))
                return
            }

            setPublicationBusy(true)
            try {
                let linkedStoreAddonId = await submitAddonForStore(
                    selectedAddon,
                    changelog,
                    effectiveGithubUrl,
                    usedAiDuringDevelopment,
                    mode === 'update' ? selectedPublication?.id : undefined,
                )
                const ownAddons = await fetchOwnStoreAddons()
                setStorePublications(ownAddons)

                if (!linkedStoreAddonId) {
                    const normalizedAddonName = selectedAddon.name.trim().toLowerCase()
                    linkedStoreAddonId =
                        ownAddons.find(
                            item =>
                                item.type === selectedAddon.type &&
                                item.name.trim().toLowerCase() === normalizedAddonName &&
                                item.currentRelease?.version === selectedAddon.version,
                        )?.id ||
                        ownAddons.find(item => item.type === selectedAddon.type && item.name.trim().toLowerCase() === normalizedAddonName)?.id ||
                        null
                }

                if (linkedStoreAddonId) {
                    await persistAddonStoreLink(selectedAddon, linkedStoreAddonId)
                    await loadAddons(true)
                }

                toast.custom(
                    'success',
                    t('extensions.publication.successTitle'),
                    mode === 'update' ? t('extensions.publication.updateSuccess') : t('extensions.publication.publishSuccess'),
                )
            } catch (error) {
                console.error('[ExtensionPage] failed to submit addon', error)
                const defaultMessage = mode === 'update' ? t('extensions.publication.updateError') : t('extensions.publication.publishError')
                let message = defaultMessage

                if (error instanceof AddonStoreSubmitError) {
                    if (error.code === 'ADDON_REPUBLISH_COOLDOWN_ACTIVE' && error.availableAt) {
                        message = t('extensions.publication.cooldownMessage', {
                            date: new Date(error.availableAt).toLocaleString(i18n.language === 'ru' ? 'ru-RU' : 'en-US'),
                        })
                    } else {
                        const translationKey = `extensions.publication.errors.${error.code}`
                        const translatedMessage = t(translationKey)
                        message = translatedMessage !== translationKey ? translatedMessage : error.message || defaultMessage
                    }
                }

                toast.custom('error', t('common.errorTitle'), message)
            } finally {
                setPublicationBusy(false)
            }
        },
        [
            i18n.language,
            loadAddons,
            publicationChangelogText,
            publicationGithubUrlText,
            selectedAddon,
            selectedPublication?.id,
            storePublishingEnabled,
            t,
        ],
    )

    const handleStoreAddonUpdate = useCallback(async () => {
        if (!selectedAddon || !selectedStoreUpdate || !window.desktopEvents) {
            return
        }

        setStoreUpdateBusy(true)
        const toastId = toast.custom('loading', t('layout.updateAction'), t('common.pleaseWait'))

        try {
            const result = await window.desktopEvents.invoke(MainEvents.INSTALL_STORE_ADDON, {
                id: selectedStoreUpdate.id,
                downloadUrl: selectedStoreUpdate.currentRelease?.downloadUrl,
                title: selectedStoreUpdate.name,
            })

            if (!result?.success) {
                throw new Error(result?.reason || 'STORE_ADDON_UPDATE_FAILED')
            }

            const nextInstalledAddons = await window.desktopEvents.invoke(MainEvents.GET_ADDONS)
            setAddons(Array.isArray(nextInstalledAddons) ? nextInstalledAddons : [])
            toast.custom('success', t('common.doneTitle'), t('extensions.storeUpdateComplete', { name: selectedStoreUpdate.name }), { id: toastId })
        } catch (error) {
            console.error('[ExtensionPage] failed to update store addon', error)
            toast.custom('error', t('common.errorTitle'), t('extensions.storeUpdateFailed', { name: selectedAddon.name }), { id: toastId })
        } finally {
            setStoreUpdateBusy(false)
        }
    }, [selectedAddon, selectedStoreUpdate, setAddons, t])

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
        (addon: Addon, musicVersion: string | null | undefined) => {
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

    const isAddonInStoreCatalog = useCallback(
        (addon: Addon) => {
            const normalizedName = addon.name.trim().toLowerCase()
            return storeCatalog.some(item => item.type === addon.type && item.name.trim().toLowerCase() === normalizedName)
        },
        [storeCatalog],
    )

    const continueEnableAddon = useCallback(
        (addon: Addon) => {
            const missingDependencyLabels = addonRelationsEnabled ? getMissingDependencyLabels(addon) : []
            if (missingDependencyLabels.length) {
                toast.custom(
                    'error',
                    t('common.errorTitle'),
                    t('extensions.relations.enableBlockedMissing', {
                        value: missingDependencyLabels.join(', '),
                    }),
                    { id: `addon-enable-blocked:${addon.directoryName}` },
                )
                return
            }

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
        [addonRelationsEnabled, currentTheme, enabledScripts, getMissingDependencyLabels, handleCheckboxChange, isAddonVersionSupported, musicVersion, t],
    )

    const shouldShowUntrustedAddonWarning = useCallback(
        (addon: Addon) => {
            if (addon.installSource === 'store') return false
            if (!storeCatalogLoaded) return false
            if (isAddonWhitelisted(addon, whitelistedAddonNames)) return false
            if (isAddonInStoreCatalog(addon)) return false
            return window.localStorage.getItem(getUntrustedAddonWarningKey(addon)) !== '1'
        },
        [isAddonInStoreCatalog, storeCatalogLoaded, whitelistedAddonNames],
    )

    const handleEnableAddon = useCallback(
        (addon: Addon) => {
            if (addonRelationsEnabled && getMissingDependencyLabels(addon).length) {
                continueEnableAddon(addon)
                return
            }

            if (shouldShowUntrustedAddonWarning(addon)) {
                openModal(Modals.UNTRUSTED_LOCAL_ADDON_MODAL, {
                    addonName: addon.name,
                    onConfirm: () => {
                        window.localStorage.setItem(getUntrustedAddonWarningKey(addon), '1')
                        continueEnableAddon(addon)
                    },
                })
                return
            }

            continueEnableAddon(addon)
        },
        [Modals.UNTRUSTED_LOCAL_ADDON_MODAL, addonRelationsEnabled, continueEnableAddon, getMissingDependencyLabels, openModal, shouldShowUntrustedAddonWarning],
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
                        <Loader variant="extension" />
                    ) : selectedAddon ? (
                        (() => {
                            const isSelectedAddonEnabled =
                                selectedAddon.type === 'theme'
                                    ? selectedAddon.directoryName === currentTheme
                                    : enabledScripts.includes(selectedAddon.directoryName)

                            return (
                        <ExtensionView
                            addon={selectedAddon}
                            isEnabled={isSelectedAddonEnabled}
                            addonRelationsEnabled={addonRelationsEnabled}
                            enableBlockedReason={!isSelectedAddonEnabled ? selectedAddonEnableBlockedReason : null}
                            relationLabels={relationLabels}
                            hasStoreUpdate={!!selectedStoreUpdate}
                            storeUpdateBusy={storeUpdateBusy}
                            onStoreUpdate={() => {
                                void handleStoreAddonUpdate()
                            }}
                            publication={selectedPublication}
                            publicationReleases={visiblePublicationReleases}
                            publicationChangelogText={publicationChangelogText}
                            publicationGithubUrlText={publicationGithubUrlText}
                            canManagePublication={canManagePublication}
                            publicationBusy={publicationBusy}
                            onPublicationChangelogChange={setPublicationChangelogText}
                            onPublicationGithubUrlChange={setPublicationGithubUrlText}
                            onPublishAddon={
                                publicationActionMode === 'publish'
                                    ? (changelogText, githubUrl, usedAiDuringDevelopment) => {
                                          void handleSubmitAddon('create', changelogText, githubUrl, usedAiDuringDevelopment)
                                      }
                                    : undefined
                            }
                            onUpdateAddon={
                                publicationActionMode === 'update'
                                    ? (changelogText, githubUrl, usedAiDuringDevelopment) => {
                                          void handleSubmitAddon('update', changelogText, githubUrl, usedAiDuringDevelopment)
                                      }
                                    : undefined
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
                            )
                        })()
                    ) : (
                        <ThemeNotFound hasAnyAddons={hasAnyInstalled} />
                    )}
                </div>
            </div>
        </PageLayout>
    )
}
