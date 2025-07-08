import React, { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { MdMoreHoriz, MdStoreMallDirectory } from 'react-icons/md'
import AddonInterface from '../../../../../api/interfaces/addon.interface'
import Button from '../../../../../components/button'
import ViewModal from '../../../../../components/context_menu_themes/viewModal'
import { createContextMenuActions } from '../../../../../components/context_menu_themes/sectionConfig'
import { useUserProfileModal } from '../../../../../context/UserProfileModalContext'
import * as s from './ThemeInfo.module.scss'

interface Props {
    addon: AddonInterface
    isEnabled: boolean
    themeActive: boolean
    onToggleEnabled: () => void

    setSelectedTags?: React.Dispatch<React.SetStateAction<Set<string>>>
    setShowFilters?: (show: boolean) => void
}

const ThemeInfo: React.FC<Props> = ({ addon, isEnabled, themeActive, onToggleEnabled, setSelectedTags, setShowFilters }) => {
    const { openUserProfile } = useUserProfileModal()
    const [menuOpen, setMenuOpen] = useState(false)
    const nav = useNavigate()
    const ref = useRef<HTMLDivElement>(null)

    const authorNames = typeof addon.author === 'string' ? addon.author.split(', ') : addon.author

    const bannerUrl = useMemo(
        () => (addon.banner ? encodeURI(`${addon.path}/${addon.banner}`.replace(/\\/g, '/')) : 'static/assets/images/no_themeBackground.png'),
        [addon.banner, addon.path],
    )

    const libraryLogo = useMemo(
        () => (addon.libraryLogo ? encodeURI(`${addon.path}/${addon.libraryLogo}`.replace(/\\/g, '/')) : null),
        [addon.libraryLogo, addon.path],
    )

    return (
        <>
            <div className={s.themeInfo} style={{ backgroundImage: `url(${bannerUrl})` }}>
                <div className={s.content}>
                    <div className={s.libraryLogo}>
                        {libraryLogo ? (
                            <img className={s.libraryLogoImg} src={libraryLogo} alt="Library Logo" />
                        ) : (
                            <div className={s.libraryLogoText}>{addon.name}</div>
                        )}
                    </div>
                </div>
            </div>
            <div className={s.topTags}>
                {addon.tags && addon.tags.length > 0 &&
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
                    ))
                }
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
                    <Button className={`${s.toggleButton} ${isEnabled ? s.enabledState : s.disabledState}`} onClick={onToggleEnabled}>
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
