import React, { useContext, useEffect, useMemo, useState } from 'react'

import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { MdEdit } from 'react-icons/md'

import { useAddonFiles } from '@pages/extension/route/extBox/hooks'
import TabContent from '@pages/extension/route/extBox/TabContent'
import TabNavigation from '@pages/extension/route/extBox/TabNavigation'
import { selectDefaultExtensionTab } from '@pages/extension/route/extBox/tabSelection'
import ThemeInfo from '@pages/extension/route/extBox/ThemeInfo'
import { RELATIONS_TAB } from '@pages/extension/route/extBox/types'
import { useConfig } from '@pages/extension/route/extBox/useConfig'
import UserContext from '@entities/user/model/context'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'

import * as s from '@pages/extension/route/extensionview.module.scss'

import type { ActiveTab, ExtensionViewProps} from '@pages/extension/route/extBox/types';

const ExtensionView: React.FC<ExtensionViewProps> = ({
    addon,
    isEnabled,
    addonRelationsEnabled = false,
    relationLabels,
    enableBlockedReason,
    hasStoreUpdate,
    storeUpdateBusy,
    onStoreUpdate,
    setSelectedTags,
    setShowFilters,
    onToggleEnabled,
    publication,
    publicationReleases = [],
    publicationChangelogText = '',
    publicationGithubUrlText = '',
    canManagePublication,
    publicationBusy,
    onPublicationChangelogChange,
    onPublicationGithubUrlChange,
    onPublishAddon,
    onUpdateAddon,
}) => {
    const { t } = useTranslation()
    const { user } = useContext(UserContext)
    const { docs } = useAddonFiles(addon)
    const { configExists, config, editConfig, configApi } = useConfig(addon)

    const [activeTab, setActiveTab] = useState<ActiveTab>('README' as ActiveTab)
    const [editMode, setEditMode] = useState(false)
    const hasRelations = useMemo(
        () => Boolean(addonRelationsEnabled && (addon.dependencies?.length || addon.conflictsWith?.length)),
        [addon.conflictsWith?.length, addon.dependencies?.length, addonRelationsEnabled],
    )
    const shouldOpenRelationsByDefault = useMemo(() => Boolean(hasRelations && enableBlockedReason), [enableBlockedReason, hasRelations])
    const hasPublicationChangelog = publicationReleases.length > 0

    useEffect(() => {
        setEditMode(false)
        setActiveTab(selectDefaultExtensionTab({ docs, hasPublicationChangelog, shouldOpenRelationsByDefault }))
    }, [addon.path, docs, hasPublicationChangelog, shouldOpenRelationsByDefault])

    const canEditMetadata = useMemo(() => {
        const currentUserCandidates = [user.username, user.nickname, user.id]
            .map(value =>
                String(value || '')
                    .trim()
                    .toLowerCase(),
            )
            .filter(Boolean)

        if (!currentUserCandidates.length) {
            return false
        }

        const addonAuthors = Array.isArray(addon.author) ? addon.author : typeof addon.author === 'string' ? addon.author.split(',') : []

        const normalizedAuthors = addonAuthors
            .map(author =>
                String(author || '')
                    .trim()
                    .toLowerCase(),
            )
            .filter(Boolean)
        if (!normalizedAuthors.length) {
            return false
        }

        return currentUserCandidates.some(candidate => normalizedAuthors.includes(candidate))
    }, [addon.author, user.id, user.nickname, user.username])

    useEffect(() => {
        if (activeTab === RELATIONS_TAB && !hasRelations) {
            setActiveTab(selectDefaultExtensionTab({ docs, hasPublicationChangelog }))
        }
    }, [activeTab, docs, hasPublicationChangelog, hasRelations])

    const themeActive = useMemo(() => isEnabled && addon.type === 'theme', [isEnabled, addon.type])

    const toggleWithToast = (enabled: boolean) => {
        onToggleEnabled(enabled)
    }

    return (
        <div className={s.container}>
            {activeTab === 'Settings' && configExists && addon.type !== 'web-addon' && (
                <button
                    className={cn(s.edit, editMode && s.activeEdit)}
                    onClick={() => setEditMode(e => !e)}
                    title={editMode ? t('extensions.editModeExit') : t('extensions.editModeEnter')}
                >
                    <MdEdit />
                </button>
            )}

            <Scrollbar className={s.summaryPane} classNameInner={s.summaryPaneInner}>
                <ThemeInfo
                    addon={addon}
                    isEnabled={isEnabled}
                    enableBlockedReason={enableBlockedReason}
                    hasStoreUpdate={hasStoreUpdate}
                    storeUpdateBusy={storeUpdateBusy}
                    onStoreUpdate={onStoreUpdate}
                    themeActive={themeActive}
                    onToggleEnabled={toggleWithToast}
                    publication={publication}
                    publicationChangelogText={publicationChangelogText}
                    publicationGithubUrlText={publicationGithubUrlText}
                    canManagePublication={canManagePublication}
                    publicationBusy={publicationBusy}
                    onPublicationChangelogChange={onPublicationChangelogChange}
                    onPublicationGithubUrlChange={onPublicationGithubUrlChange}
                    onPublishAddon={onPublishAddon}
                    onUpdateAddon={onUpdateAddon}
                    setSelectedTags={setSelectedTags}
                    setShowFilters={setShowFilters}
                />
            </Scrollbar>

            <div className={s.detailPane}>
                <TabNavigation
                    active={activeTab}
                    onChange={setActiveTab}
                    docs={docs}
                    hasPublicationChangelog={publicationReleases.length > 0}
                    hasRelations={hasRelations}
                    showMetadataTab={canEditMetadata}
                />
                <Scrollbar className={s.detailScroll} classNameInner={s.detailScrollInner}>
                    <div className={s.extensionContent}>
                        <TabContent
                            key={addon.path}
                            active={activeTab}
                            docs={docs}
                            configExists={configExists}
                            config={config}
                            editConfig={editConfig}
                            configApi={configApi}
                            editMode={editMode}
                            addon={addon}
                            addonRelationsEnabled={addonRelationsEnabled}
                            relationLabels={relationLabels}
                            canEditMetadata={canEditMetadata}
                            publicationReleases={publicationReleases}
                        />
                    </div>
                </Scrollbar>
            </div>
        </div>
    )
}

export default ExtensionView
