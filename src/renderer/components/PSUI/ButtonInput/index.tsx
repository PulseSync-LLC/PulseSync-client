// src/renderer/components/PSUI/ButtonInput/index.tsx
import React, { useState, useContext, useEffect } from 'react'
import * as styles from './ButtonInput.module.scss'
import clsx from 'clsx'
import TooltipButton from '../../tooltip_button'
import { MdHelp } from 'react-icons/md'
import userContext from '../../../api/context/user.context'

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
    const { app, setApp } = useContext(userContext)
    const [isActive, setIsActive] = useState<boolean>(defaultValue ?? false)

    useEffect(() => {
        switch (checkType) {
            case 'toggleRpcStatus':
                setIsActive(app.discordRpc.status)
                break
            case 'enableRpcButtonListen':
                setIsActive(app.discordRpc.enableRpcButtonListen)
                break
            case 'enableGithubButton':
                setIsActive(app.discordRpc.enableGithubButton)
                break
            case 'displayPause':
                setIsActive(app.discordRpc.displayPause)
                break
            case 'showVersionOrDevice':
                setIsActive(app.discordRpc.showVersionOrDevice)
                break
            case 'showSmallIcon':
                setIsActive(app.discordRpc.showSmallIcon)
                break
        }
    }, [checkType, app.discordRpc])

    const toggleState = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (disabled) return
        if (onClick) {
            onClick()
            return
        }
        const newValue = !isActive
        setIsActive(newValue)

        if (onChange) {
            onChange(newValue)
        } else {
            switch (checkType) {
                case 'toggleRpcStatus':
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.discordRpc.discordRpc(newValue)
                    setApp({
                        ...app,
                        discordRpc: { ...app.discordRpc, status: newValue },
                    })
                    break
                case 'enableRpcButtonListen':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.enableRpcButtonListen', newValue)
                    setApp({
                        ...app,
                        discordRpc: { ...app.discordRpc, enableRpcButtonListen: newValue },
                    })
                    break
                case 'enableGithubButton':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.enableGithubButton', newValue)
                    setApp({
                        ...app,
                        discordRpc: { ...app.discordRpc, enableGithubButton: newValue },
                    })
                    break
                case 'displayPause':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.displayPause', newValue)
                    setApp({
                        ...app,
                        discordRpc: { ...app.discordRpc, displayPause: newValue },
                    })
                    break
                case 'showVersionOrDevice':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.showVersionOrDevice', newValue)
                    setApp({
                        ...app,
                        discordRpc: { ...app.discordRpc, showVersionOrDevice: newValue },
                    })
                    break
                case 'showSmallIcon':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.showSmallIcon', newValue)
                    setApp({
                        ...app,
                        discordRpc: { ...app.discordRpc, showSmallIcon: newValue },
                    })
                    break
                default:
                    break
            }
        }
    }

    return (
        <div
            className={clsx(styles.inputContainer, className)}
            style={disabled ? { pointerEvents: 'none', opacity: 0.5 } : { cursor: onClick || checkType ? 'pointer' : 'default' }}
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
                        {isActive ? 'Включено' : 'Выключено'}
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