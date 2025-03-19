import React, { useState, useEffect } from 'react'
import { MdDelete, MdRestore } from 'react-icons/md'
import * as styles from './ConfigurationItem.module.scss'
import { ButtonAction } from './types'

interface ButtonConfigProps {
    sectionIndex: number
    itemIndex: number
    buttonIndex: number
    button: ButtonAction
    editMode: boolean
    updateButtonConfig: (sectionIndex: number, itemIndex: number, buttonIndex: number, key: keyof ButtonAction, newValue: string) => void
    resetButtonConfig: (sectionIndex: number, itemIndex: number, buttonIndex: number) => void
    handleRemoveButton: (buttonIndex: number) => void
}

const TextConfig: React.FC<ButtonConfigProps> = ({
    sectionIndex,
    itemIndex,
    buttonIndex,
    button,
    editMode,
    updateButtonConfig,
    resetButtonConfig,
    handleRemoveButton,
}) => {
    const [localId, setLocalId] = useState(button.id)
    const [localName, setLocalName] = useState(button.name)
    const [localText, setLocalText] = useState(button.text)
    const [localDefault, setLocalDefault] = useState(button.defaultParameter || '')

    useEffect(() => {
        setLocalId(button.id)
        setLocalName(button.name)
        setLocalText(button.text)
        setLocalDefault(button.defaultParameter || '')
    }, [button.id, button.name, button.text, button.defaultParameter])

    const isDifferent = button.text !== (button.defaultParameter || button.text)

    return (
        <div className={styles.buttonFieldEdit}>
            {editMode ? (
                <>
                    <div className={styles.fieldEdit}>
                        <label className={styles.labelEdit}>ID (строка):</label>
                        <input
                            type="text"
                            className={styles.inputEdit}
                            value={localId}
                            onChange={e => setLocalId(e.target.value)}
                            onBlur={e => updateButtonConfig(sectionIndex, itemIndex, buttonIndex, 'id', e.target.value)}
                            placeholder="Укажите ID"
                        />
                    </div>
                    <div className={styles.fieldEdit}>
                        <label className={styles.labelEdit}>Название текста (строка):</label>
                        <input
                            type="text"
                            className={styles.inputEdit}
                            value={localName}
                            onChange={e => setLocalName(e.target.value)}
                            onBlur={e => updateButtonConfig(sectionIndex, itemIndex, buttonIndex, 'name', e.target.value)}
                            placeholder="Название текста"
                        />
                    </div>
                    <div className={styles.fieldEdit}>
                        <label className={styles.labelEdit}>Текст текста (строка):</label>
                        <input
                            type="text"
                            className={styles.inputEdit}
                            value={localText}
                            onChange={e => setLocalText(e.target.value)}
                            onBlur={e => updateButtonConfig(sectionIndex, itemIndex, buttonIndex, 'text', e.target.value)}
                            placeholder="Текст"
                        />
                    </div>
                    <div className={styles.fieldEdit}>
                        <label className={styles.labelEdit}>Дефолтное значение (строка):</label>
                        <input
                            type="text"
                            className={styles.inputEdit}
                            value={localDefault}
                            onChange={e => setLocalDefault(e.target.value)}
                            onBlur={e => updateButtonConfig(sectionIndex, itemIndex, buttonIndex, 'defaultParameter', e.target.value)}
                            placeholder="Текст по умолчанию"
                        />
                    </div>
                    {isDifferent && (
                        <button
                            className={styles.resetButtonEdit}
                            onClick={() => resetButtonConfig(sectionIndex, itemIndex, buttonIndex)}
                            title="Сбросить значение"
                        >
                            <MdRestore />
                        </button>
                    )}
                    <button className={styles.removeItemButtonEdit} onClick={() => handleRemoveButton(buttonIndex)} title="Удалить текст">
                        <MdDelete />
                    </button>
                </>
            ) : (
                <>
                    <div className={styles.buttonName}>{button.name}:</div>
                    <input
                        type="text"
                        className={styles.buttonTextInput}
                        value={button.text}
                        onChange={e => updateButtonConfig(sectionIndex, itemIndex, buttonIndex, 'text', e.target.value)}
                        title={`Изменить текст ${button.name}`}
                    />
                    {isDifferent && (
                        <button
                            className={styles.resetButton}
                            onClick={() => resetButtonConfig(sectionIndex, itemIndex, buttonIndex)}
                            title="Сбросить значение"
                        >
                            <MdRestore scale={28} />
                        </button>
                    )}
                </>
            )}
        </div>
    )
}

export default TextConfig
