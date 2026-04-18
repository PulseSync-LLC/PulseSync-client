import React, { useContext, useEffect, useMemo, useState } from 'react'
import cn from 'clsx'
import { MdEdit } from 'react-icons/md'

import Scrollbar from '@shared/ui/PSUI/Scrollbar'
import TabNavigation from '@pages/extension/route/extBox/TabNavigation'
import TabContent from '@pages/extension/route/extBox/TabContent'
import ThemeInfo from '@pages/extension/route/extBox/ThemeInfo'
import { useAddonFiles } from '@pages/extension/route/extBox/hooks'
import { useConfig } from '@pages/extension/route/extBox/useConfig'
import { ExtensionViewProps, ActiveTab, RELATIONS_TAB } from '@pages/extension/route/extBox/types'
import UserContext from '@entities/user/model/context'
import { useTranslation } from 'react-i18next'

import * as s from '@pages/extension/route/extensionview.module.scss'

const ExtensionView: React.FC<ExtensionViewProps> = ({
    addon,
    isEnabled,
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
    const { configExists, config, editConfig, configApi } = useConfig(addon.path)

    const [activeTab, setActiveTab] = useState<ActiveTab>('README' as ActiveTab)
    const [editMode, setEditMode] = useState(false)
    const [tabStickyTop, setTabStickyTop] = useState(66)
    const hasRelations = useMemo(() => Boolean(addon.dependencies?.length || addon.conflictsWith?.length), [addon.conflictsWith?.length, addon.dependencies?.length])
    const shouldOpenRelationsByDefault = useMemo(() => Boolean(hasRelations && enableBlockedReason), [enableBlockedReason, hasRelations])

    useEffect(() => {
        setEditMode(false)
        if (shouldOpenRelationsByDefault) {
            setActiveTab(RELATIONS_TAB)
        } else if (docs.length) {
            setActiveTab(docs[0].title as ActiveTab)
        }
        else setActiveTab('Settings')
    }, [addon.path, docs, shouldOpenRelationsByDefault])

    const canEditMetadata = useMemo(() => {
        const currentUserCandidates = [user.username, user.nickname, user.id]
            .map(value => String(value || '').trim().toLowerCase())
            .filter(Boolean)

        if (!currentUserCandidates.length) {
            return false
        }

        const addonAuthors =
            Array.isArray(addon.author) ?
                addon.author
            : typeof addon.author === 'string' ?
                addon.author.split(',')
            :   []

        const normalizedAuthors = addonAuthors.map(author => String(author || '').trim().toLowerCase()).filter(Boolean)
        if (!normalizedAuthors.length) {
            return false
        }

        return currentUserCandidates.some(candidate => normalizedAuthors.includes(candidate))
    }, [addon.author, user.id, user.nickname, user.username])

    useEffect(() => {
        if (activeTab === 'Metadata' && !canEditMetadata) {
            if (docs.length) {
                setActiveTab(docs[0].title as ActiveTab)
            } else {
                setActiveTab('Settings')
            }
        }
    }, [activeTab, canEditMetadata, docs])

    useEffect(() => {
        if (activeTab === RELATIONS_TAB && !hasRelations) {
            if (docs.length) {
                setActiveTab(docs[0].title as ActiveTab)
            } else {
                setActiveTab('Settings')
            }
        }
    }, [activeTab, docs, hasRelations])

    const themeActive = useMemo(() => isEnabled && addon.type === 'theme', [isEnabled, addon.type])

    const toggleWithToast = (enabled: boolean) => {
        onToggleEnabled(enabled)
    }

    return (
        <div className={s.container}>
            <Scrollbar className={s.containerFix} classNameInner={s.containerFixInner}>
                {activeTab === 'Settings' && configExists && (
                    <button
                        className={cn(s.edit, editMode && s.activeEdit)}
                        onClick={() => setEditMode(e => !e)}
                        title={editMode ? t('extensions.editModeExit') : t('extensions.editModeEnter')}
                    >
                        <MdEdit />
                    </button>
                )}

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
                    onBottomBarHeightChange={setTabStickyTop}
                />

                <div className={s.extensionContent}>
                    <TabNavigation
                        active={activeTab}
                        onChange={setActiveTab}
                        docs={docs}
                        hasPublicationChangelog={publicationReleases.length > 0}
                        hasRelations={hasRelations}
                        showMetadataTab={canEditMetadata}
                        stickyTop={tabStickyTop}
                    />
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
                        relationLabels={relationLabels}
                        canEditMetadata={canEditMetadata}
                        publicationReleases={publicationReleases}
                    />
                </div>
            </Scrollbar>
        </div>
    )
}

export default ExtensionView
