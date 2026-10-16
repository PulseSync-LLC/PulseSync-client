import React, { useContext, useMemo } from 'react'

import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { MdChevronRight, MdExtension, MdIntegrationInstructions, MdInvertColors } from 'react-icons/md'
import { useNavigate } from 'react-router'

import UserContext from '@entities/user/model/context'
import Button from '@shared/ui/buttonV2'

import * as s from '@pages/extension/route/extensionview.module.scss'

import type AddonInterface from '@entities/addon/model/addon.interface'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'
import type { AddonRelationsProps } from '@pages/extension/route/extBox/types'

interface Props extends AddonRelationsProps {
    addon: AddonInterface
    relationLabels?: Record<string, string>
}

type RelationKind = 'dependency' | 'conflict'

type RelationItem = {
    id: string
    kind: RelationKind
    label: string
    isInstalled: boolean
    isEnabled: boolean
    addonType?: AddonInterface['type']
    installSource?: AddonInterface['installSource']
    directoryName?: string
    storeAddon?: StoreAddon
}

const AddonRelationsPanel: React.FC<Props> = ({
    addon,
    relationLabels = {},
    relationStoreAddons = [],
    relationsLoading = false,
    relationsLoadFailed = false,
    dependencyInstallBusy = false,
    onInstallDependency,
    onRetryRelations,
}) => {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { addons } = useContext(UserContext)

    const installedAddonMap = useMemo(() => {
        const map = new Map<string, AddonInterface>()

        addons.forEach(item => {
            const ids = [item.id, item.storeAddonId].map(value => String(value || '').trim()).filter(Boolean)
            ids.forEach(id => map.set(id, item))
        })

        return map
    }, [addons])

    const buildRelationItems = (ids: string[] | undefined, kind: RelationKind): RelationItem[] =>
        Array.from(new Set((ids || []).map(value => value.trim()).filter(Boolean))).map(value => {
            const id = String(value || '').trim()
            const installedAddon = installedAddonMap.get(id) || null
            const storeAddon =
                relationStoreAddons.find(item => item.id === id) || relationStoreAddons.find(item => item.currentRelease?.metadataId === id)

            return {
                id,
                kind,
                label: installedAddon?.name || storeAddon?.name || relationLabels[id] || t('extensions.relations.unknownAddon'),
                isInstalled: !!installedAddon,
                isEnabled: !!installedAddon?.enabled,
                addonType: installedAddon?.type || storeAddon?.type,
                installSource: installedAddon?.installSource,
                directoryName: installedAddon?.directoryName,
                storeAddon,
            }
        })

    const dependencyItems = useMemo(
        () => buildRelationItems(addon.dependencies, 'dependency'),
        [addon.dependencies, installedAddonMap, relationLabels, relationStoreAddons, t],
    )
    const conflictItems = useMemo(
        () => buildRelationItems(addon.conflictsWith, 'conflict'),
        [addon.conflictsWith, installedAddonMap, relationLabels, relationStoreAddons, t],
    )

    if (!dependencyItems.length && !conflictItems.length) {
        return null
    }

    const renderCard = (item: RelationItem) => {
        const isConflictActive = item.kind === 'conflict' && item.isEnabled
        const statusText =
            item.kind === 'dependency'
                ? item.isEnabled
                    ? t('extensions.relations.statusEnabled')
                    : item.isInstalled
                      ? t('extensions.relations.statusInstalled')
                      : t('extensions.relations.statusMissing')
                : item.isEnabled
                  ? t('extensions.relations.statusConflictActive')
                  : item.isInstalled
                    ? t('extensions.relations.statusInstalled')
                    : t('extensions.relations.statusNotInstalled')

        const statusToneClass =
            item.kind === 'dependency'
                ? item.isEnabled
                    ? s.relationCardStatusSuccess
                    : item.isInstalled
                      ? s.relationCardStatusNeutral
                      : s.relationCardStatusMuted
                : isConflictActive
                  ? s.relationCardStatusDanger
                  : item.isInstalled
                    ? s.relationCardStatusNeutral
                    : s.relationCardStatusMuted

        const sourceText = item.isInstalled
            ? t(item.installSource === 'store' ? 'extensions.source.store' : 'extensions.source.local')
            : item.storeAddon
              ? item.storeAddon.currentRelease?.authors.join(', ') || t('extensions.source.store')
              : relationsLoading
                ? t('extensions.relations.loading')
                : relationsLoadFailed
                  ? t('extensions.relations.loadFailed')
                  : t('extensions.relations.unavailable')
        const canInstall =
            item.kind === 'dependency' &&
            !item.isInstalled &&
            item.storeAddon?.currentRelease?.status === 'accepted' &&
            !!item.storeAddon.currentRelease.downloadUrl &&
            !!onInstallDependency

        const icon =
            item.addonType === 'theme' ? (
                <MdInvertColors size={18} />
            ) : item.addonType === 'script' ? (
                <MdIntegrationInstructions size={18} />
            ) : (
                <MdExtension size={18} />
            )

        const openAddon = () => {
            if (item.directoryName) navigate(`/${encodeURIComponent(item.directoryName)}`)
            else if (item.storeAddon) navigate('/store', { state: { openAddon: item.storeAddon } })
        }
        const isInteractive = !!item.directoryName || !!item.storeAddon
        const avatarUrl = item.storeAddon?.currentRelease?.avatarUrl

        const content = (
            <>
                <div className={cn(s.relationCardIcon, isConflictActive && s.relationCardIconDanger)}>
                    {icon}
                    {avatarUrl && (
                        <img
                            className={s.relationCardImage}
                            src={avatarUrl}
                            alt=""
                            onError={event => {
                                event.currentTarget.hidden = true
                            }}
                        />
                    )}
                </div>
                <div className={s.relationCardBody}>
                    <div className={s.relationCardTopRow}>
                        {isInteractive ? (
                            <button type="button" className={s.relationCardTitleButton} onClick={openAddon}>
                                {item.label}
                                <MdChevronRight size={18} />
                            </button>
                        ) : (
                            <div className={s.relationCardTitle}>{item.label}</div>
                        )}
                    </div>
                    <div className={s.relationCardMetaRow}>
                        {item.addonType && <span className={s.relationCardType}>{t(`store.kind.${item.addonType}`)}</span>}
                        <span className={s.relationCardMeta}>{sourceText}</span>
                    </div>
                    {!item.isInstalled && !item.storeAddon && !relationsLoading && (
                        <div className={s.relationCardMeta} title={item.id}>
                            ID: {item.id}
                        </div>
                    )}
                </div>
                <div className={s.relationCardActions}>
                    {canInstall ? (
                        <Button disabled={dependencyInstallBusy || relationsLoading} onClick={() => onInstallDependency?.(item.id)}>
                            {dependencyInstallBusy ? t('common.importing') : t('extensions.relations.install')}
                        </Button>
                    ) : (
                        <span className={cn(s.relationCardStatus, statusToneClass)}>{statusText}</span>
                    )}
                </div>
            </>
        )

        return (
            <div key={`${item.kind}-${item.id}`} className={s.relationCard}>
                {content}
            </div>
        )
    }

    return (
        <section className={s.relationsLayout}>
            {relationsLoadFailed && (
                <div className={s.relationsSectionHeader}>
                    <div className={s.relationsSectionText}>{t('extensions.relations.loadFailed')}</div>
                    <Button onClick={onRetryRelations}>{t('extensions.relations.retry')}</Button>
                </div>
            )}
            {dependencyItems.length > 0 && (
                <div className={s.relationsSection}>
                    <div className={s.relationsSectionHeader}>
                        <div className={s.relationsSectionTitle}>{t('extensions.meta.dependencies')}</div>
                        <div className={s.relationsSectionText}>{t('extensions.relations.dependenciesHint')}</div>
                    </div>
                    <div className={s.relationsCardList}>{dependencyItems.map(renderCard)}</div>
                </div>
            )}

            {conflictItems.length > 0 && (
                <div className={s.relationsSection}>
                    <div className={s.relationsSectionHeader}>
                        <div className={s.relationsSectionTitle}>{t('extensions.meta.conflictsWith')}</div>
                        <div className={s.relationsSectionText}>{t('extensions.relations.conflictsHint')}</div>
                    </div>
                    <div className={s.relationsCardList}>{conflictItems.map(renderCard)}</div>
                </div>
            )}
        </section>
    )
}

export default AddonRelationsPanel
