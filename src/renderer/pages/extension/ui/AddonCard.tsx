import React from 'react'
import cn from 'clsx'
import { MdCheckCircle, MdFavorite, MdFavoriteBorder, MdFolderOpen, MdMoreHoriz } from 'react-icons/md'
import { DropdownMenu, type DropdownMenuItem } from '@pulsesync/uikit/navigation'
import { useTranslation } from 'react-i18next'

import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import Addon from '@entities/addon/model/addon.interface'
import { isAddonAuthor, isRestrictedLegacyAddon } from '@entities/addon/lib/legacyAddonRestrictions'
import userContext from '@entities/user/model/context'
import LegacyAddonRestrictionBadge from '@entities/addon/ui/LegacyAddonRestrictionBadge'
import * as extensionStylesV2 from '@pages/extension/extension.module.scss'
import { staticAsset } from '@shared/lib/staticAssets'
import type { DesktopAddonOrganizationCategory } from '@common/desktopApi/contract'

type Props = {
    addon: Addon
    categories: DesktopAddonOrganizationCategory[]
    categoryId: string | null
    currentTheme: string
    enabledScripts: string[]
    fallbackAddonImage: string
    getImagePath: (addon: Addon) => string
    isActive: boolean
    isFavorite: boolean
    onAssignCategory: (addon: Addon, categoryId: string | null) => void
    onClick: (addon: Addon) => void
    onDisable: (addon: Addon) => void
    onEnable: (addon: Addon) => void
    onSetFavorite: (addon: Addon, favorite: boolean) => void
}

export default function AddonCard({
    addon,
    categories,
    categoryId,
    currentTheme,
    enabledScripts,
    fallbackAddonImage,
    getImagePath,
    isActive,
    isFavorite,
    onAssignCategory,
    onClick,
    onDisable,
    onEnable,
    onSetFavorite,
}: Props) {
    const { t } = useTranslation()
    const { isExperimentEnabled, loading: experimentsLoading } = useExperiments()
    const { user } = React.useContext(userContext)
    const isEnabled = addon.type === 'theme' ? addon.directoryName === currentTheme : enabledScripts.includes(addon.directoryName)
    const legacyAddonRestrictionsEnabled = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientLegacyAddonRestrictions, false)
    const showLegacyRestriction = isRestrictedLegacyAddon(addon, legacyAddonRestrictionsEnabled) && isAddonAuthor(addon, user)
    const organizationItems: DropdownMenuItem[] = [
        {
            key: 'favorite',
            label: isFavorite ? t('extensions.organization.removeFavorite') : t('extensions.organization.addFavorite'),
            icon: isFavorite ? <MdFavorite /> : <MdFavoriteBorder />,
            toggle: true,
            checked: isFavorite,
            onClick: () => onSetFavorite(addon, !isFavorite),
            divider: true,
        },
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
            className={cn(extensionStylesV2.addonCard, isActive && extensionStylesV2.addonCardSelected)}
            onClick={() => onClick(addon)}
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
            <img
                src={getImagePath(addon)}
                alt={addon.name}
                className={extensionStylesV2.addonImage}
                loading="lazy"
                onError={event => {
                    event.currentTarget.src = fallbackAddonImage
                }}
            />
            <div className={extensionStylesV2.addonName}>{addon.name}</div>
            {showLegacyRestriction ? <LegacyAddonRestrictionBadge className={extensionStylesV2.legacyRestrictionBadge} /> : null}
            <div className={extensionStylesV2.addonTrailing} onClick={event => event.stopPropagation()}>
                <div className={extensionStylesV2.addonType} aria-hidden>
                    <img
                        src={staticAsset(addon.type === 'theme' ? 'assets/icons/ui/addon-type-sun.svg' : 'assets/icons/ui/addon-type-array.svg')}
                        alt=""
                    />
                </div>
                <DropdownMenu
                    items={organizationItems}
                    className={extensionStylesV2.addonOrganizer}
                    menuClassName={extensionStylesV2.addonOrganizerMenu}
                    placement="right-start"
                >
                    <button
                        type="button"
                        className={extensionStylesV2.addonOrganizerButton}
                        aria-label={t('extensions.organization.organizeAddon', { name: addon.name })}
                        title={t('extensions.organization.organizeAddon', { name: addon.name })}
                    >
                        <MdMoreHoriz aria-hidden />
                    </button>
                </DropdownMenu>
            </div>
        </div>
    )
}
