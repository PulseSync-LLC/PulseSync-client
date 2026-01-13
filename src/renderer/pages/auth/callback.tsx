import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import RendererEvents from '../../../common/types/rendererEvents'

import * as pageStyles from './callback.module.scss'

import DiscordAuthIcon from './../../../../static/assets/icons/discordAuth.svg'
import HandBlockIcon from './../../../../static/assets/icons/handBlock.svg'
import UserBlockIcon from './../../../../static/assets/icons/userBlock.svg'

import userContext from '../../api/context/user.context'
import Header from '../../components/layout/header'
import { useTranslation } from 'react-i18next'

export default function CallbackPage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { user, authorize } = useContext(userContext)
    const [banReason, setBanReason] = useState('')

    useEffect(() => {
        if (user.id !== '-1') {
            navigate('/')
        }
    }, [user.id, navigate])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const handleBanned = (_event: any, data: any) => {
            setBanReason(data.reason)
            setTimeout(() => window.electron.window.exit(), 10000)
        }
        window.desktopEvents?.on(RendererEvents.AUTH_BANNED, handleBanned)
        return () => {
            window.desktopEvents?.removeListener(RendererEvents.AUTH_BANNED, handleBanned)
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
                            t('auth.pendingAuth')
                        ) : (
                            <p>
                                {t('auth.bannedMessage', { reason: banReason })} <br /> {t('auth.closeAfterSeconds')}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}
