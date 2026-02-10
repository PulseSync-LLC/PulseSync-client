import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdMoreHoriz, MdStoreMallDirectory } from 'react-icons/md'
import AddonInterface from '../../../../../api/interfaces/addon.interface'
import Button from '../../../../../components/buttonV2'
import ViewModal from '../../../../../components/context_menu_themes/viewModal'
import { createContextMenuActions } from '../../../../../components/context_menu_themes/sectionConfig'
import * as s from './ThemeInfo.module.scss'
import config from '@common/appConfig'
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

function useResolvedImage(url: string | null, fallback: string | null) {
    const [resolved, setResolved] = useState<string | null>(fallback)

    useEffect(() => {
        if (!url) {
            setResolved(fallback)
            return
        }

        let active = true
        const img = new Image()
        img.onload = () => {
            if (active) setResolved(url)
        }
        img.onerror = () => {
            if (active) setResolved(fallback)
        }
        img.src = url

        return () => {
            active = false
        }
    }, [url, fallback])

    return resolved
}

const ThemeInfo: React.FC<Props> = ({ addon, isEnabled, themeActive, onToggleEnabled, setSelectedTags, setShowFilters }) => {
    const { t } = useTranslation()
    const [menuOpen, setMenuOpen] = useState(false)
    const nav = useNavigate()
    const actionsRef = useRef<HTMLDivElement>(null)
    const moreBtnRef = useRef<HTMLButtonElement>(null)
    const fallbackBanner = staticAsset('assets/images/no_themeBackground.png')

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

    const isMac = typeof window !== 'undefined' ? window.electron.isMac() : false
    const isGif = (fn?: string | null) => !!fn && /\.gif$/i.test(fn)

    const getAssetUrl = (file: string) =>
        `http://127.0.0.1:${config.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(file)}`

    const bannerSource = useMemo(() => {
        if (!addon.banner || (isMac && isGif(addon.banner))) return null
        return getAssetUrl(addon.banner)
    }, [addon.banner, addon.name, isMac])

    const logoSource = useMemo(() => {
        if (!addon.libraryLogo || (isMac && isGif(addon.libraryLogo))) return null
        return getAssetUrl(addon.libraryLogo)
    }, [addon.libraryLogo, addon.name, isMac])

    const bannerUrl = useResolvedImage(bannerSource, fallbackBanner)
    const logoUrl = useResolvedImage(logoSource, null)

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

