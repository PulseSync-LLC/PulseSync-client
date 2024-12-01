import Header from '../../components/layout/header'

import * as styles from './callback.module.scss'

import DiscordAuth from './../../../../static/assets/icons/discordAuth.svg'
import HandBlock from './../../../../static/assets/icons/handBlock.svg'
import UserBlock from './../../../../static/assets/icons/userBlock.svg'
import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import userContext from '../../api/context/user.context'
import OldHeader from '../../components/layout/old_header'

export default function CallbackPage() {
    const navigate = useNavigate()
    const { user, authorize } = useContext(userContext)
    const [banned, setBanned] = useState('')

    useEffect(() => {
        if (user.id !== '-1') {
            navigate('/trackinfo')
        }
    }, [user.id])

    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.desktopEvents?.on('authSuccess', (event, data) => {
                authorize()
            })
            window.desktopEvents?.on('authBanned', (event, data) => {
                setBanned(data.reason)
                setTimeout(() => window.electron.window.exit(), 10000)
            })
        }
    }, [])
    return (
        <>
            <OldHeader />
            <div className={styles.main_window}>
                <div>
                    <div className={styles.container}>
                        {!banned && <DiscordAuth />}
                        {banned && (
                            <div className={styles.animBan}>
                                <HandBlock className={styles.svg1} />
                                <UserBlock className={styles.svg2} />
                            </div>
                        )}
                        {!banned ? (
                            'Ожидание авторизации'
                        ) : (
                            <p>
                                Вы забанены. По причине: {banned}. <br />{' '}
                                Приложение закроется через 10 секунд
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}
