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

const ThemeInfo: React.FC<Props> = ({ addon, isEnabled, themeActive, onToggleEnabled, setSelectedTags, setShowFilters }) => {
    const [menuOpen, setMenuOpen] = useState(false)
    const nav = useNavigate()
    const actionsRef = useRef<HTMLDivElement>(null)
    const moreBtnRef = useRef<HTMLButtonElement>(null)

    const authorNames = typeof addon.author === 'string' ? addon.author.split(', ') : addon.author

    const [bannerUrl, setBannerUrl] = useState('static/assets/images/no_themeBackground.png')
    const [logoUrl, setLogoUrl] = useState<string | null>(null)

    const bannerCacheRef = useRef<Map<string, string>>(new Map())
    const logoCacheRef = useRef<Map<string, string>>(new Map())

    const getAssetUrl = (file: string) =>
        `http://127.0.0.1:${config.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(file)}`

    useEffect(() => {
        if (!addon.banner) {
            setBannerUrl('static/assets/images/no_themeBackground.png')
            return
        }
        const key = `${addon.directoryName}|banner|${addon.banner}`
        const cache = bannerCacheRef.current

        if (cache.has(key)) {
            setBannerUrl(cache.get(key)!)
            return
        }

        let objectUrl: string | null = null
        fetch(getAssetUrl(addon.banner))
            .then(r => (r.ok ? r.blob() : Promise.reject()))
            .then(b => {
                objectUrl = URL.createObjectURL(b)
                cache.set(key, objectUrl!)
                setBannerUrl(objectUrl!)
            })
            .catch(() => cache.set(key, 'static/assets/images/no_themeBackground.png'))

        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [addon.banner, addon.directoryName])

    useEffect(() => {
        if (!addon.libraryLogo) {
            setLogoUrl(null)
            return
        }
        const key = `${addon.directoryName}|logo|${addon.libraryLogo}`
        const cache = logoCacheRef.current

        if (cache.has(key)) {
            setLogoUrl(cache.get(key)!)
            return
        }

        let objectUrl: string | null = null
        fetch(getAssetUrl(addon.libraryLogo))
            .then(r => (r.ok ? r.blob() : Promise.reject()))
            .then(b => {
                objectUrl = URL.createObjectURL(b)
                cache.set(key, objectUrl!)
                setLogoUrl(objectUrl!)
            })
            .catch(() => cache.set(key, null))

        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [addon.libraryLogo, addon.directoryName])

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
                                        onClick={() => nav(`/profile/${encodeURIComponent(u)}`)} // <-- новый переход на страницу профиля
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
