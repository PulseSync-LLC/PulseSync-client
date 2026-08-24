import React, { useEffect, useMemo, useState } from 'react'

import { Skeleton } from '@pulsesync/uikit/feedback'
import { DropdownMenu, type DropdownMenuItem } from '@pulsesync/uikit/navigation'
import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { FaGithub } from 'react-icons/fa'
import { MdMoreHoriz, MdShare, MdStoreMallDirectory, MdSync } from 'react-icons/md'
import { useNavigate } from 'react-router-dom'

import config from '@common/appConfig'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import { useModalContext } from '@app/providers/modal'
import { createContextMenuActions } from '@features/context_menu_themes/sectionConfig'
import { isAddonAuthor, isRestrictedLegacyAddon } from '@entities/addon/lib/legacyAddonRestrictions'
import { useLegacyAddonMigrationModal } from '@entities/addon/lib/useLegacyAddonMigrationModal'
import LegacyAddonRestrictionBadge from '@entities/addon/ui/LegacyAddonRestrictionBadge'
import userContext from '@entities/user/model/context'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'
import Button from '@shared/ui/buttonV2'
import toast from '@shared/ui/toast'

import * as s from '@pages/extension/route/extBox/ThemeInfo/ThemeInfo.module.scss'

import type AddonInterface from '@entities/addon/model/addon.interface'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'

interface Props {
    addon: AddonInterface
    isEnabled: boolean
    enableBlockedReason?: string | null
    hasStoreUpdate?: boolean
    storeUpdateBusy?: boolean
    onStoreUpdate?: () => void
    themeActive: boolean
    onToggleEnabled: (enabled: boolean) => void
    publication?: StoreAddon | null
    publicationChangelogText?: string
    publicationGithubUrlText?: string
    canManagePublication?: boolean
    publicationBusy?: boolean
    onPublicationChangelogChange?: (value: string) => void
    onPublicationGithubUrlChange?: (value: string) => void
    onPublishAddon?: (changelogText: string, githubUrl: string, usedAiDuringDevelopment: boolean, previewPath: string) => void
    onUpdateAddon?: (changelogText: string, githubUrl: string, usedAiDuringDevelopment: boolean, previewPath: string) => void
    setSelectedTags?: React.Dispatch<React.SetStateAction<Set<string>>>
    setShowFilters?: (show: boolean) => void
}

