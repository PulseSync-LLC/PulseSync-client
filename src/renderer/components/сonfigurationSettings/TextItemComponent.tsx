import React from 'react';
import { MdAdd } from 'react-icons/md';
import * as styles from './ConfigurationItem.module.scss';
import { ButtonAction, TextItem } from './types';
import ButtonConfig from './ButtonConfig';

interface TextItemComponentProps {
    sectionIndex: number;
    itemIndex: number;
    item: TextItem;
    editMode: boolean;
    updateButtonConfig: (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
        key: keyof ButtonAction,
        newValue: string,
    ) => void;
    resetButtonConfig: (
        sectionIndex: number,
        itemIndex: number,
        buttonIndex: number,
    ) => void;
    updateConfigField: (
        sectionIndex: number,
        itemIndex: number,
        key: string,
        value: any,
    ) => void;
    handleRemoveButton: (buttonIndex: number) => void;
}

const TextItemComponent: React.FC<TextItemComponentProps> = ({
    sectionIndex,
    itemIndex,
    item,
    editMode,
    updateButtonConfig,
    resetButtonConfig,
    updateConfigField,
    handleRemoveButton,
}) => {
    const handleAddButton = () => {
        const newButton: ButtonAction = {
            id: `btn_${Date.now()}`,
            name: 'newButton',
            text: 'Новый текст',
            defaultParameter: 'Новый текст',
        };
        const updatedButtons = [...item.buttons, newButton];
        updateConfigField(
            sectionIndex,
            itemIndex,
            'buttons',
            updatedButtons,
        );
    };    

    return (
        <div className={styles.textContainer}>
            {editMode && (
                <>
                </>
            )}
            {item.buttons.map((button, buttonIndex) => (
                <ButtonConfig
                    key={buttonIndex}
                    sectionIndex={sectionIndex}
                    itemIndex={itemIndex}
                    buttonIndex={buttonIndex}
                    button={button}
                    editMode={editMode}
                    updateButtonConfig={updateButtonConfig}
                    resetButtonConfig={resetButtonConfig}
                    handleRemoveButton={handleRemoveButton}
                />
            ))}
            {editMode && (
                <button
                    className={styles.addButton}
                    onClick={handleAddButton}
                    title="Добавить текст"
                >
                    <MdAdd /> Добавить текст
                </button>
            )}
        </div>
    );
};

export default TextItemComponent;
