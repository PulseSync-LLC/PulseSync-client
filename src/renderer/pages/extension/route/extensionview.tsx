import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'

import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { MdEdit } from 'react-icons/md'

import { prefersInstalledMetadata, rememberInstalledMetadata } from '@pages/extension/model/addonProjectPreferences'
import { useAddonFiles } from '@pages/extension/route/extBox/hooks'
import TabContent from '@pages/extension/route/extBox/TabContent'
import TabNavigation from '@pages/extension/route/extBox/TabNavigation'
import { selectDefaultExtensionTab } from '@pages/extension/route/extBox/tabSelection'
import ThemeInfo from '@pages/extension/route/extBox/ThemeInfo'
import { RELATIONS_TAB } from '@pages/extension/route/extBox/types'
import { useConfig } from '@pages/extension/route/extBox/useConfig'
import AddonProjectEditor from '@pages/extension/ui/AddonProjectEditor'
import UserContext from '@entities/user/model/context'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'

import * as s from '@pages/extension/route/extensionview.module.scss'

import type { ActiveTab, ExtensionViewProps } from '@pages/extension/route/extBox/types'

const ExtensionView: React.FC<ExtensionViewProps> = ({
    addon,
    onEditProject,
    project,
    onResetProjectLink,
    onProjectDirtyChange,
    onProjectSavingChange,
    isEnabled,
    addonRelationsEnabled = false,
    relationLabels,
    relationStoreAddons,
    relationsLoading,
    relationsLoadFailed,
    dependencyInstallBusy,
    onInstallDependency,
    onInstallDependencies,
    onRetryRelations,
    enableBlockedReason,
    hasStoreUpdate,
    storeUpdateBusy,
    storeChannelLoading,
    availableStoreChannels,
    onStoreChannelChange,
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
    const [metadataProjectPromptOpen, setMetadataProjectPromptOpen] = useState(false)
    const tabRequest = useRef(0)
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

    useEffect(() => {
        setMetadataProjectPromptOpen(false)
        tabRequest.current++
        return () => {
            tabRequest.current++
        }
    }, [addon.path])

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

    const toggleWithToast = (enabled: boolean) => {
        onToggleEnabled(enabled)
    }

    const changeTab = async (tab: ActiveTab) => {
        const request = ++tabRequest.current
        if (tab === 'Metadata' && addon.type === 'web-addon' && canEditMetadata && onEditProject) {
            const opened = await onEditProject(true)
            if (request !== tabRequest.current || opened) return
            if (prefersInstalledMetadata(addon.directoryName)) {
                setActiveTab('Metadata')
                return
            }
            setMetadataProjectPromptOpen(true)
            return
        }
        setActiveTab(tab)
    }

    const renderTabContent = (active: ActiveTab) => (
        <TabContent
            key={addon.path}
            active={active}
            docs={docs}
            configExists={configExists}
            config={config}
            editConfig={editConfig}
            configApi={configApi}
            editMode={editMode}
            addon={addon}
            addonRelationsEnabled={addonRelationsEnabled}
            relationLabels={relationLabels}
            relationStoreAddons={relationStoreAddons}
            relationsLoading={relationsLoading}
            relationsLoadFailed={relationsLoadFailed}
            dependencyInstallBusy={dependencyInstallBusy}
            onInstallDependency={onInstallDependency}
            onRetryRelations={onRetryRelations}
            canEditMetadata={canEditMetadata}
            publicationReleases={publicationReleases}
        />
    )

    return (
        <div className={s.container}>
            <CustomModalPS
                isOpen={metadataProjectPromptOpen && canEditMetadata}
                onClose={() => setMetadataProjectPromptOpen(false)}
                title={t('extensions.project.metadataPromptTitle')}
                text={t('extensions.project.metadataPromptDescription')}
                subText={t('extensions.project.metadataPromptSource')}
                buttons={[
                    {
                        text: t('extensions.project.continueHere'),
                        variant: 'secondary',
                        onClick: () => {
                            rememberInstalledMetadata(addon.directoryName)
                            setMetadataProjectPromptOpen(false)
                            setActiveTab('Metadata')
                        },
                    },
                    {
                        text: t('extensions.project.open'),
                        onClick: () => {
                            setMetadataProjectPromptOpen(false)
                            void onEditProject?.()
                        },
                    },
                ]}
            />
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
                    onEditProject={onEditProject}
                    isEnabled={isEnabled}
                    enableBlockedReason={enableBlockedReason}
                    dependencyInstallBusy={dependencyInstallBusy}
                    onInstallDependencies={onInstallDependencies}
                    hasStoreUpdate={hasStoreUpdate}
                    storeUpdateBusy={storeUpdateBusy}
                    storeChannelLoading={storeChannelLoading}
                    availableStoreChannels={availableStoreChannels}
                    onStoreChannelChange={onStoreChannelChange}
                    onStoreUpdate={onStoreUpdate}
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
                {project ? (
                    <AddonProjectEditor
                        key={project.id}
                        project={project}
                        onResetLink={onResetProjectLink ?? (() => {})}
                        onDirtyChange={onProjectDirtyChange ?? (() => {})}
                        onSavingChange={onProjectSavingChange ?? (() => {})}
                        settingsContent={renderTabContent('Settings')}
                    />
                ) : (
                    <>
                        <TabNavigation
                            active={activeTab}
                            onChange={changeTab}
                            docs={docs}
                            hasPublicationChangelog={publicationReleases.length > 0}
                            hasRelations={hasRelations}
                            showMetadataTab={canEditMetadata}
                        />
                        <Scrollbar className={s.detailScroll} classNameInner={s.detailScrollInner}>
                            <div className={s.extensionContent}>{renderTabContent(activeTab)}</div>
                        </Scrollbar>
                    </>
                )}
            </div>
        </div>
    )
}

export default ExtensionView
