import React from 'react'
import ConfigurationSection from './ConfigurationSection'
import { MdAdd } from 'react-icons/md'
import * as styles from './ConfigurationSettings.module.scss'
import { ThemeConfig, ButtonAction } from './types'

interface ConfigurationSettingsProps {
    configData: ThemeConfig
    editMode: boolean
    updateConfigField: (
        sectionIndex: number,
        itemIndex: number | null,
        key: string,
        value: any,
    ) => void
    updateButtonConfig: (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
        key: keyof ButtonAction,
        newValue: string,
    ) => void
    resetConfigField: (sectionIndex: number, itemIndex: number) => void
    resetButtonConfig: (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
    ) => void
    addSection: () => void
    removeSection: (sectionIndex: number) => void
    addItem: (sectionIndex: number, itemType: string) => void
    removeItem: (sectionIndex: number, itemIndex: number) => void
    newSectionTitle: string
    setNewSectionTitle: React.Dispatch<React.SetStateAction<string>>
}

const ConfigurationSettings: React.FC<ConfigurationSettingsProps> = ({
    configData,
    editMode,
    updateConfigField,
    updateButtonConfig,
    resetConfigField,
    resetButtonConfig,
    addSection,
    removeSection,
    addItem,
    removeItem,
    newSectionTitle,
    setNewSectionTitle,
}) => {
    return (
        <div className={styles.configContent}>
            {editMode && (
                <div className={styles.addSectionContainer}>
                    <input
                        type="text"
                        className={styles.addSectionInput}
                        value={newSectionTitle}
                        onChange={(e) => setNewSectionTitle(e.target.value)}
                        placeholder="Название секции"
                    />
                    <button
                        className={styles.addSectionButton}
                        onClick={addSection}
                        disabled={!newSectionTitle.trim()}
                        title="Добавить секцию"
                    >
                        <MdAdd /> Добавить секцию
                    </button>
                </div>
            )}
            <div className={styles.settingsContent}>
                {configData.sections.map((section, sectionIndex) => (
                    <ConfigurationSection
                        key={sectionIndex}
                        section={section}
                        sectionIndex={sectionIndex}
                        editMode={editMode}
                        updateConfigField={updateConfigField}
                        updateButtonConfig={updateButtonConfig}
                        resetConfigField={resetConfigField}
                        resetButtonConfig={resetButtonConfig}
                        addItem={addItem}
                        removeItem={removeItem}
                        removeSection={removeSection}
                    />
                ))}
            </div>
        </div>
    )
}

export default ConfigurationSettings
