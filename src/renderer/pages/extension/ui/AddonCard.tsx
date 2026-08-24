import React from 'react'

import { Skeleton } from '@pulsesync/uikit/feedback'
import { DropdownMenu, type DropdownMenuItem } from '@pulsesync/uikit/navigation'
import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { MdCheckCircle, MdFavorite, MdFavoriteBorder, MdFolderOpen, MdMoreHoriz, MdShare } from 'react-icons/md'

import config from '@common/appConfig'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import { isAddonAuthor, isRestrictedLegacyAddon } from '@entities/addon/lib/legacyAddonRestrictions'
import LegacyAddonRestrictionBadge from '@entities/addon/ui/LegacyAddonRestrictionBadge'
import userContext from '@entities/user/model/context'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'
import toast from '@shared/ui/toast'
import TooltipButton from '@shared/ui/tooltip_button'

import * as extensionStylesV2 from '@pages/extension/extension.module.scss'

import type { DesktopAddonOrganizationCategory } from '@common/desktopApi/contract'
import type Addon from '@entities/addon/model/addon.interface'

type Props = {
    addon: Addon
    categories: DesktopAddonOrganizationCategory[]
    categoryId: string | null
    currentTheme: string
    enabledScripts: string[]
    fallbackAddonImage: string
    getImagePath: (addon: Addon) => string
    imageReady: boolean
    isActive: boolean
    isDragging: boolean
    isFavorite: boolean
    onAssignCategory: (addon: Addon, categoryId: string | null) => void
    onClick: (addon: Addon) => void
    onDisable: (addon: Addon) => void
    onDragEnd: () => void
    onDragStart: (addon: Addon, event: React.DragEvent<HTMLDivElement>) => void
    onEnable: (addon: Addon) => void
    onSetFavorite: (addon: Addon, favorite: boolean) => void
}

type AddonImageProps = {
    alt: string
    fallbackSrc: string
    ready: boolean
    src: string
}

function AddonImage({ alt, fallbackSrc, ready, src }: AddonImageProps) {
    const [resolvedSrc, setResolvedSrc] = React.useState(src)
    const [loaded, setLoaded] = React.useState(false)

    return (
        <span className={extensionStylesV2.addonImageFrame}>
            {!ready || !loaded ? <Skeleton width={22} height={22} borderRadius={4} className={extensionStylesV2.addonImageSkeleton} /> : null}
            <img
                src={resolvedSrc}
                alt={alt}
                className={cn(extensionStylesV2.addonImage, ready && loaded && extensionStylesV2.addonImageVisible)}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => {
                    if (resolvedSrc === fallbackSrc) {
                        setLoaded(true)
                        return
                    }

                    setLoaded(false)
                    setResolvedSrc(fallbackSrc)
                }}
            />
        </span>
    )
}

export default function AddonCard({
    addon,
    categories,
    categoryId,
    currentTheme,
    enabledScripts,
    fallbackAddonImage,
    getImagePath,
    imageReady,
    isActive,
    isDragging,
    isFavorite,
    onAssignCategory,
    onClick,
    onDisable,
    onDragEnd,
    onDragStart,
    onEnable,
    onSetFavorite,
}: Props) {
    const { t } = useTranslation()
    const { isExperimentEnabled, loading: experimentsLoading } = useExperiments()
    const { user } = React.useContext(userContext)
    const isEnabled = addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)
    const legacyAddonRestrictionsEnabled = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientLegacyAddonRestrictions, false)
    const showLegacyRestriction = isRestrictedLegacyAddon(addon, legacyAddonRestrictionsEnabled) && isAddonAuthor(addon, user)
    const storeAddonId = String(addon.storeAddonId || '').trim()
    const imagePath = getImagePath(addon)
    const organizationLabel = t('extensions.organization.organizeAddon', { name: addon.name })
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
    const organizationItems: DropdownMenuItem[] = [
        {
            key: 'favorite',
            label: isFavorite ? t('extensions.organization.removeFavorite') : t('extensions.organization.addFavorite'),
            icon: isFavorite ? <MdFavorite /> : <MdFavoriteBorder />,
            toggle: true,
            checked: isFavorite,
            onClick: () => onSetFavorite(addon, !isFavorite),
            divider: !storeAddonId,
        },
        ...(storeAddonId
            ? [
                  {
                      key: 'share',
                      label: t('store.share'),
                      icon: <MdShare />,
                      onClick: () => void copyShareLink(),
                      divider: true,
                  },
              ]
            : []),
        {
            key: 'category',
            label: t('extensions.organization.moveToCategory'),
            icon: <MdFolderOpen />,
            children: [
                {
                    key: 'category-none',
                    label: t('extensions.organization.uncategorized'),
                    radio: true,
                    checked: !categoryId,
                    onClick: () => onAssignCategory(addon, null),
                },
                ...categories.map(category => ({
                    key: `category-${category.id}`,
                    label: category.name,
                    radio: true,
                    checked: categoryId === category.id,
                    onClick: () => onAssignCategory(addon, category.id),
                })),
            ],
        },
    ]

    return (
        <div
            key={addon.directoryName}
            draggable
            className={cn(
                extensionStylesV2.addonCard,
                isActive && extensionStylesV2.addonCardSelected,
                isDragging && extensionStylesV2.addonCardDragging,
                showLegacyRestriction && extensionStylesV2.addonCardWithLegacyRestriction,
            )}
            onClick={() => onClick(addon)}
            onDragStart={event => onDragStart(addon, event)}
            onDragEnd={onDragEnd}
        >
            <div
                className={cn(
                    extensionStylesV2.checkSelect,
                    isEnabled && extensionStylesV2.checkSelectEnabled,
                    addon.type === 'theme' ? extensionStylesV2.checkMarkTheme : extensionStylesV2.checkMarkScript,
                )}
                onClick={event => {
                    event.stopPropagation()
                    if (isEnabled) {
                        onDisable(addon)
                    } else {
                        onEnable(addon)
                    }
                }}
            >
                <MdCheckCircle size={18} />
            </div>
            <AddonImage key={imagePath} src={imagePath} fallbackSrc={fallbackAddonImage} alt={addon.name} ready={imageReady} />
            <div className={extensionStylesV2.addonName}>{addon.name}</div>
            <div className={extensionStylesV2.addonMeta}>
                {showLegacyRestriction ? <LegacyAddonRestrictionBadge className={extensionStylesV2.legacyRestrictionBadge} /> : null}
                <div className={extensionStylesV2.addonType} aria-hidden>
                    <img
                        src={staticAsset(addon.type === 'theme' ? 'assets/icons/ui/addon-type-sun.svg' : 'assets/icons/ui/addon-type-array.svg')}
                        alt=""
                    />
                </div>
            </div>
            <div className={extensionStylesV2.addonOrganizerSlot} onClick={event => event.stopPropagation()}>
                <DropdownMenu items={organizationItems} menuClassName={extensionStylesV2.addonOrganizerMenu} placement="right-start">
                    <TooltipButton tooltipText={organizationLabel} side="right" as="div" className={extensionStylesV2.addonOrganizerTooltip}>
                        <button type="button" className={extensionStylesV2.addonOrganizerButton} aria-label={organizationLabel}>
                            <MdMoreHoriz aria-hidden />
                        </button>
                    </TooltipButton>
                </DropdownMenu>
            </div>
        </div>
    )
}
