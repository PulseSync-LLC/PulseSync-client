import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import RendererEvents from '@common/types/rendererEvents'

import * as pageStyles from '@pages/auth/callback.module.scss'

import AppIcon from '@shared/assets/icon/App.svg'
import HandBlockIcon from '@shared/assets/icons/handBlock.svg'
import UserBlockIcon from '@shared/assets/icons/userBlock.svg'

import userContext from '@entities/user/model/context'
import Header from '@widgets/layout/header'
import { useTranslation } from 'react-i18next'

export default function CallbackPage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { user, authorize } = useContext(userContext)
    const [banReason, setBanReason] = useState('')

    useEffect(() => {
        if (user.id !== '-1') {
            navigate('/home')
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
                        {!banReason && <AppIcon width="100" height="100" />}
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
