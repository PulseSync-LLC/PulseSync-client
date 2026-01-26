import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdMoreHoriz, MdStoreMallDirectory } from 'react-icons/md'
import AddonInterface from '../../../../../api/interfaces/addon.interface'
import Button from '../../../../../components/buttonV2'
import ViewModal from '../../../../../components/context_menu_themes/viewModal'
import { createContextMenuActions } from '../../../../../components/context_menu_themes/sectionConfig'
import * as s from './ThemeInfo.module.scss'
import config from '../../../../../api/web_config'
import { staticAsset } from '../../../../../utils/staticAssets'
import { useTranslation } from 'react-i18next'

interface Props {
    addon: AddonInterface
    isEnabled: boolean
    themeActive: boolean
    onToggleEnabled: (enabled: boolean) => void

    setSelectedTags?: React.Dispatch<React.SetStateAction<Set<string>>>
    setShowFilters?: (show: boolean) => void
}

type UrlEntry = { url: string }

const bannerUrlCache: Map<string, UrlEntry> = new Map()
const logoUrlCache: Map<string, UrlEntry> = new Map()
const MAX_CACHED_OBJECT_URLS = 40

function storeObjectUrl(cache: Map<string, UrlEntry>, key: string, url: string) {
    cache.delete(key)
    cache.set(key, { url })
    while (cache.size > MAX_CACHED_OBJECT_URLS) {
        const oldestKey = cache.keys().next().value as string | undefined
        if (!oldestKey) break
        const entry = cache.get(oldestKey)
        if (entry) {
            try {
                URL.revokeObjectURL(entry.url)
            } catch {}
        }
        cache.delete(oldestKey)
    }
}

async function acquireObjectUrl(
    cache: Map<string, UrlEntry>,
    key: string,
    fetchFactory: () => Promise<string>,
): Promise<{ url: string; acquired: boolean }> {
    const existing = cache.get(key)
    if (existing) {
        return { url: existing.url, acquired: true }
    }
    const url = await fetchFactory()
    storeObjectUrl(cache, key, url)
    return { url, acquired: true }
}

