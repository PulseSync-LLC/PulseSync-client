import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { MdMoreHoriz, MdStoreMallDirectory } from 'react-icons/md'
import AddonInterface from '../../../../../api/interfaces/addon.interface'
import Button from '../../../../../components/button'
import ViewModal from '../../../../../components/context_menu_themes/viewModal'
import { createContextMenuActions } from '../../../../../components/context_menu_themes/sectionConfig'
import { useUserProfileModal } from '../../../../../context/UserProfileModalContext'
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
    const { openUserProfile } = useUserProfileModal()
    const [menuOpen, setMenuOpen] = useState(false)
    const nav = useNavigate()
    const ref = useRef<HTMLDivElement>(null)

    const authorNames = typeof addon.author === 'string' ? addon.author.split(', ') : addon.author

    const [bannerUrl, setBannerUrl] = useState('static/assets/images/no_themeBackground.png')
    const [logoUrl, setLogoUrl] = useState<string | null>(null)

    const bannerCache = new Map<string, string>()
    const logoCache = new Map<string, string>()

    const getAssetUrl = (file: string) =>
        `http://127.0.0.1:${config.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(file)}`

    useEffect(() => {
        if (!addon.banner) return
        const key = `${addon.directoryName}|banner`
        if (bannerCache.has(key)) {
            setBannerUrl(bannerCache.get(key)!)
            return
        }

        fetch(getAssetUrl(addon.banner))
            .then(r => (r.ok ? r.blob() : Promise.reject()))
            .then(b => {
                const url = URL.createObjectURL(b)
                bannerCache.set(key, url)
                setBannerUrl(url)
            })
            .catch(() => bannerCache.set(key, 'static/assets/images/no_themeBackground.png'))
    }, [addon.banner])

    useEffect(() => {
        /** подкачиваем логотип */
        if (!addon.libraryLogo) {
            setLogoUrl(null)
            return
        }
        const key = `${addon.directoryName}|logo`
        if (logoCache.has(key)) {
            setLogoUrl(logoCache.get(key)!)
            return
        }

        fetch(getAssetUrl(addon.libraryLogo))
            .then(r => (r.ok ? r.blob() : Promise.reject()))
            .then(b => {
                const url = URL.createObjectURL(b)
                logoCache.set(key, url)
                setLogoUrl(url)
            })
            .catch(() => logoCache.set(key, null))
    }, [addon.libraryLogo])

    return (
        <>
            <div className={s.themeInfo} style={{ backgroundImage: `url(${bannerUrl})` }}>
                <div className={s.content}>
                    <div className={s.libraryLogo}>
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
                                    <span onClick={() => openUserProfile(u)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
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
                <div className={s.actions} ref={ref}>
                    <Button
                        className={`${s.toggleButton} ${isEnabled ? s.enabledState : s.disabledState}`}
                        onClick={() => onToggleEnabled(!isEnabled)}
                    >
                        {isEnabled ? 'Выключить' : 'Включить'}
                    </Button>
                    <Button className={s.miniButton} title="Ещё" disabled>
                        <MdStoreMallDirectory size={20} />
                    </Button>
                    <Button className={s.miniButton} onClick={() => setMenuOpen(o => !o)} title="Ещё">
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
