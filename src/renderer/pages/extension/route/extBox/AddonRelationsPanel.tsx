import React, { useContext, useMemo } from 'react'
import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MdChevronRight, MdExtension, MdIntegrationInstructions, MdInvertColors } from 'react-icons/md'

import AddonInterface from '@entities/addon/model/addon.interface'
import UserContext from '@entities/user/model/context'
import * as s from '@pages/extension/route/extensionview.module.scss'

interface Props {
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
}

const AddonRelationsPanel: React.FC<Props> = ({ addon, relationLabels = {} }) => {
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
        (ids || []).map(value => {
            const id = String(value || '').trim()
            const installedAddon = installedAddonMap.get(id) || null

            return {
                id,
                kind,
                label: relationLabels[id] || installedAddon?.name || id,
                isInstalled: !!installedAddon,
                isEnabled: !!installedAddon?.enabled,
                addonType: installedAddon?.type,
                installSource: installedAddon?.installSource,
                directoryName: installedAddon?.directoryName,
            }
        })

    const dependencyItems = useMemo(() => buildRelationItems(addon.dependencies, 'dependency'), [addon.dependencies, installedAddonMap, relationLabels])
    const conflictItems = useMemo(() => buildRelationItems(addon.conflictsWith, 'conflict'), [addon.conflictsWith, installedAddonMap, relationLabels])

    if (!dependencyItems.length && !conflictItems.length) {
        return null
    }

    const renderCard = (item: RelationItem) => {
        const isConflictActive = item.kind === 'conflict' && item.isEnabled
        const statusText =
            item.kind === 'dependency' ?
                item.isEnabled ?
                    t('extensions.relations.statusEnabled')
                : item.isInstalled ?
                    t('extensions.relations.statusInstalled')
                :   t('extensions.relations.statusMissing')
            : item.isEnabled ?
                t('extensions.relations.statusConflictActive')
            : item.isInstalled ?
                t('extensions.relations.statusInstalled')
            :   t('extensions.relations.statusNotInstalled')

        const statusToneClass =
            item.kind === 'dependency' ?
                item.isEnabled ?
                    s.relationCardStatusSuccess
                : item.isInstalled ?
                    s.relationCardStatusNeutral
                :   s.relationCardStatusMuted
            : isConflictActive ? s.relationCardStatusDanger
            : item.isInstalled ? s.relationCardStatusNeutral
            :   s.relationCardStatusMuted

        const sourceText =
            item.isInstalled ?
                item.installSource === 'store' ?
                    t('extensions.source.store')
                :   t('extensions.source.local')
            :   item.id

        const icon =
            item.addonType === 'theme' ? <MdInvertColors size={18} />
            : item.addonType === 'script' ? <MdIntegrationInstructions size={18} />
            : <MdExtension size={18} />

        const isInteractive = !!item.directoryName

        const content = (
            <>
                <div className={cn(s.relationCardIcon, isConflictActive && s.relationCardIconDanger)}>{icon}</div>
                <div className={s.relationCardBody}>
                    <div className={s.relationCardTopRow}>
                        <div className={s.relationCardTitle}>{item.label}</div>
                        <div className={cn(s.relationCardStatus, statusToneClass)}>{statusText}</div>
                    </div>
                    <div className={s.relationCardMetaRow}>
                        {item.addonType && <span className={s.relationCardType}>{t(`store.kind.${item.addonType}`)}</span>}
                        <span className={s.relationCardMeta}>{sourceText}</span>
                    </div>
                </div>
                {isInteractive && <MdChevronRight className={s.relationCardChevron} size={18} />}
            </>
        )

        if (!isInteractive) {
            return (
                <div key={`${item.kind}-${item.id}`} className={cn(s.relationCard, s.relationCardStatic)}>
                    {content}
                </div>
            )
        }

        return (
            <button
                key={`${item.kind}-${item.id}`}
                type="button"
                className={cn(s.relationCard, s.relationCardButton)}
                onClick={() => navigate(`/${encodeURIComponent(item.directoryName || '')}`)}
            >
                {content}
            </button>
        )
    }

    return (
        <section className={s.relationsLayout}>
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
