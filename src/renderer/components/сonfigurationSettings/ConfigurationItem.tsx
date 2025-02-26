import React, { useEffect, useRef, useState } from 'react'
import { MdDelete, MdFolder, MdRestore } from 'react-icons/md'
import * as styles from './ConfigurationItem.module.scss'
import { ButtonAction, Item, TextItem, isTextItem } from './types'
import TextItemComponent from './TextItemComponent'
import CustomSlider from './CustomSlider'

interface SliderItem {
    type: 'slider'
    value: number
    min: number
    max: number
    step: number
    defaultParameter: number
}

interface ColorItem {
    type: 'color'
    input: string
    defaultParameter: string
}

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
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus()
        }
    }, [item.id])

    let isDifferent = false
    switch (item.type) {
        case 'button':
            isDifferent = item.bool !== item.defaultParameter
            break
        case 'color': {
            const colorItem = item as ColorItem
            isDifferent = colorItem.input !== colorItem.defaultParameter
            break
        }
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
        case 'slider': {
            const sliderItem = item as SliderItem
            isDifferent = sliderItem.value !== sliderItem.defaultParameter
            break
        }
        case 'file':
            isDifferent = item.filePath !== (item.defaultParameter?.filePath ?? '')
            break
        default:
            isDifferent = false
    }

    const [sliderEditMode, setSliderEditMode] = useState(false)
    const [sliderValue, setSliderValue] = useState(
        item.type === 'slider' ? (item as SliderItem).value : 0,
    )
    const [colorEditMode, setColorEditMode] = useState(false)
    const [colorValue, setColorValue] = useState(
        item.type === 'color' ? (item as ColorItem).input : '#FFFFFF',
    )

    useEffect(() => {
        if (item.type === 'slider') {
            setSliderValue((item as SliderItem).value)
        }
    }, [item])
    useEffect(() => {
        if (item.type === 'color') {
            setColorValue((item as ColorItem).input)
        }
    }, [item])

    const finishSliderEdit = () => {
        updateConfigField(sectionIndex, itemIndex, 'value', sliderValue)
        setSliderEditMode(false)
    }

    const finishColorEdit = () => {
        updateConfigField(sectionIndex, itemIndex, 'input', colorValue)
        setColorEditMode(false)
    }

    const handleContainerClick = () => {
        if (editMode) return
        if (item.type === 'button') {
            updateConfigField(sectionIndex, itemIndex, 'bool', !item.bool)
        }
        if (item.type === 'file') {
            ;(async () => {
                const filePath =
                    await window.desktopEvents?.invoke('dialog:openFile')
                if (filePath) {
                    updateConfigField(sectionIndex, itemIndex, 'filePath', filePath)
                }
            })()
        }
    }

    const handleContainerDoubleClick = () => {
        if (editMode) return
        if (item.type === 'slider') {
            setSliderEditMode(true)
        }
        if (item.type === 'color') {
            setColorEditMode(true)
        }
    }

    const stopPropagation = (e: React.MouseEvent) => e.stopPropagation()

    const handleRemoveButton = (buttonIndex: number) => {
        if (!isTextItem(item)) return
        const updatedButtons = item.buttons.filter(
            (_, index) => index !== buttonIndex,
        )
        updateConfigField(sectionIndex, itemIndex, 'buttons', updatedButtons)
    }

    return (
        <div
            className={`${styles.item} ${styles[`item-${item.type}`]}`}
            onClick={handleContainerClick}
            onDoubleClick={handleContainerDoubleClick}
        >
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
                <div className={styles.readOnlyContainer}>
                    <div className={styles.itemName}>{item.name}</div>
                    {item.type === 'button' && (
                        <div
                            className={`${styles.itemValue}, ${item.bool ? styles.btEn : styles.btDieb}`}
                        >
                            {item.bool ? 'Включено' : 'Выключено'}
                        </div>
                    )}
                    {item.type === 'slider' && (
                        <div className={styles.itemValue}>
                            {sliderEditMode ? (
                                <input
                                    className={styles.changeInput}
                                    type="number"
                                    value={sliderValue}
                                    onChange={(e) =>
                                        setSliderValue(Number(e.target.value))
                                    }
                                    onBlur={finishSliderEdit}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') finishSliderEdit()
                                    }}
                                    autoFocus
                                />
                            ) : (
                                <span onDoubleClick={() => setSliderEditMode(true)}>
                                    {item.value}
                                </span>
                            )}
                        </div>
                    )}
                    {item.type === 'color' && (
                        <div className={styles.itemValue}>
                            {colorEditMode ? (
                                <>
                                    <input
                                        className={styles.changeInput}
                                        type="text"
                                        value={colorValue}
                                        onChange={(e) =>
                                            setColorValue(e.target.value)
                                        }
                                        onBlur={finishColorEdit}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') finishColorEdit()
                                        }}
                                        autoFocus
                                    />
                                    <input
                                        className={styles.changeColorPrewiev}
                                        type="color"
                                        value={colorValue}
                                        onChange={(e) =>
                                            setColorValue(e.target.value)
                                        }
                                        onBlur={finishColorEdit}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') finishColorEdit()
                                        }}
                                    />
                                </>
                            ) : (
                                <span onDoubleClick={() => setColorEditMode(true)}>
                                    {item.input}
                                </span>
                            )}
                        </div>
                    )}
                    {item.type === 'file' && (
                        <div className={styles.itemValue}>Путь: {item.filePath}</div>
                    )}
                    {isTextItem(item) && (
                        <div className={styles.itemText}>
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
                        </div>
                    )}
                </div>
            )}

            {}
            {item.type === 'button' && (
                <div className={styles.buttonContainer}>
                    {editMode ? (
                        <>
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

            {}
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
                                <div style={{ display: 'flex', gap: '8px' }}>
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

            {}
            {item.type === 'slider' && (
                <div className={styles.sliderContainer}>
                    {editMode ? (
                        <>
                            <div className={styles.field}>
                                <label className={styles.label}>Min:</label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={item.min}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'min',
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>Max:</label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={item.max}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'max',
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>Step:</label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={item.step}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'step',
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>
                                    Текущее значение:
                                </label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={item.value}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'value',
                                            Number(e.target.value),
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
                                    Параметр по умолчанию (число):
                                </label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={item.defaultParameter ?? 0}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'defaultParameter',
                                            Number(e.target.value),
                                        )
                                    }
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <CustomSlider
                                min={item.min}
                                max={item.max}
                                step={item.step}
                                value={item.value}
                                onChange={(e) =>
                                    updateConfigField(
                                        sectionIndex,
                                        itemIndex,
                                        'value',
                                        Number(e.target.value),
                                    )
                                }
                            />
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={() =>
                                        resetConfigField(sectionIndex, itemIndex)
                                    }
                                    title="Сбросить"
                                >
                                    <MdRestore />
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            {}
            {item.type === 'file' && (
                <div className={styles.fileContainer}>
                    {editMode ? (
                        <>
                            <div className={styles.field}>
                                <label className={styles.label}>Имя файла:</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={item.filePath || ''}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'fileName',
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
                                    Значение по умолчанию (объект filePath /
                                    fileName):
                                </label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    placeholder="Путь по умолчанию"
                                    value={item.defaultParameter?.filePath ?? ''}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'defaultParameter',
                                            {
                                                ...(item.defaultParameter || {}),
                                                filePath: e.target.value,
                                            },
                                        )
                                    }
                                />
                                <input
                                    type="text"
                                    className={styles.input}
                                    placeholder="Имя файла по умолчанию"
                                    value={item.defaultParameter?.filePath ?? ''}
                                    onChange={(e) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'defaultParameter',
                                            {
                                                ...(item.defaultParameter || {}),
                                                filePath: e.target.value,
                                            },
                                        )
                                    }
                                />
                            </div>
                        </>
                    ) : (
                        <div className={styles.field}>
                            <MdFolder size={28} color="#C3D1FF" />
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
            {isTextItem(item) && editMode && (
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
