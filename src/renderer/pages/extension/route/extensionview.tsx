import React, { useEffect, useMemo, useState } from 'react'
import { MdEdit } from 'react-icons/md'

import Scrollbar from '../../../components/PSUI/Scrollbar'
import TabNavigation from './extBox/TabNavigation'
import TabContent from './extBox/TabContent'
import ThemeInfo from './extBox/ThemeInfo'
import { useAddonFiles } from './extBox/hooks'
import { useConfig } from './extBox/useConfig'
import { ExtensionViewProps, ActiveTab } from './extBox/types'

import toast from '../../../components/toast'
import * as s from './extensionview.module.scss'

const ExtensionView: React.FC<ExtensionViewProps> = ({ addon, isEnabled, setSelectedTags, setShowFilters, onToggleEnabled }) => {
    const { docs, config, configExists } = useAddonFiles(addon)
    const cfg = useConfig(addon.path, config)

    const [activeTab, setActiveTab] = useState<ActiveTab>('Settings')
    const [editMode, setEditMode] = useState(false)

    useEffect(() => {
        if (docs.length && activeTab === 'Settings') setActiveTab(docs[0].title)
    }, [docs])

    useEffect(() => {
        if (!docs.length) setActiveTab('Settings')
    }, [docs])

    const themeActive = useMemo(() => isEnabled && addon.type === 'theme', [isEnabled, addon.type])

    const toggleWithToast = (enabled: boolean) => {
        onToggleEnabled(enabled)
        toast.custom(
            enabled ? 'success' : 'info',
            addon.type === 'theme' ? (enabled ? 'Тема активирована' : 'Тема деактивирована') : enabled ? 'Скрипт включён' : 'Скрипт выключен',
            addon.name,
        )
    }

    return (
        <div className={s.container}>
            <Scrollbar className={s.containerFix} classNameInner={s.containerFixInner}>
                {activeTab === 'Settings' && configExists && (
                    <button
                        className={`${s.edit} ${editMode ? s.activeEdit : ''}`}
                        onClick={() => setEditMode(e => !e)}
                        title={editMode ? 'Выйти из режима редактирования' : 'Войти в режим редактирования'}
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
                        active={activeTab}
                        docs={docs}
                        description={addon.description}
                        configExists={configExists}
                        config={cfg.config}
                        configApi={cfg}
                        editMode={editMode}
                        addonPath={addon.path}
                    />
                </div>
            </Scrollbar>
        </div>
    )
}

export default ExtensionView
