import { useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageLayout from '@widgets/layout/PageLayout'
import * as st from '@pages/store/store.module.scss'
import ExtensionCardStore from '@shared/ui/PSUI/ExtensionCardStore'
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

function normalizeAddonKey(type: 'theme' | 'script', name: string): string {
    return `${type}:${name.trim().toLowerCase()}`
}

export default function StorePage() {
    const { t, i18n } = useTranslation()
    const navigate = useNavigate()
    const { addons: installedAddons } = useContext(UserContext)
    const [addons, setAddons] = useState<StoreAddon[]>([])
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

    const installedAddonKeys = useMemo(
        () => new Set(installedAddons.map(addon => normalizeAddonKey(addon.type, addon.name))),
        [installedAddons],
    )

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

        return (
            <div className={st.store_grid}>
                {addons.map((addon, index) => {
                    const isInstalled = installedAddonKeys.has(normalizeAddonKey(addon.type, addon.name))

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
                            status={addon.status}
                            type={resolveType(addon.type)}
                            backgroundImage={addon.bannerUrl || undefined}
                            iconImage={addon.avatarUrl || undefined}
                            downloadInstalled={isInstalled}
                            downloadDisabled={isInstalled || installingAddonId === addon.id}
                            downloadLabel={isInstalled ? t('store.installed') : installingAddonId === addon.id ? t('common.importing') : t('store.download')}
                            onDownloadClick={async () => {
                                if (isInstalled || installingAddonId === addon.id || !window.desktopEvents) return

                                setInstallingAddonId(addon.id)
                                const toastId = toast.custom('loading', t('common.importTitle'), t('common.pleaseWait'))

                                try {
                                    const result = await window.desktopEvents.invoke(MainEvents.INSTALL_STORE_ADDON, {
                                        downloadUrl: addon.downloadUrl,
                                        title: addon.name,
                                    })

                                    if (!result?.success) {
                                        throw new Error(result?.reason || 'INSTALL_FAILED')
                                    }

                                    toast.custom('success', t('common.doneTitle'), t('store.installComplete', { title: addon.name }), { id: toastId })
                                } catch (error: any) {
                                    toast.custom('error', t('common.errorTitle'), t('store.installFailed', { title: addon.name }), { id: toastId })
                                    console.error('[Store] failed to install addon', error)
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
    }, [addons, i18n.language, installedAddonKeys, installingAddonId, loading, navigate, t])

    return (
        <PageLayout title={t('pages.store.title')}>
            <section className={st.store}>
                <header className={st.store_header}>
                    <div className={st.store_title}>{t('pages.store.headerTitle')}</div>
                    <div className={st.store_subtitle}>{t('pages.store.headerSubtitle')}</div>
                </header>

                {content}
            </section>
        </PageLayout>
    )
}
