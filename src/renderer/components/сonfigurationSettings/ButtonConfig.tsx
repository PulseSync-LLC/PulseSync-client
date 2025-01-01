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
    updateButtonConfig: (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
        key: keyof ButtonAction,
        newValue: string,
    ) => void
    resetButtonConfig: (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
    ) => void
    handleRemoveButton: (buttonIndex: number) => void
}

const ButtonConfig: React.FC<ButtonConfigProps> = ({
    sectionIndex,
    itemIndex,
    buttonIndex,
    button,
    editMode,
    updateButtonConfig,
    resetButtonConfig,
    handleRemoveButton,
}) => {
    const [localName, setLocalName] = useState(button.name)
    const [localText, setLocalText] = useState(button.text)

    useEffect(() => {
        setLocalName(button.name)
        setLocalText(button.text)
    }, [button.name, button.text])

    const isDifferent = button.text !== (button.defaultParameter || button.text)

    return (
        <div className={styles.buttonField}>
            {editMode ? (
                <>
                    <div className={styles.field}>
                        <label className={styles.label}>
                            Название текста (строка):
                        </label>
                        <input
                            type="text"
                            className={styles.input}
                            value={localName}
                            onChange={(e) => setLocalName(e.target.value)}
                            onBlur={(e) =>
                                updateButtonConfig(
                                    sectionIndex,
                                    itemIndex,
                                    buttonIndex,
                                    'name',
                                    e.target.value,
                                )
                            }
                            placeholder="Название текста"
                        />
                    </div>
                    <div className={styles.field}>
                        <label className={styles.label}>
                            Текст текста (строка):
                        </label>
                        <input
                            type="text"
                            className={styles.input}
                            value={localText}
                            onChange={(e) => setLocalText(e.target.value)}
                            onBlur={(e) =>
                                updateButtonConfig(
                                    sectionIndex,
                                    itemIndex,
                                    buttonIndex,
                                    'text',
                                    e.target.value,
                                )
                            }
                            placeholder="Текст"
                        />
                    </div>
                    {isDifferent && (
                        <button
                            className={styles.resetButton}
                            onClick={() =>
                                resetButtonConfig(
                                    sectionIndex,
                                    itemIndex,
                                    buttonIndex,
                                )
                            }
                            title="Сбросить значение"
                        >
                            <MdRestore />
                        </button>
                    )}
                    <button
                        className={styles.removeButton}
                        onClick={() => handleRemoveButton(buttonIndex)}
                        title="Удалить текст"
                    >
                        <MdDelete />
                    </button>
                </>
            ) : (
                <>
                    <div className={styles.buttonName}>
                        {button.name}:
                    </div>
                    <input
                        type="text"
                        className={styles.buttonTextInput}
                        value={button.text}
                        onChange={(e) =>
                            updateButtonConfig(
                                sectionIndex,
                                itemIndex,
                                buttonIndex,
                                'text',
                                e.target.value,
                            )
                        }
                        title={`Изменить текст ${button.name}`}
                    />
                    {isDifferent && (
                        <button
                            className={styles.resetButton}
                            onClick={() =>
                                resetButtonConfig(
                                    sectionIndex,
                                    itemIndex,
                                    buttonIndex,
                                )
                            }
                            title="Сбросить значение"
                        >
                            <MdRestore />
                        </button>
                    )}
                </>
            )}
        </div>
    )
}

export default ButtonConfig