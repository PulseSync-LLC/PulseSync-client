import React from 'react'

import { IoCheckmarkSharp } from 'react-icons/io5'
import { MdChevronRight } from 'react-icons/md'

import * as styles from '@widgets/modalContainer/modals/SettingsModal/components/SettingsControl/SettingsControl.module.scss'

import type { SettingsItem } from '@widgets/modalContainer/modals/SettingsModal/model/types'

interface SettingsControlProps {
    item: SettingsItem
}

const SettingsControl: React.FC<SettingsControlProps> = ({ item }) => {
    if (item.kind === 'toggle') {
        return (
            <div className={styles.toggleRow}>
                <div className={styles.toggleCopy}>
                    <div className={styles.toggleTitle}>{item.label}</div>
                    {item.description && <div className={styles.toggleDescription}>{item.description}</div>}
                </div>
                <button
                    type="button"
                    className={`${styles.checkbox} ${item.checked ? styles.checkboxChecked : ''}`}
                    role="checkbox"
                    aria-checked={item.checked}
                    aria-label={item.label}
                    disabled={item.disabled}
                    onClick={() => item.onChange(!item.checked)}
                >
                    {item.checked && <IoCheckmarkSharp size={15} aria-hidden="true" />}
                </button>
            </div>
        )
    }

    if (item.kind === 'choice') {
        return (
            <button
                type="button"
                className={`${styles.choice} ${item.selected ? styles.choiceSelected : ''}`}
                aria-pressed={item.selected}
                disabled={item.disabled}
                onClick={item.onSelect}
            >
                <span className={styles.choiceCopy}>
                    <span className={styles.choiceTitle}>{item.label}</span>
                    {item.description && <span className={styles.choiceDescription}>{item.description}</span>}
                </span>
                <span className={styles.radio} aria-hidden="true">
                    {item.selected && <span className={styles.radioDot} />}
                </span>
            </button>
        )
    }

    return (
        <button type="button" className={styles.action} disabled={item.disabled} onClick={item.onClick}>
            <span>{item.label}</span>
            <MdChevronRight size={20} aria-hidden="true" />
        </button>
    )
}

export default SettingsControl
