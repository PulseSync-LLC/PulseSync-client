import React, { ButtonHTMLAttributes, useContext, useEffect, useState } from 'react'
import * as styles from './checkbox.module.scss'
import userContext from '../../api/context/user.context'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
    children?: any
    disabled?: boolean
    description?: string
    checkType?: string
    isChecked?: boolean
    onChange?: (event: any) => void
}

const Checkbox: React.FC<Props> = ({ children, disabled, description, checkType, isChecked, onChange }) => {
    const [isActive, setIsActive] = useState(false)
    const { app, setApp } = useContext(userContext)
    useEffect(() => {
        if (isChecked !== undefined) {
            setIsActive(isChecked)
        } else {
            switch (checkType) {
                case 'toggleRpcStatus':
                    setIsActive(app.discordRpc.status)
                    break
                case 'enableRpcButtonListen':
                    setIsActive(app.discordRpc.enableRpcButtonListen)
                    break
                case 'enableWebsiteButton':
                    setIsActive(app.discordRpc.enableWebsiteButton)
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
                case 'showTrackVersion':
                    setIsActive(app.discordRpc.showTrackVersion)
                    break
            }
        }
    }, [isChecked])

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setIsActive(event.target.checked)
        if (onChange) {
            onChange(event)
        } else {
            switch (checkType) {
                case 'toggleRpcStatus':
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.discordRpc.discordRpc(event.target.checked)
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            status: event.target.checked,
                        },
                    })
                    break
                case 'enableRpcButtonListen':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.enableRpcButtonListen', event.target.checked)
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            enableRpcButtonListen: event.target.checked,
                        },
                    })
                    break
                case 'enableWebsiteButton':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.enableWebsiteButton', event.target.checked)
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            enableWebsiteButton: event.target.checked,
                        },
                    })
                    break
                case 'displayPause':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.displayPause', event.target.checked)
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            displayPause: event.target.checked,
                        },
                    })
                    break
                case 'showVersionOrDevice':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.showVersionOrDevice', event.target.checked)
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            showVersionOrDevice: event.target.checked,
                        },
                    })
                    break
                case 'showSmallIcon':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.showSmallIcon', event.target.checked)
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            showSmallIcon: event.target.checked,
                        },
                    })
                    break
                case 'showTrackVersion':
                    window.discordRpc.clearActivity()
                    window.desktopEvents?.send('GET_TRACK_INFO')
                    window.electron.store.set('discordRpc.showTrackVersion', event.target.checked)
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            showTrackVersion: event.target.checked,
                        },
                    })
                    break
            }
        }
    }

    return (
        <label className={`${styles.checkbox} ${isActive ? styles.active : ''} ${disabled ? styles.disabled : ''}`}>
            <div className={styles.checkboxInner}>
                <div className={styles.children_content}>{children}</div>
                <input
                    className={`${styles.input_checkbox}`}
                    disabled={disabled}
                    type="checkbox"
                    checked={isActive}
                    name="checkbox-checked"
                    onChange={handleInputChange}
                />
                <div className={styles.custom_checkbox}>
                    <div className={styles.checkbox_slider}></div>
                </div>
            </div>
            <div className={styles.description}>{description}</div>
        </label>
    )
}

export default Checkbox
