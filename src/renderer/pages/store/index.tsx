import { useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdSearch } from 'react-icons/md'
import PageLayout from '@widgets/layout/PageLayout'
import * as st from '@pages/store/store.module.scss'
import ExtensionCardStore from '@shared/ui/PSUI/ExtensionCardStore'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'
import { useTranslation } from 'react-i18next'
import apolloClient from '@shared/api/apolloClient'
import GetStoreAddonsQuery from '@entities/addon/api/getStoreAddons.query'
import type { StoreAddon, StoreAddonsPayload } from '@entities/addon/model/storeAddon.interface'
import Loader from '@shared/ui/PSUI/Loader'
import MainEvents from '@common/types/mainEvents'
import toast from '@shared/ui/toast'
import UserContext from '@entities/user/model/context'

type StoreAddonsQuery = {
    getStoreAddons: StoreAddonsPayload
}

function resolveTheme(index: number): 'purple' | 'red' | 'wave' {
    const themes: Array<'purple' | 'red' | 'wave'> = ['purple', 'red', 'wave']
    return themes[index % themes.length]
}

function resolveType(type: StoreAddon['type']): 'css' | 'js' {
    return type === 'script' ? 'js' : 'css'
}

function formatDate(value: string, locale?: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }

    return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date)
}

export default function StorePage() {
    const { t, i18n } = useTranslation()
    const navigate = useNavigate()
    const { addons: installedAddons, setAddons: setInstalledAddons } = useContext(UserContext)
    const [addons, setAddons] = useState<StoreAddon[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [loading, setLoading] = useState(true)
    const [installingAddonId, setInstallingAddonId] = useState<string | null>(null)

    useEffect(() => {
        let active = true

        const loadAddons = async () => {
            setLoading(true)
            try {
                const response = await apolloClient.query<StoreAddonsQuery>({
                    query: GetStoreAddonsQuery,
                    variables: {
                        page: 1,
                        pageSize: 50,
                    },
                    fetchPolicy: 'no-cache',
                })

                if (!active) return
                setAddons(Array.isArray(response.data?.getStoreAddons?.addons) ? response.data.getStoreAddons.addons : [])
            } catch (error) {
                console.error('[Store] failed to load addons', error)
                if (active) {
                    setAddons([])
                }
            } finally {
                if (active) {
                    setLoading(false)
                }
            }
        }

        void loadAddons()

        return () => {
            active = false
        }
    }, [])

    const installedStoreAddons = useMemo(
        () =>
            new Map(
                installedAddons
                    .filter(addon => addon.installSource === 'store' && addon.storeAddonId)
                    .map(addon => [addon.storeAddonId!, addon]),
            ),
        [installedAddons],
    )

    const filteredAddons = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) {
            return addons
        }

        return addons.filter(addon => {
            const haystack = [addon.name, addon.description, addon.type, addon.version, ...addon.authors].join(' ').toLowerCase()
            return haystack.includes(query)
        })
    }, [addons, searchQuery])

    const content = useMemo(() => {
        if (loading) {
            return (
                <div className={st.store_state}>
                    <Loader text={t('store.loading')} />
                </div>
            )
        }

        if (!addons.length) {
            return <div className={st.store_state}>{t('store.empty')}</div>
        }

        if (!filteredAddons.length) {
            return <div className={st.store_state}>{t('store.noResults')}</div>
        }

        return (
            <div className={st.store_grid}>
                {filteredAddons.map((addon, index) => {
                    const installedStoreAddon = installedStoreAddons.get(addon.id)
                    const isInstalledFromStore = !!installedStoreAddon

                    return (
                        <ExtensionCardStore
                            key={addon.id}
                            theme={resolveTheme(index)}
                            title={addon.name}
                            subtitle={addon.description}
                            version={`v${addon.version}`}
                            authors={addon.authors}
                            downloads={t('store.approvedAt', {
                                date: formatDate(addon.approvedAt || addon.updatedAt, i18n.language),
                            })}
                            type={resolveType(addon.type)}
                            kind={addon.type}
                            backgroundImage={addon.bannerUrl || undefined}
                            iconImage={addon.avatarUrl || undefined}
                            downloadInstalled={isInstalledFromStore}
                            downloadVariant={isInstalledFromStore ? 'remove' : 'default'}
                            downloadDisabled={installingAddonId === addon.id}
                            downloadLabel={isInstalledFromStore ? t('store.remove') : installingAddonId === addon.id ? t('common.importing') : t('store.download')}
                            onDownloadClick={async () => {
                                if (installingAddonId === addon.id || !window.desktopEvents) return

                                setInstallingAddonId(addon.id)
                                const isRemoving = !!installedStoreAddon
                                const toastId = toast.custom('loading', isRemoving ? t('common.delete') : t('common.importTitle'), t('common.pleaseWait'))

                                try {
                                    if (installedStoreAddon) {
                                        const result = await window.desktopEvents.invoke(MainEvents.DELETE_ADDON_DIRECTORY, installedStoreAddon.path)
                                        if (!result?.success) {
                                            throw new Error(result?.reason || 'DELETE_FAILED')
                                        }

                                        const nextInstalledAddons = await window.desktopEvents.invoke(MainEvents.GET_ADDONS)
                                        setInstalledAddons(Array.isArray(nextInstalledAddons) ? nextInstalledAddons : [])
                                        toast.custom('success', t('common.doneTitle'), t('store.removeComplete', { title: addon.name }), { id: toastId })
                                        return
                                    }

                                    const result = await window.desktopEvents.invoke(MainEvents.INSTALL_STORE_ADDON, {
                                        id: addon.id,
                                        downloadUrl: addon.downloadUrl,
                                        title: addon.name,
                                    })

                                    if (!result?.success) {
                                        throw new Error(result?.reason || 'INSTALL_FAILED')
                                    }

                                    toast.custom('success', t('common.doneTitle'), t('store.installComplete', { title: addon.name }), { id: toastId })
                                } catch (error: any) {
                                    toast.custom(
                                        'error',
                                        t('common.errorTitle'),
                                        t(installedStoreAddon ? 'store.removeFailed' : 'store.installFailed', { title: addon.name }),
                                        { id: toastId },
                                    )
                                    console.error(installedStoreAddon ? '[Store] failed to remove addon' : '[Store] failed to install addon', error)
                                } finally {
                                    setInstallingAddonId(current => (current === addon.id ? null : current))
                                }
                            }}
                            onAuthorClick={author => {
                                if (!author) return
                                navigate(`/profile/${encodeURIComponent(author)}`)
                            }}
                        />
                    )
                })}
            </div>
        )
    }, [addons, filteredAddons, i18n.language, installedStoreAddons, installingAddonId, loading, navigate, setInstalledAddons, t])

    return (
        <PageLayout title={t('pages.store.title')}>
            <Scrollbar className={st.containerFix} classNameInner={st.containerFixInner}>
                <section className={st.store}>
                    <header className={st.store_header}>
                        <div className={st.store_title}>{t('pages.store.headerTitle')}</div>
                        <div className={st.store_subtitle}>{t('pages.store.headerSubtitle')}</div>
                        <div className={st.store_search} onClick={event => (event.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={event => setSearchQuery(event.target.value)}
                                placeholder={t('store.searchPlaceholder')}
                                className={st.store_search_input}
                            />
                            <MdSearch className={st.store_search_icon} />
                        </div>
                    </header>

                    {content}
                </section>
            </Scrollbar>
        </PageLayout>
    )
}
