import React, { useEffect, useMemo, useState } from 'react'
import { MdEdit } from 'react-icons/md'

import Scrollbar from '../../../components/PSUI/Scrollbar'
import TabNavigation from './extBox/TabNavigation'
import TabContent from './extBox/TabContent'
import ThemeInfo from './extBox/ThemeInfo'
import { useAddonFiles } from './extBox/hooks'
import { useConfig } from './extBox/useConfig'
import { ExtensionViewProps, ActiveTab } from './extBox/types'
import { useTranslation } from 'react-i18next'

import * as s from './extensionview.module.scss'

const ExtensionView: React.FC<ExtensionViewProps> = ({ addon, isEnabled, setSelectedTags, setShowFilters, onToggleEnabled }) => {
    const { t } = useTranslation()
    const { docs } = useAddonFiles(addon)
    const { configExists, config, configApi } = useConfig(addon.path)

    const [activeTab, setActiveTab] = useState<ActiveTab>('README' as ActiveTab)
    const [editMode, setEditMode] = useState(false)

    useEffect(() => {
        setEditMode(false)
        if (docs.length) setActiveTab(docs[0].title as ActiveTab)
        else setActiveTab('Settings')
    }, [addon.path, docs])

    const themeActive = useMemo(() => isEnabled && addon.type === 'theme', [isEnabled, addon.type])

    const toggleWithToast = (enabled: boolean) => {
        onToggleEnabled(enabled)
    }

    return (
        <div className={s.container}>
            <Scrollbar className={s.containerFix} classNameInner={s.containerFixInner}>
                {activeTab === 'Settings' && configExists && (
                    <button
                        className={`${s.edit} ${editMode ? s.activeEdit : ''}`}
                        onClick={() => setEditMode(e => !e)}
                        title={editMode ? t('extensions.editModeExit') : t('extensions.editModeEnter')}
                    >
                        <MdEdit />
                    </button>
                )}

                <ThemeInfo
                    addon={addon}
                    isEnabled={isEnabled}
                    themeActive={themeActive}
                    onToggleEnabled={toggleWithToast}
                    setSelectedTags={setSelectedTags}
                    setShowFilters={setShowFilters}
                />

                <div className={s.extensionContent}>
                    <TabNavigation active={activeTab} onChange={setActiveTab} docs={docs} />
                    <TabContent
                        key={addon.path}
                        active={activeTab}
                        docs={docs}
                        configExists={configExists}
                        config={config}
                        configApi={configApi}
                        editMode={editMode}
                        addon={addon}
                    />
                </div>
            </Scrollbar>
        </div>
    )
}

export default ExtensionView
