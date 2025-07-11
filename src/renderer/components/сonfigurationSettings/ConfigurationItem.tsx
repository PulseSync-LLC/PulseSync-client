// ConfigurationItem.tsx

import React, { useEffect, useRef, useState } from 'react'
import { MdDelete, MdDragIndicator, MdFolder, MdHelp, MdRestore } from 'react-icons/md'
import * as styles from './ConfigurationItem.module.scss'
import { ButtonAction, Item, TextItem, isTextItem } from './types'
import TextItemComponent from './TextItemComponent'
import CustomSlider from './CustomSlider'
import CustomSelector, { CustomSelectorRef } from './CustomSelector'
import { isSelectorItem, SelectorItem } from './types'
import TooltipButton from '../tooltip_button'

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
    updateConfigField: (sectionIndex: number, itemIndex: number, key: string, value: any) => void
    updateButtonConfig: (sectionIndex: number, itemIndex: number, buttonIndex: number, key: keyof ButtonAction, newValue: string) => void
    resetConfigField: (sectionIndex: number, itemIndex: number) => void
    resetButtonConfig: (sectionIndex: number, itemIndex: number, buttonIndex: number) => void
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

    let isDifferent
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
                    (item as TextItem).buttons.map(btn => ({
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
            isDifferent = selectorItem.selected !== (selectorItem.defaultParameter ?? '')
            break
        }
        default:
            isDifferent = false
    }

    const [sliderEditMode, setSliderEditMode] = useState(false)
    const [sliderValue, setSliderValue] = useState(item.type === 'slider' ? (item as SliderItem).value : 0)
    const [colorEditMode, setColorEditMode] = useState(false)
    const [colorValue, setColorValue] = useState(item.type === 'color' ? (item as ColorItem).input : '#FFFFFF')

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

    const finishSliderCheck = () => {
        if (item.type === 'slider') {
            const sliderItem = item as SliderItem

            let correctedDefault = sliderItem.defaultParameter
            if (correctedDefault < sliderItem.min) correctedDefault = sliderItem.min
            if (correctedDefault > sliderItem.max) correctedDefault = sliderItem.max

            if (correctedDefault !== sliderItem.defaultParameter) {
                updateConfigField(sectionIndex, itemIndex, 'defaultParameter', correctedDefault)
            }

            let correctedValue = sliderItem.value
            if (correctedValue < sliderItem.min) correctedValue = sliderItem.min
            if (correctedValue > sliderItem.max) correctedValue = sliderItem.max

            if (correctedValue !== sliderItem.value) {
                updateConfigField(sectionIndex, itemIndex, 'value', correctedValue)
            }
        }
        setSliderEditMode(false)
    }

    const finishSliderEdit = () => {
        updateConfigField(sectionIndex, itemIndex, 'value', sliderValue)
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
                const filePath = await window.desktopEvents?.invoke('dialog:openFile')
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
        const updatedButtons = item.buttons.filter((_, index) => index !== buttonIndex)
        updateConfigField(sectionIndex, itemIndex, 'buttons', updatedButtons)
    }

    return (
        <div
            className={editMode ? styles.itemEdit : `${styles.item} ${styles['item-' + item.type]}`}
            onClick={handleContainerClick}
            onDoubleClick={handleContainerDoubleClick}
        >
            {editMode ? (
                <>
                    <div className={styles.itemHeaderEdit}>
                        <span className={styles.itemTypeInfoEdit}>Тип: {item.type}</span>
                        <div className={styles.addItemContainerEdit}>
                            <button
                                className={styles.removeItemButtonEdit}
                                onClick={() => removeItem(sectionIndex, itemIndex)}
                                title="Удалить секцию"
                            >
                                <MdDelete size={24} />
                            </button>
                            <div className={styles.lineEdit}></div>
                            <button className={styles.addItemDragEdit}>
                                <MdDragIndicator size={24} />
                            </button>
                        </div>
                    </div>
                    <div className={styles.fieldEdit}>
                        <div className={styles.labelEdit}>ID (строка):</div>
                        <input
                            type="text"
                            ref={inputRef}
                            className={styles.inputEdit}
                            value={item.id}
                            onChange={e => updateConfigField(sectionIndex, itemIndex, 'id', e.target.value)}
                            onBlur={e => updateConfigField(sectionIndex, itemIndex, 'id', e.target.value)}
                            placeholder="Уникальный идентификатор"
                        />
                    </div>
                    <div className={styles.fieldEdit}>
                        <div className={styles.labelEdit}>Название (строка):</div>
                        <input
                            type="text"
                            className={styles.inputEdit}
                            value={item.name}
                            onChange={e => updateConfigField(sectionIndex, itemIndex, 'name', e.target.value)}
                            onBlur={e => updateConfigField(sectionIndex, itemIndex, 'name', e.target.value)}
                            placeholder="Название элемента"
                        />
                    </div>
                    <div className={styles.fieldEdit}>
                        <div className={styles.labelEdit}>Описание (строка):</div>
                        <input
                            type="text"
                            className={styles.inputEdit}
                            value={item.description}
                            onChange={e => updateConfigField(sectionIndex, itemIndex, 'description', e.target.value)}
                            onBlur={e => updateConfigField(sectionIndex, itemIndex, 'description', e.target.value)}
                            placeholder="Описание элемента"
                        />
                    </div>
                </>
            ) : (
                <div className={styles.readOnlyContainer}>
                    <div className={styles.itemHeader}>
                        <div className={styles.itemName}>{item.name}</div>
                        {item.description && (
                            <TooltipButton
                                className={styles.tip}
                                side="right"
                                tooltipText={<div className={styles.itemName}>{item.description}</div>}
                            >
                                <MdHelp size={14} color="white" />
                            </TooltipButton>
                        )}
                    </div>
                    {/* ---- BUTTON ---- */}
                    {item.type === 'button' && (
                        <div className={`${styles.itemValue} ${item.bool ? styles.btEn : styles.btDieb}`}>{item.bool ? 'Включено' : 'Выключено'}</div>
                    )}
                    {/* ---- SLIDER ---- */}
                    {item.type === 'slider' && (
                        <div className={styles.itemValue}>
                            {sliderEditMode ? (
                                <input
                                    className={styles.changeInput}
                                    type="number"
                                    value={sliderValue}
                                    onChange={e => setSliderValue(Number(e.target.value))}
                                    onBlur={finishSliderEdit}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') finishSliderEdit()
                                    }}
                                    autoFocus
                                />
                            ) : (
                                <span onDoubleClick={() => setSliderEditMode(true)}>{item.value}</span>
                            )}
                        </div>
                    )}
                    {/* ---- COLOR ---- */}
                    {item.type === 'color' && (
                        <div className={styles.itemValue}>
                            {colorEditMode ? (
                                <>
                                    <input
                                        className={styles.changeInput}
                                        type="text"
                                        value={colorValue}
                                        onChange={e => setColorValue(e.target.value)}
                                        onBlur={finishColorEdit}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') finishColorEdit()
                                        }}
                                        autoFocus
                                    />
                                    <input
                                        className={styles.changeColorPrewiev}
                                        type="color"
                                        value={colorValue}
                                        onChange={e => setColorValue(e.target.value)}
                                        onBlur={finishColorEdit}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') finishColorEdit()
                                        }}
                                    />
                                </>
                            ) : (
                                <span onDoubleClick={() => setColorEditMode(true)}>{item.input}</span>
                            )}
                        </div>
                    )}
                    {/* ---- FILE ---- */}
                    {item.type === 'file' && <div className={styles.itemValue}>Путь: {item.filePath}</div>}
                    {/* ---- TEXT ---- */}
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
                    {/* ---- SELECTOR (read-only mode) ---- */}
                    {isSelectorItem(item) && !editMode && (
                        <>
                            <div className={styles.itemValueEdit}>
                                <CustomSelector
                                    ref={selectorRef}
                                    options={item.options}
                                    value={item.selected}
                                    onChange={(newValue: number) => updateConfigField(sectionIndex, itemIndex, 'selected', newValue)}
                                />
                            </div>
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={e => {
                                        e.stopPropagation()
                                        updateConfigField(sectionIndex, itemIndex, 'selected', item.defaultParameter)
                                    }}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* ---- BUTTON extra controls ---- */}
            {item.type === 'button' && (
                <div
                    className={styles.buttonContainer}
                    onClick={() => updateConfigField(sectionIndex, itemIndex, 'defaultParameter', !item.defaultParameter)}
                >
                    {editMode ? (
                        <>
                            {isDifferent && (
                                <button
                                    className={styles.resetButtonEdit}
                                    onClick={() => resetConfigField(sectionIndex, itemIndex)}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                            <div className={styles.defaultParameterContainerEdit}>
                                <div className={styles.defaultLabelEdit}>Параметр по умолчанию (bool):</div>
                                <div className={`${styles.itemValue} ${item.defaultParameter ? styles.btEn : styles.btDieb}`}>
                                    {item.defaultParameter ? 'Включено' : 'Выключено'}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={() => resetConfigField(sectionIndex, itemIndex)}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* ---- COLOR extra controls ---- */}
            {item.type === 'color' && (
                <div className={styles.colorContainer}>
                    {editMode ? (
                        <>
                            {isDifferent && (
                                <button
                                    className={styles.resetButtonEdit}
                                    onClick={() => resetConfigField(sectionIndex, itemIndex)}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                            <div className={styles.defaultParameterContainerEdit}>
                                <div className={styles.defaultLabelEdit}>Параметр по умолчанию (цвет):</div>
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: '8px',
                                        width: '100%',
                                    }}
                                >
                                    <input
                                        type="color"
                                        className={styles.colorInputEdit}
                                        value={item.defaultParameter}
                                        onChange={e => updateConfigField(sectionIndex, itemIndex, 'defaultParameter', e.target.value)}
                                        onBlur={e => updateConfigField(sectionIndex, itemIndex, 'defaultParameter', e.target.value)}
                                        title="Выбрать цвет по умолчанию"
                                    />
                                    <input
                                        type="text"
                                        className={styles.inputEdit}
                                        value={item.defaultParameter}
                                        onChange={e => updateConfigField(sectionIndex, itemIndex, 'defaultParameter', e.target.value)}
                                        onBlur={e => updateConfigField(sectionIndex, itemIndex, 'defaultParameter', e.target.value)}
                                        placeholder="#FFFFFF"
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
                                onChange={e => updateConfigField(sectionIndex, itemIndex, 'input', e.target.value)}
                                title="Выбрать цвет"
                            />
                            {isDifferent && (
                                <button
                                    className={styles.resetButton}
                                    onClick={() => resetConfigField(sectionIndex, itemIndex)}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ---- SLIDER extra controls ---- */}
            {item.type === 'slider' && (
                <div className={styles.sliderContainerEdit}>
                    {editMode ? (
                        <>
                            <div className={styles.defaultParameterContainerEdit}>
                                <div className={styles.defaultLabelEdit}>Min:</div>
                                <input
                                    type="number"
                                    className={styles.inputEdit}
                                    value={item.min}
                                    onChange={e => updateConfigField(sectionIndex, itemIndex, 'min', Number(e.target.value))}
                                    onBlur={finishSliderCheck}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') finishSliderCheck()
                                    }}
                                />
                            </div>
                            <div className={styles.defaultParameterContainerEdit}>
                                <div className={styles.defaultLabelEdit}>Max:</div>
                                <input
                                    type="number"
                                    className={styles.inputEdit}
                                    value={item.max}
                                    onChange={e => updateConfigField(sectionIndex, itemIndex, 'max', Number(e.target.value))}
                                    onBlur={finishSliderCheck}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') finishSliderCheck()
                                    }}
                                />
                            </div>
                            <div className={styles.defaultParameterContainerEdit}>
                                <div className={styles.defaultLabelEdit}>Step:</div>
                                <input
                                    type="number"
                                    className={styles.inputEdit}
                                    value={item.step}
                                    onChange={e => updateConfigField(sectionIndex, itemIndex, 'step', Number(e.target.value))}
                                    onBlur={finishSliderCheck}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') finishSliderCheck()
                                    }}
                                />
                            </div>
                            {isDifferent && (
                                <button
                                    className={styles.resetButtonEdit}
                                    onClick={() => resetConfigField(sectionIndex, itemIndex)}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                            <div className={styles.defaultParameterContainerEdit}>
                                <div className={styles.defaultLabelEdit}>Параметр по умолчанию (число):</div>
                                <input
                                    type="number"
                                    className={styles.inputEdit}
                                    value={item.defaultParameter ?? 0}
                                    onChange={e => {
                                        updateConfigField(sectionIndex, itemIndex, 'defaultParameter', Number(e.target.value))
                                    }}
                                    onBlur={finishSliderCheck}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') finishSliderCheck()
                                    }}
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
                                onChange={e => updateConfigField(sectionIndex, itemIndex, 'value', Number(e.target.value))}
                            />
                            {isDifferent && (
                                <button className={styles.resetButton} onClick={() => resetConfigField(sectionIndex, itemIndex)} title="Сбросить">
                                    <MdRestore />
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* ---- FILE extra controls ---- */}
            {item.type === 'file' && (
                <div className={styles.fileContainer}>
                    {editMode ? (
                        <>
                            <div className={styles.fieldEdit}>
                                <div className={styles.labelEdit}>Имя файла:</div>
                                <input
                                    type="text"
                                    className={styles.inputEdit}
                                    value={item.filePath || ''}
                                    onChange={e => updateConfigField(sectionIndex, itemIndex, 'fileName', e.target.value)}
                                />
                            </div>
                            {isDifferent && (
                                <button
                                    className={styles.resetButtonEdit}
                                    onClick={e => {
                                        e.stopPropagation()
                                        updateConfigField(sectionIndex, itemIndex, 'filePath', item.defaultParameter?.filePath ?? '')
                                    }}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                            <div className={styles.defaultParameterContainerEdit}>
                                <div className={styles.defaultLabelEdit}>Значение по умолчанию (объект filePath):</div>
                                <input
                                    type="text"
                                    className={styles.inputEdit}
                                    placeholder="Путь по умолчанию"
                                    value={item.defaultParameter?.filePath ?? ''}
                                    onChange={e =>
                                        updateConfigField(sectionIndex, itemIndex, 'defaultParameter', {
                                            ...(item.defaultParameter || {}),
                                            filePath: e.target.value,
                                        })
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
                                    onClick={e => {
                                        e.stopPropagation()
                                        updateConfigField(sectionIndex, itemIndex, 'filePath', item.defaultParameter?.filePath ?? '')
                                    }}
                                    title="Сбросить значение"
                                >
                                    <MdRestore />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ---- SELECTOR extra controls (edit mode) ---- */}
            {isSelectorItem(item) && item.type === 'selector' && editMode && (
                <div className={styles.selectorContainerEdit}>
                    <div className={styles.fieldEdit}>
                        <div className={styles.labelEdit}>Опции:</div>
                        {Object.entries(item.options).map(([key, option]) => (
                            <div key={key} className={styles.optionRowEdit}>
                                <div className={styles.keyEdit}>{key}:</div>
                                <input
                                    type="text"
                                    className={styles.inputEdit}
                                    value={option.event}
                                    onChange={e => {
                                        const newOptions = { ...item.options }
                                        newOptions[key] = {
                                            ...option,
                                            event: e.target.value,
                                        }
                                        updateConfigField(sectionIndex, itemIndex, 'options', newOptions)
                                    }}
                                    placeholder="event"
                                />
                                <input
                                    type="text"
                                    className={styles.inputEdit}
                                    value={option.name}
                                    onChange={e => {
                                        const newOptions = { ...item.options }
                                        newOptions[key] = {
                                            ...option,
                                            name: e.target.value,
                                        }
                                        updateConfigField(sectionIndex, itemIndex, 'options', newOptions)
                                    }}
                                    placeholder="name"
                                />
                                <button
                                    className={styles.removeOptionButtonEdit}
                                    onClick={() => {
                                        const newOptions = { ...item.options }
                                        delete newOptions[key]
                                        updateConfigField(sectionIndex, itemIndex, 'options', newOptions)
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
                            updateConfigField(sectionIndex, itemIndex, 'options', newOptions)
                        }}
                    >
                        Добавить опцию
                    </button>

                    {isDifferent && (
                        <button
                            className={styles.resetButtonEdit}
                            onClick={() => resetConfigField(sectionIndex, itemIndex)}
                            title="Сбросить значение"
                        >
                            <MdRestore />
                        </button>
                    )}

                    <div className={styles.defaultParameterContainerEdit}>
                        <div className={styles.defaultLabelEdit}>Параметр по умолчанию (число):</div>
                        <input
                            type="number"
                            className={styles.inputEdit}
                            value={item.defaultParameter ?? ''}
                            onChange={e => updateConfigField(sectionIndex, itemIndex, 'defaultParameter', Number(e.target.value))}
                        />
                    </div>
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
