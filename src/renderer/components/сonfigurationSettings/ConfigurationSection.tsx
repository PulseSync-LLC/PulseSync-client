import React, { useState } from 'react'
import ConfigurationItem from './ConfigurationItem'
import { MdAdd, MdCrop169, MdDelete, MdDragIndicator, MdFolderOpen, MdInvertColors, MdLinearScale, MdTextFields, MdTune } from 'react-icons/md'
import * as styles from './ConfigurationSection.module.scss'
import { Section, Item, ButtonAction } from './types'

interface ConfigurationSectionProps {
    section: Section
    sectionIndex: number
    editMode: boolean
    updateConfigField: (sectionIndex: number, itemIndex: number | null, key: string, value: any) => void
    updateButtonConfig: (sectionIndex: number, itemIndex: number, buttonIndex: number, key: keyof ButtonAction, newValue: string) => void
    resetConfigField: (sectionIndex: number, itemIndex: number) => void
    resetButtonConfig: (sectionIndex: number, itemIndex: number, buttonIndex: number) => void
    addItem: (sectionIndex: number, itemType: string) => void
    removeItem: (sectionIndex: number, itemIndex: number) => void
    removeSection: (sectionIndex: number) => void
}

const ConfigurationSection: React.FC<ConfigurationSectionProps> = ({
    section,
    sectionIndex,
    editMode,
    updateConfigField,
    updateButtonConfig,
    resetConfigField,
    resetButtonConfig,
    addItem,
    removeItem,
    removeSection,
}) => {
    return (
        <div className={styles.section}>
            {editMode ? (
                <div className={styles.sectionHeaderEdit}>
                    <div className={styles.sectionFieldEdit}>
                        <label className={styles.sectionLabelEdit}>Название секции:</label>
                        <input
                            type="text"
                            className={styles.sectionInputEdit}
                            value={section.title}
                            onChange={e => updateConfigField(sectionIndex, null, 'title', e.target.value)}
                            onBlur={e => updateConfigField(sectionIndex, null, 'title', e.target.value)}
                            placeholder="Название секции"
                        />
                    </div>
                    <div className={styles.addItemContainer}>
                        <button className={styles.addItemButton} onClick={() => addItem(sectionIndex, 'button')} title="Добавить кнопку">
                            <MdCrop169 size={24} />
                        </button>
                        <button className={styles.addItemButton} onClick={() => addItem(sectionIndex, 'color')} title="Добавить цвет">
                            <MdInvertColors size={24} />
                        </button>
                        <button className={styles.addItemButton} onClick={() => addItem(sectionIndex, 'text')} title="Добавить текст">
                            <MdTextFields size={24} />
                        </button>
                        <button className={styles.addItemButton} onClick={() => addItem(sectionIndex, 'slider')} title="Добавить слайдер">
                            <MdLinearScale size={24} />
                        </button>
                        <button className={styles.addItemButton} onClick={() => addItem(sectionIndex, 'file')} title="Добавить файл">
                            <MdFolderOpen size={24} />
                        </button>
                        <button className={styles.addItemButton} onClick={() => addItem(sectionIndex, 'selector')} title="Добавить селектор">
                            <MdTune size={24} />
                        </button>
                        <button className={styles.sectionRemoveItemButtonEdit} onClick={() => removeSection(sectionIndex)} title="Удалить секцию">
                            <MdDelete size={24} />
                        </button>
                        <div className={styles.sectionLine}></div>
                        {/* drag нужно будет сделать в будующем */}
                        <button className={styles.addItemDrag}>
                            <MdDragIndicator size={24} />
                        </button>
                    </div>
                </div>
            ) : (
                <div className={styles.sectionTitle}>{section.title}</div>
            )}

            {section.items.map((item, itemIndex) => (
                <ConfigurationItem
                    key={item.id}
                    sectionIndex={sectionIndex}
                    itemIndex={itemIndex}
                    item={item}
                    editMode={editMode}
                    updateConfigField={updateConfigField}
                    updateButtonConfig={updateButtonConfig}
                    resetConfigField={resetConfigField}
                    resetButtonConfig={resetButtonConfig}
                    removeItem={removeItem}
                />
            ))}
        </div>
    )
}

export default ConfigurationSection
