import React, {
    ButtonHTMLAttributes,
    useContext,
    useEffect,
    useState,
} from 'react'
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

const Checkbox: React.FC<Props> = ({
    children,
    disabled,
    description,
    checkType,
    isChecked,
    onChange,
}) => {
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
                    setIsActive(
                        window.electron.store.get(
                            'discordRpc.enableRpcButtonListen',
                        ),
                    )
                    break
                case 'enableGithubButton':
                    setIsActive(
                        window.electron.store.get(
                            'discordRpc.enableGithubButton',
                        ),
                    )
                    break
                case 'readPolicy':
                    setIsActive(
                        window.electron.store.get('settings.readPolicy'),
                    )
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
                    window.desktopEvents.send('getTrackInfo')
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
                    window.desktopEvents.send('getTrackInfo')
                    window.electron.store.set(
                        'discordRpc.enableRpcButtonListen',
                        event.target.checked,
                    )
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            enableRpcButtonListen: event.target.checked,
                        },
                    })
                    break
                case 'enableGithubButton':
                    window.discordRpc.clearActivity()
                    window.desktopEvents.send('getTrackInfo')
                    window.electron.store.set(
                        'discordRpc.enableGithubButton',
                        event.target.checked,
                    )
                    setApp({
                        ...app,
                        discordRpc: {
                            ...app.discordRpc,
                            enableGithubButton: event.target.checked,
                        },
                    })
                    break
                case 'readPolicy':
                    setApp({
                        ...app,
                        settings: {
                            ...app.settings,
                            readPolicy: event.target.checked,
                        },
                    })
                    window.electron.store.set(
                        'settings.readPolicy',
                        event.target.checked,
                    )
                    break
            }
        }
    }

    return (
        <label
            className={`${styles.checkbox} ${isActive ? styles.active : ''} ${
                disabled ? styles.disabled : ''
            }`}
        >
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