function useResolvedImage(url: string | null, fallback: string | null) {
    const [state, setState] = useState<{
        loading: boolean
        resolved: string | null
        source: string | null
    }>(() => ({ loading: Boolean(url), resolved: url ? null : fallback, source: url }))

    useEffect(() => {
        if (!url) {
            setState({ loading: false, resolved: fallback, source: null })
            return
        }

        let active = true
        setState({ loading: true, resolved: null, source: url })
        const img = new Image()
        img.onload = () => {
            if (active) setState({ loading: false, resolved: url, source: url })
        }
        img.onerror = () => {
            if (active) setState({ loading: false, resolved: fallback, source: url })
        }
        img.src = url

        return () => {
            active = false
        }
    }, [url, fallback])

    if (state.source !== url) {
        return { loading: Boolean(url), resolved: url ? null : fallback }
    }

    return state
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
    enableBlockedReason = null,
    hasStoreUpdate = false,
    storeUpdateBusy = false,
    onStoreUpdate,
    themeActive,
    onToggleEnabled,
    publication,
    publicationChangelogText = '',
    publicationGithubUrlText = '',
    canManagePublication = false,
    publicationBusy = false,
    onPublicationChangelogChange,
    onPublicationGithubUrlChange,
    onPublishAddon,
    onUpdateAddon,
    setSelectedTags,
    setShowFilters,
}) => {
    const { t } = useTranslation()
    const { isExperimentEnabled, loading: experimentsLoading } = useExperiments()
    const { Modals, openModal, setModalState } = useModalContext()
    const { refreshAddons, user } = React.useContext(userContext)
    const nav = useNavigate()
    const fallbackBanner = staticAsset('assets/images/no_themeBackground.png')

    const authorNames = normalizeAuthorNames(addon.author)

    const [isMac, setIsMac] = useState(false)
    const isGif = (fn?: string | null) => !!fn && /\.gif$/i.test(fn)

    useEffect(() => {
        let active = true
        desktopApi.getRuntimeInfo().then(runtimeInfo => {
            if (active) {
                setIsMac(runtimeInfo.isMac)
            }
        })

        return () => {
            active = false
        }
    }, [])

    const getAssetUrl = (file: string) =>
        `http://127.0.0.1:${config.MAIN_PORT}/addon_file?directory=${encodeURIComponent(addon.directoryName)}&file=${encodeURIComponent(file)}`

    const bannerSource = useMemo(() => {
        if (!addon.banner || (isMac && isGif(addon.banner))) return null
        return getAssetUrl(addon.banner)
    }, [addon.banner, addon.directoryName, isMac])

    const logoSource = useMemo(() => {
        const logoFile = addon.libraryLogo?.trim() || addon.image?.trim()
        if (!logoFile || (isMac && isGif(logoFile))) return null
        if (/^(https?:\/\/|data:)/i.test(logoFile)) return logoFile
        return getAssetUrl(logoFile)
    }, [addon.directoryName, addon.image, addon.libraryLogo, isMac])

    const { loading: bannerLoading, resolved: bannerUrl } = useResolvedImage(bannerSource, fallbackBanner)
    const { loading: logoLoading, resolved: logoUrl } = useResolvedImage(logoSource, null)
    const hasLogo = logoLoading || Boolean(logoUrl)

    const authorsDisplay = authorNames.join(', ')
    const canAccessStore = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientExtensionStoreAccess, false)
    const storeAddonId = String(publication?.id || addon.storeAddonId || '').trim()
    const canOpenStorePublication = canAccessStore && Boolean(storeAddonId)
    const legacyAddonRestrictionsEnabled = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientLegacyAddonRestrictions, false)
    const showLegacyRestriction = isRestrictedLegacyAddon(addon, legacyAddonRestrictionsEnabled) && isAddonAuthor(addon, user)
    const openLegacyAddonMigrationModal = useLegacyAddonMigrationModal()
    const resolvedGithubUrl = (publication?.currentRelease?.githubUrl || publicationGithubUrlText || '').trim()
    const hasGithubUrl = Boolean(resolvedGithubUrl)
    const openStorePublication = () => {
        if (!storeAddonId) return
        nav('/store', {
            state: publication?.currentRelease ? { openAddon: publication, openAddonId: storeAddonId } : { openAddonId: storeAddonId },
        })
    }
    const copyShareLink = async () => {
        if (!storeAddonId) return

        const shareUrl = new URL('/open', config.WEBSITE_URL)
        shareUrl.search = `?url=store/${encodeURIComponent(storeAddonId)}`

        try {
            await desktopApi.system.writeClipboardText(shareUrl.toString())
            toast.custom('success', t('common.doneTitle'), t('store.shareCopied'))
        } catch (error) {
            console.error('[Extensions] failed to copy addon share link', error)
            toast.custom('error', t('common.errorTitle'), t('store.shareFailed'))
        }
    }
    const openPublication = () => {
        if (showLegacyRestriction) {
            openLegacyAddonMigrationModal()
            return
        }

        openModal(Modals.EXTENSION_PUBLICATION_MODAL, {
            addon,
            authorsDisplay,
            publication: publication ?? null,
            publicationBusy,
            changelogText: publicationChangelogText,
            githubUrlText: publicationGithubUrlText,
            onChangeChangelog: onPublicationChangelogChange ?? null,
            onChangeGithubUrl: onPublicationGithubUrlChange ?? null,
            onPublish: onPublishAddon ?? null,
            onUpdate: onUpdateAddon ?? null,
        })
    }
    const managementItems: DropdownMenuItem[] = [
        ...(canManagePublication
            ? [
                  {
                      key: 'publication',
                      label: t('extensions.publication.statusLabel'),
                      icon: <MdSync size={18} />,
                      onClick: openPublication,
                      divider: !storeAddonId,
                  },
              ]
            : []),
        ...(storeAddonId
            ? [
                  {
                      key: 'share',
                      label: t('store.share'),
                      icon: <MdShare size={18} />,
                      onClick: () => void copyShareLink(),
                      divider: true,
                  },
              ]
            : []),
        ...createContextMenuActions(
            undefined,
            themeActive,
            { showCheck: false, showDirectory: true, showExport: true, showDelete: true },
            addon,
            { Modals, openModal, setModalState },
            refreshAddons,
        )
            .filter(item => item.show && item.icon)
            .map((item, index) => ({ key: `management-${index}`, label: item.label, icon: item.icon, onClick: item.onClick })),
    ]
    return (
        <div className={s.summary}>
            <div className={s.themeInfo} style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}>
                {bannerLoading ? <Skeleton width="100%" height="100%" borderRadius={12} className={s.mediaSkeleton} /> : null}
            </div>

            <div className={cn(s.identityRow, !hasLogo && s.identityRowWithoutLogo)}>
                {hasLogo ? (
                    <button className={s.libraryLogo} onClick={() => nav(`/${encodeURIComponent(addon.directoryName)}`)} aria-label={addon.name}>
                        {logoLoading ? (
                            <Skeleton width="100%" height="100%" borderRadius={11} className={s.mediaSkeleton} />
                        ) : logoUrl ? (
                            <img className={s.libraryLogoImg} src={logoUrl} alt="" />
                        ) : null}
                    </button>
                ) : null}

                <div className={s.actions}>
                    {hasStoreUpdate ? (
                        <Button className={cn(s.toggleButton, s.updateState)} onClick={onStoreUpdate} disabled={storeUpdateBusy}>
                            {storeUpdateBusy ? t('common.importing') : t('layout.updateAction')}
                        </Button>
                    ) : (
                        <Button
                            className={cn(s.toggleButton, isEnabled ? s.enabledState : s.disabledState)}
                            disabled={!isEnabled && !!enableBlockedReason}
                            title={!isEnabled && enableBlockedReason ? enableBlockedReason : undefined}
                            onClick={() => onToggleEnabled(!isEnabled)}
                        >
                            {isEnabled
                                ? t('extensions.disableAction')
                                : enableBlockedReason
                                  ? t('extensions.relations.enableBlockedButtonLabel')
                                  : t('common.enable')}
                        </Button>
                    )}

                    <DropdownMenu items={managementItems} menuClassName={s.managementMenu} placement="right-start">
                        <Button className={s.miniButton} title={t('common.more')}>
                            <MdMoreHoriz size={20} />
                        </Button>
                    </DropdownMenu>
                </div>
            </div>

            <div className={s.copy}>
                <h1>{addon.name}</h1>
                {addon.description ? <p>{addon.description}</p> : null}
            </div>

            <div className={s.meta}>
                <div className={s.metaItem}>
                    <span className={s.label}>{t('extensions.meta.version')}</span>
                    <span className={s.value}>{addon.version ?? t('common.emDash')}</span>
                </div>
                <div className={s.metaItem}>
                    <span className={s.label}>{t('extensions.meta.updated')}</span>
                    <span className={s.value}>{addon.lastModified ?? t('common.emDash')}</span>
                </div>
                <div className={s.metaItem}>
                    <span className={s.label}>{t('extensions.meta.size')}</span>
                    <span className={s.value}>{addon.size ?? t('common.emDash')}</span>
                </div>
                <div className={s.metaItem}>
                    <span className={s.label}>{t('extensions.meta.source')}</span>
                    <span className={s.value}>{addon.installSource === 'store' ? t('extensions.source.store') : t('extensions.source.local')}</span>
                </div>
            </div>

            <section className={s.section}>
                <h2>{t('extensions.meta.authors')}</h2>
                <div className={s.chipList}>
                    {authorNames.map(author => (
                        <button key={author} className={s.authorChip} onClick={() => openModal(Modals.USER_PROFILE, { profileName: author })}>
                            <span /> {author}
                        </button>
                    ))}
                </div>
            </section>

            {(showLegacyRestriction || addon.tags?.length > 0) && (
                <section className={s.section}>
                    <h2>{t('extensions.meta.tags')}</h2>
                    <div className={s.chipList}>
                        {showLegacyRestriction ? <LegacyAddonRestrictionBadge className={s.legacyRestrictionTag} /> : null}
                        {addon.tags?.map(tag => (
                            <Button
                                key={tag}
                                className={s.tag}
                                onClick={() => {
                                    if (setSelectedTags && setShowFilters) {
                                        setSelectedTags(previous => new Set([...previous, tag]))
                                        setShowFilters(false)
                                    }
                                }}
                            >
                                {tag}
                            </Button>
                        ))}
                    </div>
                </section>
            )}

            {(canOpenStorePublication || hasGithubUrl) && (
                <section className={s.section}>
                    <h2>{t('extensions.linksTitle')}</h2>
                    <div className={s.linkList}>
                        {canOpenStorePublication ? (
                            <Button className={s.linkButton} onClick={openStorePublication}>
                                <MdStoreMallDirectory size={16} /> {t('extensions.actions.openStore')}
                            </Button>
                        ) : null}
                        {hasGithubUrl ? (
                            <Button className={s.linkButton} onClick={() => window.open(resolvedGithubUrl, '_blank', 'noopener,noreferrer')}>
                                <FaGithub size={16} /> {t('extensions.actions.openGithub')}
                            </Button>
                        ) : null}
                    </div>
                </section>
            )}
        </div>
    )
}

export default ThemeInfo
