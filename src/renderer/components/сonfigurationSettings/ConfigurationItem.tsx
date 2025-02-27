import React, { useEffect, useRef, useState } from 'react'
import { MdDelete, MdFolder, MdRestore } from 'react-icons/md'
import * as styles from './ConfigurationItem.module.scss'
import {
    ButtonAction,
    Item,
    TextItem,
    isTextItem,
    isSelectorItem,
    SelectorItem,
} from './types'
import TextItemComponent from './TextItemComponent'
import CustomSlider from './CustomSlider'
import CustomSelector, { CustomSelectorRef } from './CustomSelector'

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
    const selectorRef = useRef<CustomSelectorRef>(null)

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
        case 'selector': {
            const selectorItem = item as SelectorItem
            isDifferent =
                selectorItem.selected !== (selectorItem.defaultParameter ?? '')
            break
        }
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

    const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (editMode) return
        if (item.type === 'button') {
            updateConfigField(sectionIndex, itemIndex, 'bool', !item.bool)
        }
        if (item.type === 'selector') {
            selectorRef.current?.toggle()
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

    const handleRemoveButton = (buttonIndex: number) => {
        if (!isTextItem(item)) return
        const updatedButtons = item.buttons.filter(
            (_, index) => index !== buttonIndex,
        )
        updateConfigField(sectionIndex, itemIndex, 'buttons', updatedButtons)
    }

    const EditModeView = () => {
        return (
            <div className={`${styles.itemEdit}`}>
                <div className={styles.itemHeaderEdit}>
                    <span className={styles.itemTypeInfoEdit}>Тип: {item.type}</span>
                    <button
                        className={styles.removeItemButtonEdit}
                        onClick={() => removeItem(sectionIndex, itemIndex)}
                        title="Удалить элемент"
                    >
                        <MdDelete />
                    </button>
                </div>

                {}
                <div className={styles.fieldEdit}>
                    <label className={styles.labelEdit}>ID (строка):</label>
                    <input
                        type="text"
                        ref={inputRef}
                        className={styles.inputEdit}
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

                {}
                <div className={styles.fieldEdit}>
                    <label className={styles.labelEdit}>Название (строка):</label>
                    <input
                        type="text"
                        className={styles.inputEdit}
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

                {}
                <div className={styles.fieldEdit}>
                    <label className={styles.labelEdit}>Описание (строка):</label>
                    <input
                        type="text"
                        className={styles.inputEdit}
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

                {}
                {item.type === 'button' && (
                    <div className={styles.buttonContainerEdit}>
                        {isDifferent && (
                            <button
                                className={styles.resetButtonEdit}
                                onClick={() =>
                                    resetConfigField(sectionIndex, itemIndex)
                                }
                                title="Сбросить значение"
                            >
                                <MdRestore />
                            </button>
                        )}
                        <div className={styles.defaultParameterContainerEdit}>
                            <label className={styles.defaultLabelEdit}>
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
                    </div>
                )}

                {item.type === 'color' && (
                    <div className={styles.colorContainerEdit}>
                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>
                                Input (строка):
                            </label>
                            <input
                                type="text"
                                className={styles.inputEdit}
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
                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>Выбор цвета:</label>
                            <input
                                type="color"
                                className={styles.colorInputEdit}
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
                                className={styles.resetButtonEdit}
                                onClick={() =>
                                    resetConfigField(sectionIndex, itemIndex)
                                }
                                title="Сбросить значение"
                            >
                                <MdRestore />
                            </button>
                        )}
                        <div className={styles.defaultParameterContainerEdit}>
                            <label className={styles.defaultLabelEdit}>
                                Параметр по умолчанию (цвет):
                            </label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    className={styles.inputEdit}
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
                                    className={styles.colorInputEdit}
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
                    </div>
                )}

                {item.type === 'slider' && (
                    <div className={styles.sliderContainerEdit}>
                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>Min:</label>
                            <input
                                type="number"
                                className={styles.inputEdit}
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
                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>Max:</label>
                            <input
                                type="number"
                                className={styles.inputEdit}
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
                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>Step:</label>
                            <input
                                type="number"
                                className={styles.inputEdit}
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
                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>
                                Текущее значение:
                            </label>
                            <input
                                type="number"
                                className={styles.inputEdit}
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
                                className={styles.resetButtonEdit}
                                onClick={() =>
                                    resetConfigField(sectionIndex, itemIndex)
                                }
                                title="Сбросить значение"
                            >
                                <MdRestore />
                            </button>
                        )}
                        <div className={styles.defaultParameterContainerEdit}>
                            <label className={styles.defaultLabelEdit}>
                                Параметр по умолчанию (число):
                            </label>
                            <input
                                type="number"
                                className={styles.inputEdit}
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
                    </div>
                )}

                {item.type === 'file' && (
                    <div className={styles.fileContainerEdit}>
                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>Имя файла:</label>
                            <input
                                type="text"
                                className={styles.inputEdit}
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
                                className={styles.resetButtonEdit}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    updateConfigField(
                                        sectionIndex,
                                        itemIndex,
                                        'filePath',
                                        item.defaultParameter?.filePath ?? '',
                                    )
                                }}
                                title="Сбросить значение"
                            >
                                <MdRestore />
                            </button>
                        )}
                        <div className={styles.defaultParameterContainerEdit}>
                            <label className={styles.defaultLabelEdit}>
                                Значение по умолчанию (объект filePath / fileName):
                            </label>
                            <input
                                type="text"
                                className={styles.inputEdit}
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
                                className={styles.inputEdit}
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
                    </div>
                )}

                {isTextItem(item) && (
                    <div className={styles.itemTextEdit}>
                        <TextItemComponent
                            sectionIndex={sectionIndex}
                            itemIndex={itemIndex}
                            item={item}
                            editMode={true}
                            updateButtonConfig={updateButtonConfig}
                            resetButtonConfig={resetButtonConfig}
                            updateConfigField={updateConfigField}
                            handleRemoveButton={handleRemoveButton}
                        />
                    </div>
                )}

                {isSelectorItem(item) && item.type === 'selector' && (
                    <div className={styles.selectorContainerEdit}>
                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>
                                Выбранное значение:
                            </label>
                            <input
                                type="number"
                                className={styles.inputEdit}
                                value={item.selected}
                                onChange={(e) =>
                                    updateConfigField(
                                        sectionIndex,
                                        itemIndex,
                                        'selected',
                                        Number(e.target.value),
                                    )
                                }
                            />
                        </div>

                        <div className={styles.fieldEdit}>
                            <label className={styles.labelEdit}>Опции:</label>
                            {Object.entries(item.options).map(([key, option]) => (
                                <div key={key} className={styles.optionRowEdit}>
                                    <span>{key}:</span>
                                    <input
                                        type="text"
                                        className={styles.inputEdit}
                                        value={option.event}
                                        onChange={(e) => {
                                            const newOptions = { ...item.options }
                                            newOptions[key] = {
                                                ...option,
                                                event: e.target.value,
                                            }
                                            updateConfigField(
                                                sectionIndex,
                                                itemIndex,
                                                'options',
                                                newOptions,
                                            )
                                        }}
                                        placeholder="event"
                                    />
                                    <input
                                        type="text"
                                        className={styles.inputEdit}
                                        value={option.name}
                                        onChange={(e) => {
                                            const newOptions = { ...item.options }
                                            newOptions[key] = {
                                                ...option,
                                                name: e.target.value,
                                            }
                                            updateConfigField(
                                                sectionIndex,
                                                itemIndex,
                                                'options',
                                                newOptions,
                                            )
                                        }}
                                        placeholder="name"
                                    />
                                    <button
                                        className={styles.removeOptionButtonEdit}
                                        onClick={() => {
                                            const newOptions = { ...item.options }
                                            delete newOptions[key]
                                            updateConfigField(
                                                sectionIndex,
                                                itemIndex,
                                                'options',
                                                newOptions,
                                            )
                                        }}
                                        title="Удалить опцию"
                                    >
                                        <MdDelete />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            className={styles.addOptionButtonEdit}
                            onClick={() => {
                                const newKey = Object.keys(item.options).length + 1
                                const newOptions = {
                                    ...item.options,
                                    [newKey]: {
                                        event: `event_${newKey}`,
                                        name: `Option ${newKey}`,
                                    },
                                }
                                updateConfigField(
                                    sectionIndex,
                                    itemIndex,
                                    'options',
                                    newOptions,
                                )
                            }}
                        >
                            Добавить опцию
                        </button>

                        {isDifferent && (
                            <button
                                className={styles.resetButtonEdit}
                                onClick={() =>
                                    resetConfigField(sectionIndex, itemIndex)
                                }
                                title="Сбросить значение"
                            >
                                <MdRestore />
                            </button>
                        )}

                        <div className={styles.defaultParameterContainerEdit}>
                            <label className={styles.defaultLabelEdit}>
                                Параметр по умолчанию (число):
                            </label>
                            <input
                                type="number"
                                className={styles.inputEdit}
                                value={item.defaultParameter ?? ''}
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
                    </div>
                )}
            </div>
        )
    }

    const NormalModeView = () => {
        return (
            <div
                className={styles.item}
                onClick={handleContainerClick}
                onDoubleClick={handleContainerDoubleClick}
            >
                <div className={styles.readOnlyContainer}>
                    <div className={styles.itemName}>{item.name}</div>

                    {}
                    {item.type === 'button' && (
                        <div
                            className={`${styles.itemValue} ${
                                item.bool ? styles.btEn : styles.btDieb
                            }`}
                        >
                            {item.bool ? 'Включено' : 'Выключено'}
                        </div>
                    )}

                    {}
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

                    {}
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

                    {}
                    {item.type === 'file' && (
                        <div className={styles.itemValue}>Путь: {item.filePath}</div>
                    )}

                    {}
                    {isTextItem(item) && (
                        <div className={styles.itemText}>
                            <TextItemComponent
                                sectionIndex={sectionIndex}
                                itemIndex={itemIndex}
                                item={item}
                                editMode={false}
                                updateButtonConfig={updateButtonConfig}
                                resetButtonConfig={resetButtonConfig}
                                updateConfigField={updateConfigField}
                                handleRemoveButton={handleRemoveButton}
                            />
                        </div>
                    )}

                    {}
                    {isSelectorItem(item) && item.type === 'selector' && (
                        <>
                            <div className={styles.itemValue}>
                                <CustomSelector
                                    ref={selectorRef}
                                    options={item.options}
                                    value={item.selected}
                                    onChange={(newValue: number) =>
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'selected',
                                            newValue,
                                        )
                                    }
                                />
                            </div>
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        updateConfigField(
                                            sectionIndex,
                                            itemIndex,
                                            'selected',
                                            item.defaultParameter,
                                        )
                                    }}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                        </>
                    )}
                </div>

                {}
                {item.type === 'button' && !editMode && isDifferent && (
                    <button
                        className={styles.resetButton}
                        onClick={() => resetConfigField(sectionIndex, itemIndex)}
                        title="Сбросить значение"
                    >
                        <MdRestore />
                    </button>
                )}

                {item.type === 'slider' && !editMode && isDifferent && (
                    <button
                        className={styles.resetButton}
                        onClick={() => resetConfigField(sectionIndex, itemIndex)}
                        title="Сбросить"
                    >
                        <MdRestore />
                    </button>
                )}

                {item.type === 'color' && !editMode && (
                    <div className={styles.colorSelectContainer}>
                        <input
                            type="color"
                            className={styles.colorInput}
                            value={(item as ColorItem).input}
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

                {item.type === 'file' && !editMode && isDifferent && (
                    <button
                        className={styles.resetButton}
                        onClick={(e) => {
                            e.stopPropagation()
                            updateConfigField(
                                sectionIndex,
                                itemIndex,
                                'filePath',
                                item.defaultParameter?.filePath ?? '',
                            )
                        }}
                        title="Сбросить значение"
                    >
                        <MdRestore />
                    </button>
                )}
            </div>
        )
    }

    return editMode ? <EditModeView /> : <NormalModeView />
}

export default ConfigurationItem
