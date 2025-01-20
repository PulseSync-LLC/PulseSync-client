import React, { useEffect, useRef } from 'react'
import { MdDelete, MdRestore } from 'react-icons/md'
import * as styles from './ConfigurationItem.module.scss'
import { ButtonAction, Item, TextItem, isTextItem } from './types'
import TextItemComponent from './TextItemComponent'

interface ConfigurationItemProps {
    sectionIndex: number
    itemIndex: number
    item: Item
    editMode: boolean
    updateConfigField: (
        sectionIndex: number,
        itemIndex: number,
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
    removeItem: (sectionIndex: number, itemIndex: number) => void
}

const ConfigurationItem: React.FC<ConfigurationItemProps> = ({
    sectionIndex,
    itemIndex,
    item,
    editMode,
    updateConfigField,
    updateButtonConfig,
    resetConfigField,
    resetButtonConfig,
    removeItem,
}) => {
    let isDifferent = false
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus()
        }
    }, [item.id])
    switch (item.type) {
        case 'button':
            isDifferent = item.bool !== item.defaultParameter
            break
        case 'color':
            isDifferent = item.input !== item.defaultParameter
            break
        case 'text':
            isDifferent =
                JSON.stringify(item.buttons) !==
                JSON.stringify(
                    (item as TextItem).buttons.map((btn) => ({
                        ...btn,
                        defaultParameter: btn.defaultParameter || '',
                    })),
                )
            break
        default:
            isDifferent = false
    }

    const handleRemoveButton = (buttonIndex: number) => {
        if (!isTextItem(item)) return
        const updatedButtons = item.buttons.filter(
            (_, index) => index !== buttonIndex,
        )
        updateConfigField(sectionIndex, itemIndex, 'buttons', updatedButtons)
    }

    return (
        <div className={`${styles.item} ${styles[`item-${item.type}`]}`}>
            {editMode ? (
                <>
                    <div className={styles.itemHeader}>
                        <span className={styles.itemTypeInfo}>Тип: {item.type}</span>
                        <button
                            className={styles.removeItemButton}
                            onClick={() => removeItem(sectionIndex, itemIndex)}
                            title="Удалить элемент"
                        >
                            <MdDelete />
                        </button>
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label}>ID (строка):</label>
                        <input
                            type="text"
                            ref={inputRef}
                            className={styles.input}
                            value={item.id}
                            onChange={(e) =>
                                updateConfigField(
                                    sectionIndex,
                                    itemIndex,
                                    'id',
                                    e.target.value,
                                )
                            }
                            onBlur={(e) =>
                                updateConfigField(
                                    sectionIndex,
                                    itemIndex,
                                    'id',
                                    e.target.value,
                                )
                            }
                            placeholder="Уникальный идентификатор"
                        />
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label}>Название (строка):</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={item.name}
                            onChange={(e) =>
                                updateConfigField(
                                    sectionIndex,
                                    itemIndex,
                                    'name',
                                    e.target.value,
                                )
                            }
                            onBlur={(e) =>
                                updateConfigField(
                                    sectionIndex,
                                    itemIndex,
                                    'name',
                                    e.target.value,
                                )
                            }
                            placeholder="Название элемента"
                        />
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label}>Описание (строка):</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={item.description}
                            onChange={(e) =>
                                updateConfigField(
                                    sectionIndex,
                                    itemIndex,
                                    'description',
                                    e.target.value,
                                )
                            }
                            onBlur={(e) =>
                                updateConfigField(
                                    sectionIndex,
                                    itemIndex,
                                    'description',
                                    e.target.value,
                                )
                            }
                            placeholder="Описание элемента"
                        />
                    </div>
                </>
            ) : (
                <>
                    <div className={styles.itemName}>{item.name}</div>
                    <div className={styles.itemDescription}>{item.description}</div>
                </>
            )}

            {item.type === 'button' && (
                <div className={styles.buttonContainer}>
                    {editMode ? (
                        <>
                            <button
                                disabled
                                className={`${styles.itemButton} ${
                                    item.bool ? styles.itemButtonActive : ''
                                }`}
                                title={item.bool ? 'Включено' : 'Отключено'}
                            >
                                {item.bool ? 'Включено' : 'Отключено'}
                            </button>
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={() =>
                                        resetConfigField(sectionIndex, itemIndex)
                                    }
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                            <div className={styles.defaultParameterContainer}>
                                <label className={styles.defaultLabel}>
                                    Параметр по умолчанию (bool):
                                </label>
                                <input
                                    type="checkbox"
                                    checked={item.defaultParameter}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'defaultParameter',
                                            e.target.checked,
                                        )
                                    }
                                    title="Изменить параметр по умолчанию"
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <button
                                className={`${styles.itemButton} ${
                                    item.bool ? styles.itemButtonActive : ''
                                }`}
                                onClick={() =>
                                    updateConfigField(
                                        sectionIndex,
                                        itemIndex,
                                        'bool',
                                        !item.bool,
                                    )
                                }
                                title={item.bool ? 'Отключить' : 'Включить'}
                            >
                                {item.bool ? 'Включено' : 'Отключено'}
                            </button>
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={() =>
                                        resetConfigField(sectionIndex, itemIndex)
                                    }
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            {item.type === 'color' && (
                <div className={styles.colorContainer}>
                    {editMode ? (
                        <>
                            <div className={styles.field}>
                                <label className={styles.label}>
                                    Input (строка):
                                </label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={item.input}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'input',
                                            e.target.value,
                                        )
                                    }
                                    onBlur={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'input',
                                            e.target.value,
                                        )
                                    }
                                    placeholder="#FFFFFF"
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>Выбор цвета:</label>
                                <input
                                    type="color"
                                    className={styles.colorInput}
                                    value={item.input}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'input',
                                            e.target.value,
                                        )
                                    }
                                    onBlur={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'input',
                                            e.target.value,
                                        )
                                    }
                                />
                            </div>
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={() =>
                                        resetConfigField(sectionIndex, itemIndex)
                                    }
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                            <div className={styles.defaultParameterContainer}>
                                <label className={styles.defaultLabel}>
                                    Параметр по умолчанию (цвет):
                                </label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={item.defaultParameter}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'defaultParameter',
                                            e.target.value,
                                        )
                                    }
                                    onBlur={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'defaultParameter',
                                            e.target.value,
                                        )
                                    }
                                    placeholder="#FFFFFF"
                                />
                                <input
                                    type="color"
                                    className={styles.colorInput}
                                    value={item.defaultParameter}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'defaultParameter',
                                            e.target.value,
                                        )
                                    }
                                    onBlur={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'defaultParameter',
                                            e.target.value,
                                        )
                                    }
                                    title="Выбрать цвет по умолчанию"
                                />
                            </div>
                        </>
                    ) : (
                        <div className={styles.colorSelectContainer}>
                            <input
                                type="color"
                                className={styles.colorInput}
                                value={item.input}
                                onChange={(e) =>
                                    updateConfigField(
                                        sectionIndex,
                                        itemIndex,
                                        'input',
                                        e.target.value,
                                    )
                                }
                                title="Выбрать цвет"
                            />
                            <div>{item.input}</div>
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={() =>
                                        resetConfigField(sectionIndex, itemIndex)
                                    }
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {isTextItem(item) && (
                <TextItemComponent
                    sectionIndex={sectionIndex}
                    itemIndex={itemIndex}
                    item={item}
                    editMode={editMode}
                    updateButtonConfig={updateButtonConfig}
                    resetButtonConfig={resetButtonConfig}
                    updateConfigField={updateConfigField}
                    handleRemoveButton={handleRemoveButton}
                />
            )}
        </div>
    )
}

export default ConfigurationItem
