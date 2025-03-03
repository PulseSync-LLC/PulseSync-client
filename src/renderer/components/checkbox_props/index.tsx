import React from 'react'
import * as styles from './checkbox_props.module.scss'

interface CustomCheckboxProps {
    checked: boolean
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    label?: string
    className?: string
}

const CustomCheckbox: React.FC<CustomCheckboxProps> = ({ checked, onChange, label, className }) => {
    return (
        <label className={`${styles.customCheckbox} ${className}`}>
            <input type="checkbox" checked={checked} onChange={onChange} className={styles.checkboxInput} />
            {label && <span className={styles.checkboxLabel}>{label}</span>}
            <div className={`${styles.customBox} ${checked ? styles.checked : ''}`}></div>
        </label>
    )
}

export default CustomCheckbox
