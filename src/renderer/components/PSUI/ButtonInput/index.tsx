import React, { useEffect, useState } from 'react'
import * as styles from './ButtonInput.module.scss'
import clsx from 'clsx'
import TooltipButton from '../../tooltip_button'
import { MdHelp } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

interface ButtonInputProps {
    label: string
    disabled?: boolean
    description?: string
    className?: string
    checkType?: string
    defaultValue?: boolean
    touched?: boolean
    error?: string
    onChange?: (value: boolean) => void
    onClick?: () => void
}

const ButtonInput: React.FC<ButtonInputProps> = ({
    label,
    disabled = false,
    description,
    className = '',
    checkType,
    defaultValue,
    touched,
    error,
    onChange,
    onClick,
}) => {
    const { t } = useTranslation()
    const [isActive, setIsActive] = useState<boolean>(Boolean(defaultValue))

    useEffect(() => {
        setIsActive(Boolean(defaultValue))
    }, [defaultValue])

    const toggleState = (e: React.MouseEvent) => {
        e.stopPropagation()

        if (onClick) {
            onClick()
            return
        }
        if (disabled) return

        const newValue = !isActive
        setIsActive(newValue)
        onChange?.(newValue)
    }

    return (
        <div
            className={clsx(styles.inputContainer, className)}
            style={disabled ? { opacity: 0.5 } : { cursor: onClick || checkType ? 'pointer' : 'default' }}
            onClick={toggleState}
        >
            <div className={styles.label}>
                {label}
                {description && (
                    <TooltipButton className={styles.tip} side="right" tooltipText={<div className={styles.itemName}>{description}</div>}>
                        <MdHelp size={14} color="white" />
                    </TooltipButton>
                )}
            </div>

            {checkType ? (
                <div className={styles.control}>
                    <div
                        className={clsx(styles.textInput, {
                            [styles.activeText]: isActive,
                            [styles.inactiveText]: !isActive,
                        })}
                        aria-invalid={Boolean(touched && error)}
                        aria-errormessage={touched && error ? `${checkType}-error` : undefined}
                    >
                        {isActive ? t('common.enabled') : t('common.disabled')}
                    </div>

                    <button
                        className={clsx(styles.controlButton, styles.toggleButton, {
                            [styles.active]: isActive,
                            [styles.error]: touched && error,
                        })}
                        onClick={toggleState}
                        type="button"
                    >
                        <span className={styles.knob}></span>
                    </button>
                </div>
            ) : null}

            {touched && error && (
                <div id={`${checkType}-error`} className={styles.error}>
                    {error}
                </div>
            )}
        </div>
    )
}

export default ButtonInput
