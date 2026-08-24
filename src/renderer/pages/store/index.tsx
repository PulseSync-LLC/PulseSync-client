import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@pulsesync/uikit/data-display'
import { SearchBox } from '@pulsesync/uikit/inputs'
import { DropdownMenu, type DropdownMenuItem, Tab, TabList, Tabs } from '@pulsesync/uikit/navigation'
import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { FaGithub } from 'react-icons/fa'
import {
    MdChevronLeft,
    MdChevronRight,
    MdDataArray,
    MdDownload,
    MdFilterAlt,
    MdInventory2,
    MdLabel,
    MdLanguage,
    MdLightMode,
    MdSchedule,
    MdSort,
    MdSwapVert,
    MdViewModule,
} from 'react-icons/md'
import { useLocation, useNavigate } from 'react-router-dom'

import { useModalContext } from '@app/providers/modal'
import useCarouselDrag from '@pages/store/lib/useCarouselDrag'
import StoreAddonDetailsModal from '@pages/store/ui/StoreAddonDetailsModal'
import PageLayout from '@widgets/layout/PageLayout'
import GetModerationAddonsQuery from '@entities/addon/api/getModerationAddons.query'
import GetNewStoreAddonsQuery from '@entities/addon/api/getNewStoreAddons.query'
import GetOwnStoreAddonsQuery from '@entities/addon/api/getOwnStoreAddons.query'
import GetStoreAddonsQuery from '@entities/addon/api/getStoreAddons.query'
import { fetchStoreAddonUpdates } from '@entities/addon/api/storeAddons'
import UserContext from '@entities/user/model/context'
import apolloClient from '@shared/api/apolloClient'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'
import AddonRatingBadge from '@shared/ui/PSUI/AddonRatingBadge'
import ExtensionCardStore from '@shared/ui/PSUI/ExtensionCardStore'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'
import StoreShimmer from '@shared/ui/PSUI/Shimmer/variants/StoreShimmer'
import toast from '@shared/ui/toast'

import * as st from '@pages/store/store.module.scss'

import type Addon from '@entities/addon/model/addon.interface'
import type { StoreAddon, StoreAddonsPayload } from '@entities/addon/model/storeAddon.interface'

type StoreAddonsQuery = {
    getStoreAddons: StoreAddonsPayload
}

type ModerationAddonsQuery = {
    getModerationAddons: StoreAddon[]
}

type OwnStoreAddonsQuery = {
    getOwnStoreAddons: StoreAddon[]
}

type CatalogTab = 'main' | 'owned' | 'moderation'
type StoreSearchSort = 'downloads' | 'latestRelease' | 'name'
type StoreSearchType = 'all' | StoreAddon['type']

type StoreRouteState = {
    openAddon?: StoreAddon
    openAddonId?: string
}

type AddonRatingSummary = {
    average: number
    count: number
    myRating: number | null
}

const fallbackBanner = staticAsset('assets/images/no_themeBackground.png')

function formatAge(value: string, locale: string): string {
    const timestamp = new Date(value).getTime()
    if (Number.isNaN(timestamp)) return value

    const days = Math.max(0, Math.round((Date.now() - timestamp) / 86_400_000))
    return locale === 'ru' ? `${days}д` : `${days}d`
}