const ThemeInfo: React.FC<Props> = ({ addon, isEnabled, themeActive, onToggleEnabled, setSelectedTags, setShowFilters }) => {
    const { t } = useTranslation()
    const [menuOpen, setMenuOpen] = useState(false)
    const nav = useNavigate()
    const actionsRef = useRef<HTMLDivElement>(null)
    const moreBtnRef = useRef<HTMLButtonElement>(null)
    const fallbackBanner = staticAsset('assets/images/no_themeBackground.png')
    const fallbackLogo = staticAsset('assets/images/O^O.png')

    const authorNames =
        typeof addon.author === 'string'
            ? addon.author.split(', ').map(name => name.trim().toLowerCase())
            : addon.author.map(name => name.toLowerCase())

    const MAX_VISIBLE = 1
    const visibleAuthors = authorNames.slice(0, MAX_VISIBLE)
    const hiddenAuthors = authorNames.slice(MAX_VISIBLE)

    const [showAll, setShowAll] = useState(false)

    useEffect(() => {
        if (!showAll) return
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (!target.closest(`.${s.moreBox}`)) {
                setShowAll(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showAll])

    const [bannerUrl, setBannerUrl] = useState(fallbackBanner)
    const [logoUrl, setLogoUrl] = useState<string | null>(fallbackLogo)

    const currentBannerKeyRef = useRef<string | null>(null)
    const currentLogoKeyRef = useRef<string | null>(null)

    const isMac = typeof window !== 'undefined' ? window.electron.isMac() : false
    const isGif = (fn?: string | null) => !!fn && /\.gif$/i.test(fn)

    const getAssetUrl = (file: string) =>
        `http://127.0.0.1:${config.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(file)}`

    useEffect(() => {
        let cancelled = false
        const controller = new AbortController()

        if (isMac && isGif(addon.banner)) {
            setBannerUrl(fallbackBanner)
            return () => controller.abort()
        }

        if (!addon.banner) {
            setBannerUrl(fallbackBanner)
            return () => controller.abort()
        }

        const key = `${addon.directoryName}|banner|${addon.banner}`

        acquireObjectUrl(bannerUrlCache, key, async () => {
            const res = await fetch(getAssetUrl(addon.banner!), {
                signal: controller.signal,
            })
            if (!res.ok) throw new Error('Failed to fetch banner')
            const blob = await res.blob()
            return URL.createObjectURL(blob)
        })
            .then(({ url }) => {
                if (cancelled) return
                if (currentBannerKeyRef.current && currentBannerKeyRef.current !== key) {
                    currentBannerKeyRef.current = null
                }
                currentBannerKeyRef.current = key
                setBannerUrl(url)
            })
            .catch(err => {
                if (cancelled) return
                if (err?.name === 'AbortError') return
                setBannerUrl(fallbackBanner)
            })

        return () => {
            cancelled = true
            controller.abort()
        }
    }, [addon.banner, addon.directoryName, addon.name, fallbackBanner])

    useEffect(() => {
        let cancelled = false
        const controller = new AbortController()

        if (isMac && isGif(addon.libraryLogo)) {
            setLogoUrl(fallbackLogo)
            return () => controller.abort()
        }

        if (!addon.libraryLogo) {
            setLogoUrl(null)
            return () => controller.abort()
        }

        const key = `${addon.directoryName}|logo|${addon.libraryLogo}`

        acquireObjectUrl(logoUrlCache, key, async () => {
            const res = await fetch(getAssetUrl(addon.libraryLogo!), {
                signal: controller.signal,
            })
            if (!res.ok) throw new Error('Failed to fetch logo')
            const blob = await res.blob()
            return URL.createObjectURL(blob)
        })
            .then(({ url }) => {
                if (cancelled) return
                if (currentLogoKeyRef.current && currentLogoKeyRef.current !== key) {
                    currentLogoKeyRef.current = null
                }
                currentLogoKeyRef.current = key
                setLogoUrl(url)
            })
            .catch(err => {
                if (cancelled) return
                if (err?.name === 'AbortError') return
                setLogoUrl(null)
            })

        return () => {
            cancelled = true
            controller.abort()
        }
    }, [addon.libraryLogo, addon.directoryName, addon.name, fallbackLogo])

    useEffect(() => {
        if (!menuOpen) return
        function handleClickOutside(e: MouseEvent) {
            const target = e.target as Node
            if (actionsRef.current && actionsRef.current.contains(target)) return
            setMenuOpen(false)
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [menuOpen])

    return (
        <>
            <div className={s.themeInfo} style={{ backgroundImage: `url(${bannerUrl})` }}>
                <div className={s.content}>
                    <div className={s.libraryLogo} onClick={() => nav(`/extension/${encodeURIComponent(addon.directoryName)}`)}>
                        {logoUrl ? (
                            <img className={s.libraryLogoImg} src={logoUrl} alt="Library Logo" />
                        ) : (
                            <div className={s.libraryLogoText}>{addon.name}</div>
                        )}
                    </div>
                </div>
            </div>

            <div className={s.topTags}>
                {addon.tags &&
                    addon.tags.length > 0 &&
                    addon.tags.map(t => (
                        <Button
                            key={t}
                            className={s.tag}
                            onClick={() => {
                                if (setSelectedTags && setShowFilters) {
                                    setSelectedTags(prev => new Set([...prev, t]))
                                    setShowFilters(false)
                                }
                            }}
                        >
                            {t}
                        </Button>
                    ))}
            </div>

            <div className={s.invisible}></div>

            <div className={s.bottomBar}>
                <div className={s.meta}>
                    <div className={s.metaItem}>
                        <span className={s.label}>{t('extensions.meta.author')}</span>
                        <span className={s.value}>
                            {visibleAuthors.map((u, i) => (
                                <React.Fragment key={u}>
                                    <span onClick={() => nav(`/profile/${encodeURIComponent(u)}`)} className={s.authorLink}>
                                        {u}
                                    </span>
                                    {i < visibleAuthors.length - 1 && <span>, </span>}
                                </React.Fragment>
                            ))}

                            {hiddenAuthors.length > 0 && (
                                <span className={s.moreBox} onClick={() => setShowAll(!showAll)}>
                                    <MdMoreHoriz size={16} />
                                    {showAll && (
                                        <div className={s.morePopup}>
                                            {hiddenAuthors.map(u => (
                                                <div
                                                    key={u}
                                                    onClick={() => {
                                                        nav(`/profile/${encodeURIComponent(u)}`)
                                                        setShowAll(false)
                                                    }}
                                                    className={s.moreAuthor}
                                                >
                                                    {u}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </span>
                            )}
                        </span>
                    </div>

                    <div className={s.metaItem}>
                        <span className={s.label}>{t('extensions.meta.size')}</span>
                        <span className={s.value}>{addon.size ?? t('common.emDash')}</span>
                    </div>

                    <div className={s.metaItem}>
                        <span className={s.label}>{t('extensions.meta.version')}</span>
                        <span className={s.value}>{addon.version ?? t('common.emDash')}</span>
                    </div>

                    <div className={s.metaItem}>
                        <span className={s.label}>{t('extensions.meta.updated')}</span>
                        <span className={s.value}>{addon.lastModified ?? t('common.emDash')}</span>
                    </div>
                </div>

                <div className={s.actions} ref={actionsRef}>
                    <Button
                        className={`${s.toggleButton} ${isEnabled ? s.enabledState : s.disabledState}`}
                        onClick={() => onToggleEnabled(!isEnabled)}
                    >
                        {isEnabled ? t('common.disable') : t('common.enable')}
                    </Button>

                    <Button className={s.miniButton} title={t('extensions.actions.store')} disabled>
                        <MdStoreMallDirectory size={20} />
                    </Button>

                    <Button className={s.miniButton} onClick={() => setMenuOpen(o => !o)} title={t('common.more')} ref={moreBtnRef}>
                        <MdMoreHoriz size={20} />
                    </Button>

                    {menuOpen && (
                        <ViewModal
                            items={createContextMenuActions(
                                undefined,
                                themeActive,
                                {
                                    showCheck: false,
                                    showDirectory: true,
                                    showExport: true,
                                    showDelete: true,
                                },
                                addon,
                            )}
                        />
                    )}
                </div>
            </div>
        </>
    )
}

export default ThemeInfo
