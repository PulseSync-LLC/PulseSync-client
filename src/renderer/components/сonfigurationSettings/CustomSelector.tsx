import React, { useState, forwardRef, useImperativeHandle } from 'react'
import * as styles from './CustomSelector.module.scss'
import { MdKeyboardArrowDown } from 'react-icons/md'

export interface SelectorOption {
    event: string
    name: string
}

export interface CustomSelectorProps {
    options: { [key: string]: SelectorOption }
    value: number
    onChange: (newValue: number) => void
}

export interface CustomSelectorRef {
    toggle: () => void
}

const CustomSelector = forwardRef<CustomSelectorRef, CustomSelectorProps>(
    ({ options, value, onChange }, ref) => {
        const [open, setOpen] = useState(false)

        useImperativeHandle(ref, () => ({
            toggle: () => setOpen((prev) => !prev),
        }))

        const handleToggle = () => {
            setOpen((prev) => !prev)
        }

        const handleSelectOption = (optionKey: string, e: React.MouseEvent) => {
            e.stopPropagation()
            onChange(Number(optionKey))
            setOpen(false)
        }        

        const selectedOption = options[String(value)] || { name: 'Выбрать' }

        return (
            <div
                className={styles.selectorContainer}
                onClick={(e) => {
                    e.stopPropagation()
                    handleToggle()
                }}
            >
                <div className={styles.selectedValue}>{selectedOption.name}</div>
                <div className={`${styles.arrow} ${open ? styles.open : ''}`}>
                    <MdKeyboardArrowDown size={30} />
                </div>
                {open && (
                    <div className={styles.dropdown}>
                        {Object.entries(options).map(([key, option]) => (
                            <div
                                key={key}
                                className={`${styles.dropdownOption} ${key === String(value) ? styles.activeOption : ''}`}
                                onClick={(e) => handleSelectOption(key, e)}
                            >
                                {option.name}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )
    },
)

export default CustomSelector
