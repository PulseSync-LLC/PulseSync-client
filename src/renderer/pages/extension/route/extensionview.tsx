import React, { useMemo, useState } from 'react'
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
    const { markdown, config, configExists } = useAddonFiles(addon)
    const cfg = useConfig(addon.path, config)

    const [activeTab, setActiveTab] = useState<ActiveTab>('Overview')
    const [editMode, setEditMode] = useState(false)

    const themeActive = useMemo(() => isEnabled && addon.type === 'theme', [isEnabled, addon.type])

    const handleToggle = () => {
        onToggleEnabled(!isEnabled)
        toast.custom(
            !isEnabled ? 'success' : 'info',
            addon.type === 'theme' ? (!isEnabled ? 'Тема активирована' : 'Тема деактивирована') : !isEnabled ? 'Скрипт включён' : 'Скрипт выключен',
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
                    onToggleEnabled={handleToggle}
                    setSelectedTags={setSelectedTags}
                    setShowFilters={setShowFilters}
                />

                <TabNavigation active={activeTab} onChange={setActiveTab} />

                <div className={s.extensionContent}>
                    <TabContent
                        active={activeTab}
                        markdown={markdown}
                        description={addon.description}
                        configExists={configExists}
                        config={cfg.config}
                        configApi={cfg}
                        editMode={editMode}
                    />
                </div>
            </Scrollbar>
        </div>
    )
}

export default ExtensionView
