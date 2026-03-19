import React, { useEffect, useMemo, useRef, useState } from 'react'
import cn from 'clsx'
import { useNavigate } from 'react-router-dom'
import { MdCloudUpload, MdMoreHoriz, MdStoreMallDirectory, MdSync } from 'react-icons/md'
import AddonInterface from '@entities/addon/model/addon.interface'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'
import Button from '@shared/ui/buttonV2'
import ViewModal from '@features/context_menu_themes/viewModal'
import { createContextMenuActions } from '@features/context_menu_themes/sectionConfig'
import * as s from '@pages/extension/route/extBox/ThemeInfo/ThemeInfo.module.scss'
import config from '@common/appConfig'
import { staticAsset } from '@shared/lib/staticAssets'
import { useTranslation } from 'react-i18next'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'

interface Props {
    addon: AddonInterface
    isEnabled: boolean
    themeActive: boolean
    onToggleEnabled: (enabled: boolean) => void
    publication?: StoreAddon | null
    canManagePublication?: boolean
    publicationBusy?: boolean
    onPublishAddon?: () => void
    onUpdateAddon?: () => void
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

function normalizeAuthorNames(author: AddonInterface['author']): string[] {
    if (typeof author === 'string') {
        return author
            .split(',')
            .map(name => name.trim())
            .filter(Boolean)
    }

    return author.map(name => String(name).trim()).filter(Boolean)
}

const ThemeInfo: React.FC<Props> = ({
    addon,
    isEnabled,
    themeActive,
    onToggleEnabled,
    publication,
    canManagePublication = false,
    publicationBusy = false,
    onPublishAddon,
    onUpdateAddon,
    setSelectedTags,
    setShowFilters,
}) => {
    const { t, i18n } = useTranslation()
    const { isExperimentEnabled } = useExperiments()
    const [menuOpen, setMenuOpen] = useState(false)
    const nav = useNavigate()
    const actionsRef = useRef<HTMLDivElement>(null)
    const moreBtnRef = useRef<HTMLButtonElement>(null)
    const fallbackBanner = staticAsset('assets/images/no_themeBackground.png')

    const authorNames = normalizeAuthorNames(addon.author)

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

    const publicationStatusLabel = publication
        ? publication.status === 'accepted'
            ? t('store.status.accepted')
            : publication.status === 'rejected'
              ? t('store.status.rejected')
              : t('store.status.pending')
        : t('store.status.notPublished')

    const publicationStatusClassName = publication
        ? publication.status === 'accepted'
            ? s.statusAccepted
            : publication.status === 'rejected'
              ? s.statusRejected
              : s.statusPending
        : s.statusUnpublished

    const publicationDate = publication?.updatedAt
        ? new Intl.DateTimeFormat(i18n.language, {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
          }).format(new Date(publication.updatedAt))
        : null

    const authorsDisplay = authorNames.join(', ')
    const canAccessStore = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientExtensionStoreAccess, true)

    return (
        <>
            <div className={s.themeInfo} style={{ backgroundImage: `url(${bannerUrl})` }}>
                <div className={s.content}>
                    <div className={s.libraryLogo} onClick={() => nav(`/${encodeURIComponent(addon.directoryName)}`)}>
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
                    addon.tags.map(tag => (
                        <Button
                            key={tag}
                            className={s.tag}
                            onClick={() => {
                                if (setSelectedTags && setShowFilters) {
                                    setSelectedTags(prev => new Set([...prev, tag]))
                                    setShowFilters(false)
                                }
                            }}
                        >
                            {tag}
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

                    <div className={cn(s.metaItem, s.publicationMetaItem)}>
                        <div className={s.publicationInfo}>
                            <span className={s.label}>{t('extensions.publication.statusLabel')}</span>
                            <span className={cn(s.statusBadge, publicationStatusClassName)}>{publicationStatusLabel}</span>
                            {publicationDate ? <span className={s.statusMeta}>{t('extensions.publication.statusDate', { date: publicationDate })}</span> : null}
                            {publication?.moderationNote ? <span className={s.statusMeta}>{publication.moderationNote}</span> : null}
                        </div>
                    </div>
                </div>

                <div className={s.sideActions} ref={actionsRef}>
                    <div className={s.actions}>
                        {canManagePublication && !publication && (
                            <Button className={s.actionButton} disabled={publicationBusy} onClick={onPublishAddon} title={authorsDisplay}>
                                <MdCloudUpload size={18} />
                                <span>{publicationBusy ? t('extensions.publication.uploading') : t('extensions.publication.publish')}</span>
                            </Button>
                        )}

                        {canManagePublication && publication && (
                            <Button className={s.actionButton} disabled={publicationBusy} onClick={onUpdateAddon} title={authorsDisplay}>
                                <MdSync size={18} />
                                <span>{publicationBusy ? t('extensions.publication.uploading') : t('extensions.publication.update')}</span>
                            </Button>
                        )}

                        <Button className={cn(s.toggleButton, isEnabled ? s.enabledState : s.disabledState)} onClick={() => onToggleEnabled(!isEnabled)}>
                            {isEnabled ? t('common.disable') : t('common.enable')}
                        </Button>

                        {canAccessStore && (
                            <Button className={s.miniButton} title={t('extensions.actions.store')} onClick={() => nav('/store')}>
                                <MdStoreMallDirectory size={20} />
                            </Button>
                        )}

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

            </div>
        </>
    )
}

export default ThemeInfo