export default function StorePage() {
    const INITIAL_SHIMMER_FADE_MS = 180

    const { t, i18n } = useTranslation()
    const location = useLocation()
    const navigate = useNavigate()
    const { addons: installedAddons, setAddons: setInstalledAddons, user } = useContext(UserContext)
    const { Modals, openModal, setModalState } = useModalContext()
    const [addons, setAddons] = useState<StoreAddon[]>([])
    const [newAddons, setNewAddons] = useState<StoreAddon[]>([])
    const [popularAddons, setPopularAddons] = useState<StoreAddon[]>([])
    const [ownAddons, setOwnAddons] = useState<StoreAddon[]>([])
    const [pendingAddons, setPendingAddons] = useState<StoreAddon[]>([])
    const [catalogTab, setCatalogTab] = useState<CatalogTab>('main')
    const [featuredIndex, setFeaturedIndex] = useState(0)
    const [featuredDirection, setFeaturedDirection] = useState<-1 | 1>(1)
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [searchSort, setSearchSort] = useState<StoreSearchSort>('latestRelease')
    const [searchSortOrder, setSearchSortOrder] = useState<'asc' | 'desc'>('desc')
    const [searchType, setSearchType] = useState<StoreSearchType>('all')
    const [loading, setLoading] = useState(true)
    const [ownAddonsLoading, setOwnAddonsLoading] = useState(true)
    const [installingAddonId, setInstallingAddonId] = useState<string | null>(null)
    const [selectedAddon, setSelectedAddon] = useState<StoreAddon | null>(null)
    const [isInitialShimmerVisible, setIsInitialShimmerVisible] = useState(true)
    const [isInitialShimmerFading, setIsInitialShimmerFading] = useState(false)
    const modalAddonRef = useRef<StoreAddon | null>(null)
    const animationsEnabledRef = useRef(false)
    const shimmerFadeTimeoutRef = useRef<number | null>(null)
    const shimmerFadeRafRef = useRef<number | null>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const newAddonsRef = useRef<HTMLDivElement>(null)
    const isDeveloperUser = user?.perms === 'developer'
    const routeState = location.state as StoreRouteState | null

    useEffect(() => {
        if (selectedAddon) modalAddonRef.current = selectedAddon
    }, [selectedAddon])

    const closeSearch = () => {
        setIsSearchOpen(false)
        setSearchQuery('')
        setDebouncedSearchQuery('')
    }

    const handleCatalogTabChange = (value: string) => {
        closeSearch()
        setCatalogTab(value as CatalogTab)
    }

    const handleRatingChange = useCallback((addonId: string, summary: AddonRatingSummary) => {
        const updateAddon = (addon: StoreAddon): StoreAddon =>
            addon.id === addonId
                ? {
                      ...addon,
                      myRating: summary.myRating,
                      ratingAverage: summary.average,
                      ratingCount: summary.count,
                  }
                : addon

        setAddons(current => current.map(updateAddon))
        setNewAddons(current => current.map(updateAddon))
        setPopularAddons(current => current.map(updateAddon))
        setOwnAddons(current => current.map(updateAddon))
        setPendingAddons(current => current.map(updateAddon))
        setSelectedAddon(current => (current ? updateAddon(current) : current))
    }, [])

    useEffect(() => {
        const requestedAddonId = String(routeState?.openAddon?.id || routeState?.openAddonId || '').trim()
        if (!requestedAddonId) return

        const routeAddon = routeState?.openAddon?.currentRelease
            ? routeState.openAddon
            : [...addons, ...newAddons, ...popularAddons, ...ownAddons, ...pendingAddons].find(addon => addon.id === requestedAddonId)
        const openRouteAddon = (addon: StoreAddon) => {
            setCatalogTab('main')
            setSelectedAddon(addon)
            navigate('/store', { replace: true, state: null })
        }

        if (routeAddon?.currentRelease) {
            openRouteAddon(routeAddon)
            return
        }
        if (loading) return

        let active = true
        void fetchStoreAddonUpdates([requestedAddonId])
            .then(([addon]) => {
                if (active && addon?.currentRelease) openRouteAddon(addon)
            })
            .catch(error => console.error('[Store] failed to open requested addon', error))

        return () => {
            active = false
        }
    }, [addons, loading, navigate, newAddons, ownAddons, pendingAddons, popularAddons, routeState])

    useEffect(() => {
        const timeoutId = window.setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 250)
        return () => window.clearTimeout(timeoutId)
    }, [searchQuery])

    useEffect(() => {
        let active = true

        if (catalogTab !== 'main')
            return () => {
                active = false
            }

        const loadAddons = async () => {
            setLoading(true)
            try {
                const [response, newAddonsResponse, popularAddonsResponse] = await Promise.all([
                    apolloClient.query<StoreAddonsQuery>({
                        query: GetStoreAddonsQuery,
                        variables: {
                            page: 1,
                            pageSize: 50,
                            search: debouncedSearchQuery || undefined,
                            type: (isSearchOpen || debouncedSearchQuery) && searchType !== 'all' ? searchType : undefined,
                            sortBy: isSearchOpen || debouncedSearchQuery ? searchSort : 'latestRelease',
                            sortOrder: isSearchOpen || debouncedSearchQuery ? searchSortOrder : 'desc',
                        },
                        fetchPolicy: 'no-cache',
                    }),
                    apolloClient.query<StoreAddonsQuery>({
                        query: GetNewStoreAddonsQuery,
                        variables: {
                            pageSize: 12,
                            search: debouncedSearchQuery || undefined,
                        },
                        fetchPolicy: 'no-cache',
                    }),
                    apolloClient.query<StoreAddonsQuery>({
                        query: GetStoreAddonsQuery,
                        variables: {
                            page: 1,
                            pageSize: 5,
                            search: debouncedSearchQuery || undefined,
                            sortBy: 'downloads',
                            sortOrder: 'desc',
                        },
                        fetchPolicy: 'no-cache',
                    }),
                ])

                if (!active) return
                setAddons(Array.isArray(response.data?.getStoreAddons?.addons) ? response.data.getStoreAddons.addons : [])
                setNewAddons(
                    (Array.isArray(newAddonsResponse.data?.getStoreAddons?.addons) ? newAddonsResponse.data.getStoreAddons.addons : []).filter(
                        addon => addon.currentRelease?.status === 'accepted',
                    ),
                )
                setPopularAddons(
                    (Array.isArray(popularAddonsResponse.data?.getStoreAddons?.addons)
                        ? popularAddonsResponse.data.getStoreAddons.addons
                        : []
                    ).filter(addon => addon.currentRelease?.status === 'accepted'),
                )
            } catch (error) {
                console.error('[Store] failed to load addons', error)
                if (active) {
                    setAddons([])
                    setNewAddons([])
                    setPopularAddons([])
                }
            } finally {
                if (active) setLoading(false)
            }
        }

        void loadAddons()
        return () => {
            active = false
        }
    }, [catalogTab, debouncedSearchQuery, isSearchOpen, searchSort, searchSortOrder, searchType])

    useEffect(() => {
        let active = true

        if (!user?.id || user.id === '-1') {
            setOwnAddons([])
            setOwnAddonsLoading(false)
            return () => {
                active = false
            }
        }

        const loadOwnAddons = async () => {
            setOwnAddonsLoading(true)
            try {
                const response = await apolloClient.query<OwnStoreAddonsQuery>({
                    query: GetOwnStoreAddonsQuery,
                    fetchPolicy: 'no-cache',
                })

                if (!active) return
                setOwnAddons(Array.isArray(response.data?.getOwnStoreAddons) ? response.data.getOwnStoreAddons : [])
            } catch (error) {
                console.error('[Store] failed to load own addons', error)
                if (active) setOwnAddons([])
            } finally {
                if (active) setOwnAddonsLoading(false)
            }
        }

        void loadOwnAddons()
        return () => {
            active = false
        }
    }, [user?.id])

    useEffect(() => {
        let active = true

        if (!isDeveloperUser || !user?.id || user.id === '-1') {
            setPendingAddons([])
            return () => {
                active = false
            }
        }

        const loadPendingAddons = async () => {
            try {
                const response = await apolloClient.query<ModerationAddonsQuery>({
                    query: GetModerationAddonsQuery,
                    variables: {
                        search: debouncedSearchQuery || undefined,
                        sortBy: 'latestRelease',
                        sortOrder: 'desc',
                        status: 'pending',
                    },
                    fetchPolicy: 'no-cache',
                })

                if (!active) return
                setPendingAddons(
                    (Array.isArray(response.data?.getModerationAddons) ? response.data.getModerationAddons : []).filter(
                        addon => addon.currentRelease?.status === 'pending',
                    ),
                )
            } catch (error) {
                console.error('[Store] failed to load moderation addons', error)
                if (active) setPendingAddons([])
            }
        }

        void loadPendingAddons()
        return () => {
            active = false
        }
    }, [debouncedSearchQuery, isDeveloperUser, user?.id])

    const installedStoreAddons = useMemo(
        () => new Map(installedAddons.filter(addon => addon.storeAddonId).map(addon => [addon.storeAddonId!, addon])),
        [installedAddons],
    )

    const visibleAddons = useMemo(() => {
        const source = catalogTab === 'main' ? addons : catalogTab === 'moderation' ? pendingAddons : ownAddons
        const targetStatus = catalogTab === 'moderation' ? 'pending' : 'accepted'
        let relevantAddons = source.filter(addon => addon.currentRelease?.status === targetStatus)
        const normalizedSearch = debouncedSearchQuery.toLocaleLowerCase()
        if (!normalizedSearch && !isSearchOpen) return relevantAddons

        if (normalizedSearch && catalogTab !== 'main') {
            relevantAddons = relevantAddons.filter(addon => {
                const release = addon.currentRelease
                return [addon.name, release?.description, ...(release?.authors || []), ...(release?.tags || [])]
                    .filter(Boolean)
                    .some(value => value!.toLocaleLowerCase().includes(normalizedSearch))
            })
        }

        if (searchType !== 'all') {
            relevantAddons = relevantAddons.filter(addon => addon.type === searchType)
        }

        const direction = searchSortOrder === 'asc' ? 1 : -1
        return relevantAddons.slice().sort((left, right) => {
            if (searchSort === 'name') return left.name.localeCompare(right.name, i18n.language) * direction
            if (searchSort === 'downloads') return (left.downloadCount - right.downloadCount) * direction

            const leftUpdatedAt = new Date(left.currentRelease?.approvedAt || left.currentRelease?.updatedAt || left.updatedAt).getTime() || 0
            const rightUpdatedAt = new Date(right.currentRelease?.approvedAt || right.currentRelease?.updatedAt || right.updatedAt).getTime() || 0
            return (leftUpdatedAt - rightUpdatedAt) * direction
        })
    }, [addons, catalogTab, debouncedSearchQuery, i18n.language, isSearchOpen, ownAddons, pendingAddons, searchSort, searchSortOrder, searchType])

    const featuredAddons = popularAddons.slice(0, 5)
    const featuredAddon = featuredAddons[featuredIndex] ?? featuredAddons[0] ?? null
    const featuredLeftColor = featuredAddon?.currentRelease?.bannerLeftColor?.trim() || ''
    const featuredRightColor = featuredAddon?.currentRelease?.bannerRightColor?.trim() || ''
    const shouldRenderCards = visibleAddons.length > 0
    const hasSearchOrFilter = Boolean(debouncedSearchQuery)
    const isSearchMode = Boolean(isSearchOpen || searchQuery.trim() || debouncedSearchQuery)
    const isSearchDebouncing = searchQuery.trim() !== debouncedSearchQuery
    const activeLoading = catalogTab === 'main' ? loading : ownAddonsLoading

    const searchFilterItems: DropdownMenuItem[] = [
        {
            key: 'sort',
            label: t('store.filters.sort'),
            icon: <MdSort />,
            children: (['latestRelease', 'name', 'downloads'] as StoreSearchSort[]).map(option => ({
                key: `sort-${option}`,
                label: t(`store.filters.${option}`),
                radio: true,
                checked: searchSort === option,
                onClick: () => setSearchSort(option),
            })),
        },
        {
            key: 'type',
            label: t('store.filters.type'),
            icon: <MdViewModule />,
            children: (['all', 'theme', 'script', 'web-addon'] as StoreSearchType[]).map(option => ({
                key: `type-${option}`,
                label: t(`store.filters.types.${option}`),
                radio: true,
                checked: searchType === option,
                onClick: () => setSearchType(option),
            })),
        },
        {
            key: 'order',
            label: t('store.filters.order'),
            icon: <MdSwapVert />,
            children: (['desc', 'asc'] as const).map(order => ({
                key: `order-${order}`,
                label: t(order === 'asc' ? 'store.filters.orderAsc' : 'store.filters.orderDesc'),
                radio: true,
                checked: searchSortOrder === order,
                onClick: () => setSearchSortOrder(order),
            })),
        },
    ]

    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        if (featuredLeftColor) container.style.setProperty('--catalog-edge-left', featuredLeftColor)
        else container.style.removeProperty('--catalog-edge-left')

        if (featuredRightColor) container.style.setProperty('--catalog-edge-right', featuredRightColor)
        else container.style.removeProperty('--catalog-edge-right')
    }, [featuredLeftColor, featuredRightColor])

    useEffect(() => {
        setFeaturedIndex(current => (featuredAddons.length ? Math.min(current, featuredAddons.length - 1) : 0))
    }, [featuredAddons.length])

    const handleStoreAddonAction = useCallback(
        async (addon: StoreAddon, release: StoreAddon['currentRelease'], installedStoreAddon?: Addon) => {
            if (!release || !addon.id || installingAddonId === addon.id) return

            if (installedStoreAddon) {
                const removeInstalledAddon = async () => {
                    setInstallingAddonId(addon.id)
                    const toastId = toast.custom('loading', t('common.delete'), t('common.pleaseWait'))

                    try {
                        const result = (await desktopApi.addons.deleteDirectory(installedStoreAddon.path)) as {
                            reason?: string
                            success?: boolean
                        }
                        if (!result?.success) throw new Error(result?.reason || 'DELETE_FAILED')

                        const nextInstalledAddons = await desktopApi.addons.list()
                        setInstalledAddons(Array.isArray(nextInstalledAddons) ? nextInstalledAddons : [])
                        toast.custom('success', t('common.doneTitle'), t('store.removeComplete', { title: addon.name }), { id: toastId })
                    } catch (error: any) {
                        toast.custom('error', t('common.errorTitle'), t('store.removeFailed', { title: addon.name }), { id: toastId })
                        console.error('[Store] failed to remove addon', error)
                    } finally {
                        setInstallingAddonId(current => (current === addon.id ? null : current))
                    }
                }

                setModalState(Modals.BASIC_CONFIRMATION, {
                    description: t('store.removeConfirm', { title: addon.name }),
                    confirmLabel: t('modals.basicConfirmation.delete'),
                    confirmVariant: 'danger',
                    onConfirm: () => void removeInstalledAddon(),
                })
                openModal(Modals.BASIC_CONFIRMATION)
                return
            }

            const downloadUrl = release.downloadUrl?.trim()
            if (!downloadUrl) {
                toast.custom('error', t('common.errorTitle'), t('store.installUnavailable', { title: addon.name }))
                return
            }

            setInstallingAddonId(addon.id)
            const toastId = toast.custom('loading', t('common.importTitle'), t('common.pleaseWait'))

            try {
                const result = (await desktopApi.addons.installStore({ id: addon.id, downloadUrl, title: addon.name })) as {
                    reason?: string
                    success?: boolean
                }
                if (!result?.success) throw new Error(result?.reason || 'INSTALL_FAILED')

                const nextInstalledAddons = await desktopApi.addons.list()
                setInstalledAddons(Array.isArray(nextInstalledAddons) ? nextInstalledAddons : [])
                toast.custom('success', t('common.doneTitle'), t('store.installComplete', { title: addon.name }), { id: toastId })
            } catch (error: any) {
                toast.custom('error', t('common.errorTitle'), t('store.installFailed', { title: addon.name }), { id: toastId })
                console.error('[Store] failed to install addon', error)
            } finally {
                setInstallingAddonId(current => (current === addon.id ? null : current))
            }
        },
        [Modals.BASIC_CONFIRMATION, installingAddonId, openModal, setInstalledAddons, setModalState, t],
    )

    const renderStoreCard = useCallback(
        (addon: StoreAddon, variant: 'poster' | 'list', options?: { forceStatus?: 'pending' | 'rejected' | 'accepted'; installLabel?: string }) => {
            const release = addon.currentRelease
            if (!release) return null

            const installedStoreAddon = installedStoreAddons.get(addon.id)
            const isInstalled = Boolean(installedStoreAddon)
            const hasDownloadUrl = Boolean(release.downloadUrl?.trim())

            return (
                <ExtensionCardStore
                    key={`${variant}:${addon.id}`}
                    variant={variant}
                    title={addon.name}
                    subtitle={release.description}
                    authors={release.authors}
                    status={options?.forceStatus}
                    downloads={formatAge(release.approvedAt || release.updatedAt, i18n.language)}
                    topRightMeta={new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US').format(addon.downloadCount)}
                    ratingAverage={addon.ratingAverage}
                    ratingCount={addon.ratingCount}
                    kind={addon.type}
                    tags={release.tags || []}
                    usedAiDuringDevelopment={release.usedAiDuringDevelopment}
                    usesOfficialTemplate={release.usesOfficialTemplate}
                    backgroundImage={release.bannerUrl || undefined}
                    iconImage={release.avatarUrl || undefined}
                    downloadInstalled={isInstalled}
                    downloadVariant={isInstalled ? 'remove' : 'default'}
                    downloadDisabled={installingAddonId === addon.id || (!isInstalled && !hasDownloadUrl)}
                    animationsEnabledRef={animationsEnabledRef}
                    downloadLabel={
                        isInstalled
                            ? t('store.remove')
                            : installingAddonId === addon.id
                              ? t('common.importing')
                              : hasDownloadUrl
                                ? options?.installLabel || t('store.download')
                                : t('common.notAvailable')
                    }
                    onDownloadClick={() => void handleStoreAddonAction(addon, release, installedStoreAddon)}
                    onAuthorClick={author => {
                        if (author) openModal(Modals.USER_PROFILE, { profileName: author })
                    }}
                    onClick={() => setSelectedAddon(addon)}
                />
            )
        },
        [Modals.USER_PROFILE, handleStoreAddonAction, i18n.language, installedStoreAddons, installingAddonId, openModal, t],
    )

    const clearInitialShimmerTimers = useCallback(() => {
        if (shimmerFadeTimeoutRef.current !== null) window.clearTimeout(shimmerFadeTimeoutRef.current)
        if (shimmerFadeRafRef.current !== null) window.cancelAnimationFrame(shimmerFadeRafRef.current)
        shimmerFadeTimeoutRef.current = null
        shimmerFadeRafRef.current = null
    }, [])

    useEffect(() => () => clearInitialShimmerTimers(), [clearInitialShimmerTimers])

    useEffect(() => {
        if (loading) return
        if (!shouldRenderCards) {
            clearInitialShimmerTimers()
            setIsInitialShimmerVisible(false)
            setIsInitialShimmerFading(false)
            return
        }
        if (!isInitialShimmerVisible || isInitialShimmerFading) return

        shimmerFadeRafRef.current = window.requestAnimationFrame(() => {
            shimmerFadeRafRef.current = null
            setIsInitialShimmerFading(true)
            shimmerFadeTimeoutRef.current = window.setTimeout(() => {
                shimmerFadeTimeoutRef.current = null
                setIsInitialShimmerVisible(false)
                setIsInitialShimmerFading(false)
            }, INITIAL_SHIMMER_FADE_MS)
        })
    }, [INITIAL_SHIMMER_FADE_MS, clearInitialShimmerTimers, isInitialShimmerFading, isInitialShimmerVisible, loading, shouldRenderCards])

    const scrollNewAddons = (direction: -1 | 1) => {
        const container = newAddonsRef.current
        if (!container) return
        container.scrollBy({ left: direction * Math.max(320, container.clientWidth * 0.82), behavior: 'smooth' })
    }

    const scrollFeatured = (direction: -1 | 1) => {
        setFeaturedDirection(direction)
        setFeaturedIndex(current => {
            const count = featuredAddons.length
            return count ? (current + direction + count) % count : 0
        })
    }

    const featuredDragProps = useCarouselDrag<HTMLElement>({
        mode: 'swipe',
        draggingClassName: st.featuredDragging,
        onSwipe: scrollFeatured,
    })
    const newAddonsDragProps = useCarouselDrag<HTMLDivElement>({
        mode: 'scroll',
        draggingClassName: st.posterRailDragging,
    })

    const renderFeatured = () => {
        const addon = featuredAddon
        const release = addon?.currentRelease
        if (!addon || !release) return null

        const installedAddon = installedStoreAddons.get(addon.id)
        const isInstalled = Boolean(installedAddon)
        const hasDownloadUrl = Boolean(release.downloadUrl?.trim())
        const previewImage = release.previewUrl?.trim()
        const bannerImage = release.bannerUrl?.trim()
        const image = previewImage || bannerImage || fallbackBanner
        const hasImage = Boolean(previewImage || bannerImage)
        const releaseTags = release.tags || []
        const kindBadgeIcon = addon.type === 'theme' ? <MdLightMode /> : addon.type === 'script' ? <MdDataArray /> : <MdLanguage />
        const kindBadgeVariant = addon.type === 'theme' ? 'info' : addon.type === 'script' ? 'warning' : 'success'

        return (
            <section
                key={addon.id}
                className={cn(st.featured, st.featuredClickable, featuredDirection === 1 ? st.featuredEnterNext : st.featuredEnterPrevious)}
                {...featuredDragProps}
                onClick={event => {
                    if (event.target instanceof Element && event.target.closest('button, a')) return
                    setSelectedAddon(addon)
                }}
                onKeyDown={event => {
                    if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
                    event.preventDefault()
                    setSelectedAddon(addon)
                }}
                role="button"
                tabIndex={0}
                aria-label={addon.name}
            >
                <div className={st.featuredTopline}>
                    <div className={st.featuredIdentity}>
                        {release.avatarUrl ? <img src={release.avatarUrl} alt="" className={st.featuredAvatar} /> : null}
                        <h1 className={st.featuredTitle}>{addon.name}</h1>
                        <AddonRatingBadge average={addon.ratingAverage} />
                        <Badge uppercase={false} size="md" className={cn(st.metaBadge, st.neutralBadge)} icon={<MdInventory2 />}>
                            {`v${release.version}`}
                        </Badge>
                        <Badge uppercase={false} size="md" className={cn(st.metaBadge, st.neutralBadge)} icon={<MdSchedule />}>
                            {formatAge(release.approvedAt || release.updatedAt, i18n.language)}
                        </Badge>
                        <Badge uppercase={false} size="md" className={cn(st.metaBadge, st.neutralBadge)} icon={<MdDownload />}>
                            {new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US').format(addon.downloadCount)}
                        </Badge>
                    </div>
                    <button
                        type="button"
                        className={cn(st.installButton, isInstalled && st.removeButton)}
                        disabled={installingAddonId === addon.id || (!isInstalled && !hasDownloadUrl)}
                        onClick={() => void handleStoreAddonAction(addon, release, installedAddon)}
                    >
                        <MdDownload aria-hidden="true" />
                        {isInstalled ? t('store.remove') : installingAddonId === addon.id ? t('common.importing') : t('store.download')}
                    </button>
                </div>

                <div className={st.featuredBody}>
                    <div className={st.featuredCopy}>
                        <p className={st.featuredDescription}>{release.description}</p>
                        <div className={st.featuredGroup}>
                            <h2>{t('store.catalog.authors')}</h2>
                            <div className={st.badgeRow}>
                                {release.authors.map((author, index) => (
                                    <button
                                        key={`${author}:${index}`}
                                        type="button"
                                        className={cn(st.authorBadge, st.toneInfo)}
                                        onClick={() => author && openModal(Modals.USER_PROFILE, { profileName: author })}
                                    >
                                        <span aria-hidden="true" />
                                        {author}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {releaseTags.length ? (
                            <div className={st.featuredGroup}>
                                <h2>{t('store.catalog.tags')}</h2>
                                <div className={st.badgeRow}>
                                    <Badge
                                        variant={kindBadgeVariant}
                                        uppercase={false}
                                        size="md"
                                        className={cn(
                                            st.metaBadge,
                                            addon.type === 'theme' ? st.toneInfo : addon.type === 'script' ? st.toneWarning : st.toneSuccess,
                                        )}
                                        icon={kindBadgeIcon}
                                    >
                                        {addon.type === 'theme' ? t('store.kind.theme') : t(`store.kind.${addon.type}`)}
                                    </Badge>
                                    {releaseTags.map(tag => (
                                        <Badge key={tag} uppercase={false} size="md" icon={<MdLabel />} className={cn(st.metaBadge, st.neutralBadge)}>
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {release.githubUrl ? (
                            <div className={cn(st.featuredGroup, st.featuredGroupCompact)}>
                                <h2>{t('store.catalog.links')}</h2>
                                <button type="button" className={st.githubLink} onClick={() => desktopApi.system.openExternal(release.githubUrl!)}>
                                    <FaGithub aria-hidden="true" />
                                    {t('store.catalog.openGithub')}
                                </button>
                            </div>
                        ) : null}
                    </div>
                    <div className={st.featuredMedia}>
                        <img
                            src={image}
                            alt=""
                            className={cn(!hasImage && st.featuredMediaFallback)}
                            onError={event => {
                                event.currentTarget.onerror = null
                                event.currentTarget.src = fallbackBanner
                                event.currentTarget.classList.add(st.featuredMediaFallback)
                            }}
                        />
                    </div>
                </div>
            </section>
        )
    }

    const searchResults = (
        <section className={st.searchResults}>
            <header className={st.searchResultsHeader}>
                <div className={st.searchResultsHeading}>
                    <h2>{t('store.catalog.results')}</h2>
                    <div className={st.searchResultsSort}>
                        <MdFilterAlt aria-hidden="true" />
                        <span>{t(`store.catalog.searchSort.${searchSort}`)}</span>
                    </div>
                </div>
                <DropdownMenu items={searchFilterItems} menuClassName={st.searchFilterMenu} placement="left-start" closeOnSelect={false}>
                    <button type="button" className={st.searchFilterButton} aria-label={t('store.catalog.openFilters')}>
                        <MdFilterAlt aria-hidden="true" />
                    </button>
                </DropdownMenu>
            </header>
            {activeLoading || isSearchDebouncing ? (
                <div className={st.searchResultsLoading}>
                    <StoreShimmer count={6} variant="list" />
                </div>
            ) : !visibleAddons.length ? (
                <div className={st.storeState}>{t('store.noResults')}</div>
            ) : (
                <div className={st.storeList}>
                    {visibleAddons.map(addon => renderStoreCard(addon, 'list', { installLabel: t('layout.installAction') }))}
                </div>
            )}
        </section>
    )

    const modalAddon = selectedAddon ?? modalAddonRef.current
    const content = isSearchMode ? (
        searchResults
    ) : activeLoading ? (
        <div className={st.storeLoading}>
            <StoreShimmer count={6} variant={catalogTab === 'main' ? 'catalog' : 'list'} />
        </div>
    ) : !visibleAddons.length ? (
        <div className={st.storeState}>
            {t(hasSearchOrFilter ? 'store.noResults' : catalogTab === 'moderation' ? 'store.pendingEmpty' : 'store.empty')}
        </div>
    ) : catalogTab !== 'main' ? (
        <section className={st.catalogSection}>
            <header className={st.sectionHeader}>
                <div>
                    <h2>{t(catalogTab === 'moderation' ? 'store.pendingSectionTitle' : 'store.catalog.myAddons')}</h2>
                    {catalogTab === 'moderation' ? <p>{t('store.pendingSectionSubtitle')}</p> : null}
                </div>
            </header>
            <div className={st.storeList}>
                {visibleAddons.map(addon => renderStoreCard(addon, 'list', catalogTab === 'moderation' ? { forceStatus: 'pending' } : undefined))}
            </div>
        </section>
    ) : (
        <>
            {renderFeatured()}

            <div className={st.pagerDots}>
                <button
                    type="button"
                    className={st.pagerArrow}
                    onClick={() => scrollFeatured(-1)}
                    disabled={featuredAddons.length <= 1}
                    aria-label={t('store.catalog.previous')}
                >
                    <MdChevronLeft />
                </button>
                {featuredAddons.map((addon, index) => (
                    <button
                        key={addon.id}
                        type="button"
                        className={cn(st.pagerDot, index === featuredIndex && st.pagerDotActive)}
                        onClick={() => {
                            setFeaturedDirection(index >= featuredIndex ? 1 : -1)
                            setFeaturedIndex(index)
                        }}
                        aria-label={addon.name}
                        aria-current={index === featuredIndex ? 'true' : undefined}
                    />
                ))}
                <button
                    type="button"
                    className={st.pagerArrow}
                    onClick={() => scrollFeatured(1)}
                    disabled={featuredAddons.length <= 1}
                    aria-label={t('store.catalog.next')}
                >
                    <MdChevronRight />
                </button>
            </div>

            <section className={st.catalogSection}>
                <header className={st.sectionHeader}>
                    <h2>{t('store.catalog.newAddons')}</h2>
                    <div className={st.sectionActions}>
                        <button type="button" onClick={() => scrollNewAddons(-1)} aria-label={t('store.catalog.previous')}>
                            <MdChevronLeft />
                        </button>
                        <button type="button" onClick={() => scrollNewAddons(1)} aria-label={t('store.catalog.next')}>
                            <MdChevronRight />
                        </button>
                    </div>
                </header>
                <div ref={newAddonsRef} className={st.posterRail} {...newAddonsDragProps}>
                    {newAddons.map(addon => renderStoreCard(addon, 'poster'))}
                </div>
            </section>

            <section className={st.catalogSection}>
                <header className={st.sectionHeader}>
                    <h2>{t('store.catalog.recentlyUpdated')}</h2>
                </header>
                <div className={st.listShell}>
                    <div className={st.storeList}>{visibleAddons.map(addon => renderStoreCard(addon, 'list'))}</div>
                    {isInitialShimmerVisible ? (
                        <div className={cn(st.initialShimmerOverlay, isInitialShimmerFading && st.initialShimmerOverlayHidden)}>
                            <StoreShimmer count={6} />
                        </div>
                    ) : null}
                </div>
            </section>
        </>
    )

    return (
        <PageLayout
            title={selectedAddon ? t('extensions.pageTitle') : t('pages.store.title')}
            titleDetail={
                selectedAddon
                    ? {
                          label: selectedAddon.name,
                          icon: selectedAddon.currentRelease?.avatarUrl || undefined,
                      }
                    : undefined
            }
        >
            <>
                <Scrollbar
                    ref={scrollContainerRef}
                    className={st.containerFix}
                    classNameInner={cn(st.containerFixInner, (activeLoading || isInitialShimmerVisible) && st.containerFixInnerLocked)}
                    onScroll={() => {
                        animationsEnabledRef.current = true
                    }}
                >
                    <main className={st.store}>
                        <div className={st.catalogToolbar}>
                            <Tabs
                                key={isSearchMode ? 'search' : 'catalog'}
                                value={isSearchMode ? '__search__' : catalogTab}
                                onChange={handleCatalogTabChange}
                                className={st.catalogTabsRoot}
                            >
                                <TabList className={st.catalogTabs}>
                                    <Tab value="main">{t('store.catalog.main')}</Tab>
                                    <Tab value="owned">{t('store.catalog.myAddons')}</Tab>
                                    {isDeveloperUser && <Tab value="moderation">{t('store.catalog.moderation')}</Tab>}
                                </TabList>
                            </Tabs>
                            <div className={st.catalogSearchSlot}>
                                <img className={st.catalogSearchIcon} src={staticAsset('assets/icons/package_search.svg')} alt="" />
                                <SearchBox
                                    value={searchQuery}
                                    onChange={setSearchQuery as never}
                                    onFocus={() => setIsSearchOpen(true)}
                                    onKeyDown={event => {
                                        if (event.key !== 'Escape') return
                                        closeSearch()
                                        if (event.target instanceof HTMLElement) event.target.blur()
                                    }}
                                    placeholder={t('store.catalog.search')}
                                    className={st.catalogSearch}
                                />
                            </div>
                        </div>

                        {content}
                    </main>
                </Scrollbar>
                {modalAddon ? (
                    <StoreAddonDetailsModal
                        key={modalAddon.id}
                        addon={modalAddon}
                        isOpen={Boolean(selectedAddon)}
                        isInstalled={installedStoreAddons.has(modalAddon.id)}
                        actionDisabled={
                            installingAddonId === modalAddon.id ||
                            (!installedStoreAddons.has(modalAddon.id) && !modalAddon.currentRelease?.downloadUrl?.trim())
                        }
                        actionLabel={
                            installedStoreAddons.has(modalAddon.id)
                                ? t('store.remove')
                                : installingAddonId === modalAddon.id
                                  ? t('common.importing')
                                  : modalAddon.currentRelease?.downloadUrl?.trim()
                                    ? t('layout.installAction')
                                    : t('common.notAvailable')
                        }
                        currentUserId={user.id}
                        currentUserAvatarHash={user.avatarHash}
                        currentUserAvatarType={user.avatarType}
                        relatedAddons={addons.filter(addon => addon.id !== modalAddon.id && addon.currentRelease).slice(0, 8)}
                        installingAddonId={installingAddonId}
                        isAddonInstalled={addonId => installedStoreAddons.has(addonId)}
                        onAction={() => {
                            if (!modalAddon.currentRelease) return
                            setSelectedAddon(null)
                            void handleStoreAddonAction(modalAddon, modalAddon.currentRelease, installedStoreAddons.get(modalAddon.id))
                        }}
                        onRelatedAddonAction={relatedAddon => {
                            if (!relatedAddon.currentRelease) return
                            void handleStoreAddonAction(relatedAddon, relatedAddon.currentRelease, installedStoreAddons.get(relatedAddon.id))
                        }}
                        onRelatedAddonSelect={setSelectedAddon}
                        onAuthorClick={author => {
                            setSelectedAddon(null)
                            openModal(Modals.USER_PROFILE, { profileName: author })
                        }}
                        onRatingChange={handleRatingChange}
                        onClose={() => setSelectedAddon(null)}
                    />
                ) : null}
            </>
        </PageLayout>
    )
}
