import React, { useContext } from 'react'
import userContext from '../../api/context/user.context'

import Minus from './../../../../static/assets/icons/minus.svg'
import Minimize from './../../../../static/assets/icons/minimize.svg'
import Close from './../../../../static/assets/icons/close.svg'

import * as styles from '../layout/header.module.scss'

interface p {
    goBack?: boolean
}

const OptionHeader: React.FC<p> = () => {
    const { app } = useContext(userContext)

    return (
        <>
            <header className={styles.nav_bar}>
                <div className={styles.fix_size}>
                    <div className={styles.app_menu}>
                        <div className={styles.logoplace}>
                            <span>Settings</span>
                        </div>
                    </div>
                    <div className={styles.event_container}>
                        <div className={styles.button_container}>
                            <button id="hide" className={styles.button_title} onClick={() => window.electron.settings.minimize()}>
                                <Minus color="#E4E5EA" />
                            </button>
                            <button id="minimize" className={styles.button_title} onClick={() => window.electron.settings.maximize()}>
                                <Minimize color="#E4E5EA" />
                            </button>
                            <button
                                id="close"
                                className={styles.button_title}
                                onClick={() => window.electron.settings.close(app.settings.closeAppInTray)}
                            >
                                <Close color="#E4E5EA" />
                            </button>
                        </div>
                    </div>
                </div>
            </header>
        </>
    )
}

export default OptionHeader
