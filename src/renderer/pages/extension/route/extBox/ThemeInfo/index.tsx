import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdMoreHoriz, MdStoreMallDirectory } from 'react-icons/md'
import AddonInterface from '../../../../../api/interfaces/addon.interface'
import Button from '../../../../../components/buttonV2'
import ViewModal from '../../../../../components/context_menu_themes/viewModal'
import { createContextMenuActions } from '../../../../../components/context_menu_themes/sectionConfig'
import * as s from './ThemeInfo.module.scss'
import config from '../../../../../api/config'

interface Props {
    addon: AddonInterface
    isEnabled: boolean
    themeActive: boolean
    onToggleEnabled: (enabled: boolean) => void

    setSelectedTags?: React.Dispatch<React.SetStateAction<Set<string>>>
    setShowFilters?: (show: boolean) => void
}

type UrlEntry = { url: string; refs: number }

const bannerUrlCache: Map<string, UrlEntry> = new Map()
const logoUrlCache: Map<string, UrlEntry> = new Map()

async function acquireObjectUrl(
    cache: Map<string, UrlEntry>,
    key: string,
    fetchFactory: () => Promise<string>,
): Promise<{ url: string; acquired: boolean }> {
    const existing = cache.get(key)
    if (existing) {
        existing.refs += 1
        return { url: existing.url, acquired: true }
    }
    const url = await fetchFactory()
    cache.set(key, { url, refs: 1 })
    return { url, acquired: true }
}

function releaseObjectUrl(cache: Map<string, UrlEntry>, key: string) {
    const entry = cache.get(key)
    if (!entry) return
    entry.refs -= 1
    if (entry.refs <= 0) {
        try {
            URL.revokeObjectURL(entry.url)
        } catch {}
        cache.delete(key)
    }
}

const ThemeInfo: React.FC<Props> = ({ addon, isEnabled, themeActive, onToggleEnabled, setSelectedTags, setShowFilters }) => {
    const [menuOpen, setMenuOpen] = useState(false)
    const nav = useNavigate()
    const actionsRef = useRef<HTMLDivElement>(null)
    const moreBtnRef = useRef<HTMLButtonElement>(null)

    const authorNames =
        typeof addon.author === 'string' ? addon.author.split(', ').map(name => name.toLowerCase()) : addon.author.map(name => name.toLowerCase())

    const [bannerUrl, setBannerUrl] = useState('static/assets/images/no_themeBackground.png')
    const [logoUrl, setLogoUrl] = useState<string | null>(null)

    const currentBannerKeyRef = useRef<string | null>(null)
    const currentLogoKeyRef = useRef<string | null>(null)

    const getAssetUrl = (file: string) =>
        `http://127.0.0.1:${config.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(file)}`

    useEffect(() => {
        let didAcquire = false
        let cancelled = false
        const controller = new AbortController()

        if (!addon.banner) {
            if (currentBannerKeyRef.current) {
                releaseObjectUrl(bannerUrlCache, currentBannerKeyRef.current)
                currentBannerKeyRef.current = null
            }
            setBannerUrl('static/assets/images/no_themeBackground.png')
            return () => controller.abort()
        }

        const key = `${addon.directoryName}|banner|${addon.banner}`

        acquireObjectUrl(bannerUrlCache, key, async () => {
            const res = await fetch(getAssetUrl(addon.banner!), { signal: controller.signal })
            if (!res.ok) throw new Error('Failed to fetch banner')
            const blob = await res.blob()
            return URL.createObjectURL(blob)
        })
            .then(({ url, acquired }) => {
                if (cancelled) return
                didAcquire = acquired
                if (currentBannerKeyRef.current && currentBannerKeyRef.current !== key) {
                    releaseObjectUrl(bannerUrlCache, currentBannerKeyRef.current)
                }
                currentBannerKeyRef.current = key
                setBannerUrl(url)
            })
            .catch(err => {
                if (cancelled) return
                if (err?.name === 'AbortError') return
                setBannerUrl('static/assets/images/no_themeBackground.png')
            })

        return () => {
            cancelled = true
            controller.abort()
            if (didAcquire) {
                releaseObjectUrl(bannerUrlCache, key)
                if (currentBannerKeyRef.current === key) currentBannerKeyRef.current = null
            }
        }
    }, [addon.banner, addon.directoryName, addon.name])

    useEffect(() => {
        let didAcquire = false
        let cancelled = false
        const controller = new AbortController()

        if (!addon.libraryLogo) {
            if (currentLogoKeyRef.current) {
                releaseObjectUrl(logoUrlCache, currentLogoKeyRef.current)
                currentLogoKeyRef.current = null
            }
            setLogoUrl(null)
            return () => controller.abort()
        }

        const key = `${addon.directoryName}|logo|${addon.libraryLogo}`

        acquireObjectUrl(logoUrlCache, key, async () => {
            const res = await fetch(getAssetUrl(addon.libraryLogo!), { signal: controller.signal })
            if (!res.ok) throw new Error('Failed to fetch logo')
            const blob = await res.blob()
            return URL.createObjectURL(blob)
        })
            .then(({ url, acquired }) => {
                if (cancelled) return
                didAcquire = acquired
                if (currentLogoKeyRef.current && currentLogoKeyRef.current !== key) {
                    releaseObjectUrl(logoUrlCache, currentLogoKeyRef.current)
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
            if (didAcquire) {
                releaseObjectUrl(logoUrlCache, key)
                if (currentLogoKeyRef.current === key) currentLogoKeyRef.current = null
            }
        }
    }, [addon.libraryLogo, addon.directoryName, addon.name])

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
                    <div className={s.libraryLogo} onClick={() => nav(`/themes/${encodeURIComponent(addon.directoryName)}`)}>
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
                        <span className={s.label}>Автор</span>
                        <span className={s.value}>
                            {authorNames.map((u, i) => (
                                <React.Fragment key={u}>
                                    <span
                                        onClick={() => nav(`/profile/${encodeURIComponent(u)}`)}
                                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                                    >
                                        {u}
                                    </span>
                                    {i < authorNames.length - 1 && <span>, </span>}
                                </React.Fragment>
                            ))}
                        </span>
                    </div>

                    <div className={s.metaItem}>
                        <span className={s.label}>Размер</span>
                        <span className={s.value}>{addon.size ?? '—'}</span>
                    </div>

                    <div className={s.metaItem}>
                        <span className={s.label}>Версия</span>
                        <span className={s.value}>{addon.version ?? '—'}</span>
                    </div>

                    <div className={s.metaItem}>
                        <span className={s.label}>Обновлялось</span>
                        <span className={s.value}>{addon.lastModified ?? '—'}</span>
                    </div>
                </div>

                <div className={s.actions} ref={actionsRef}>
                    <Button
                        className={`${s.toggleButton} ${isEnabled ? s.enabledState : s.disabledState}`}
                        onClick={() => onToggleEnabled(!isEnabled)}
                    >
                        {isEnabled ? 'Выключить' : 'Включить'}
                    </Button>

                    <Button className={s.miniButton} title="Магазин" disabled>
                        <MdStoreMallDirectory size={20} />
                    </Button>

                    <Button className={s.miniButton} onClick={() => setMenuOpen(o => !o)} title="Ещё" ref={moreBtnRef}>
                        <MdMoreHoriz size={20} />
                    </Button>

                    {menuOpen && (
                        <ViewModal
                            items={createContextMenuActions(
                                undefined,
                                themeActive,
                                { showCheck: false, showDirectory: true, showExport: true, showDelete: true },
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
