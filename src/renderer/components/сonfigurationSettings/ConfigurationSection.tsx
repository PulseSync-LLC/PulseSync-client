import React, { useState } from 'react'
import ConfigurationItem from './ConfigurationItem'
import { MdAdd, MdDelete } from 'react-icons/md'
import * as styles from './ConfigurationSection.module.scss'
import { Section, Item, ButtonAction } from './types'

interface ConfigurationSectionProps {
    section: Section
    sectionIndex: number
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
    const [newItemType, setNewItemType] = useState<string>('button')

    const handleAddItemTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setNewItemType(e.target.value)
    }

    return (
        <div className={styles.section}>
            {editMode ? (
                <div className={styles.sectionHeader}>
                    <input
                        type="text"
                        className={styles.sectionTitleInput}
                        value={section.title}
                        onChange={(e) =>
                            updateConfigField(
                                sectionIndex,
                                null,
                                'title',
                                e.target.value,
                            )
                        }
                        onBlur={(e) =>
                            updateConfigField(
                                sectionIndex,
                                null,
                                'title',
                                e.target.value,
                            )
                        }
                        placeholder="Название секции"
                    />
                    <button
                        className={styles.removeSectionButton}
                        onClick={() => removeSection(sectionIndex)}
                        title="Удалить секцию"
                    >
                        <MdDelete />
                    </button>
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

            {editMode && (
                <div className={styles.addItemContainer}>
                    <select
                        value={newItemType}
                        onChange={handleAddItemTypeChange}
                        className={styles.addItemSelect}
                    >
                        <option value="button">Button</option>
                        <option value="color">Color</option>
                        <option value="text">Text</option>
                    </select>
                    <button
                        className={styles.addItemButton}
                        onClick={() => addItem(sectionIndex, newItemType)}
                        title="Добавить элемент"
                    >
                        <MdAdd /> Добавить элемент
                    </button>
                </div>
            )}
        </div>
    )
}

export default ConfigurationSection
