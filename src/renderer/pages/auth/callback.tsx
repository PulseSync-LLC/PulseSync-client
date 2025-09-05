import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import RendererEvents from '../../../common/types/rendererEvents'

import * as pageStyles from './callback.module.scss'

import DiscordAuthIcon from './../../../../static/assets/icons/discordAuth.svg'
import HandBlockIcon from './../../../../static/assets/icons/handBlock.svg'
import UserBlockIcon from './../../../../static/assets/icons/userBlock.svg'

import userContext from '../../api/context/user.context'
import Header from '../../components/layout/header'

export default function CallbackPage() {
    const navigate = useNavigate()
    const { user, authorize } = useContext(userContext)
    const [banReason, setBanReason] = useState('')

    useEffect(() => {
        if (user.id !== '-1') {
            navigate('/trackinfo')
        }
    }, [user.id, navigate])

    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.desktopEvents?.on(RendererEvents.AUTH_BANNED, (event, data) => {
                setBanReason(data.reason)
                setTimeout(() => window.electron.window.exit(), 10000)
            })
        }
    }, [])

    return (
        <>
            <Header />
            <div className={pageStyles.main_window}>
                <div>
                    <div className={pageStyles.container}>
                        {!banReason && <DiscordAuthIcon />}
                        {banReason && (
                            <div className={pageStyles.animBan}>
                                <HandBlockIcon className={pageStyles.svg1} />
                                <UserBlockIcon className={pageStyles.svg2} />
                            </div>
                        )}
                        {!banReason ? (
                            'Ожидание авторизации'
                        ) : (
                            <p>
                                Вы забанены. По причине: {banReason}. <br /> Приложение закроется через 10 секунд
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}
