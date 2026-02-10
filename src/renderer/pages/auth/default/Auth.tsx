import { useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'

import Header from '../../../components/layout/header'
import userContext from '../../../api/context/user.context'
import { checkUpdateHard, openAuthCallback, readAndSendTerms, useAuthRedirect } from '../authUtils'

import AppNameLogo from '../../../assets/icon/AppName.svg'

import * as pageStyles from './auth.module.scss'
import { useSelector } from 'react-redux'
import { RootState } from '../../../api/store/store'
import { useTranslation } from 'react-i18next'

export default function AuthPage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { user } = useContext(userContext)
    const isDeprecated = useSelector((state: RootState) => state.app.isAppDeprecated)
    const containerRef = useRef<HTMLDivElement>(null)

    const startAuthProcess = () => openAuthCallback(navigate)
    const checkUpdate = () => checkUpdateHard()
    const readAndSendFile = async () => {
        try {
            await readAndSendTerms()
        } catch (error) {
            console.error(t('auth.readTermsError'), error)
        }
    }

    useAuthRedirect(user.id, navigate)

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return
            const { innerWidth, innerHeight } = window
            const offsetX = (e.clientX - innerWidth / 2) / (innerWidth / 2)
            const offsetY = (e.clientY - innerHeight / 2) / (innerHeight / 2)
            containerRef.current.style.transform = `translate(${offsetX * -8}px, ${offsetY * -8}px)`
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey && event.code === 'KeyR') || event.key.toLowerCase() === 'f5') {
                event.preventDefault()
            }
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('keydown', handleKeyDown)

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [])

    return (
        <>
            <Header />
            <div className={pageStyles.main_window}>
                {/* Space Background */}
                <div className={pageStyles.spaceBackground}>
                    <div className={pageStyles.stars1} />
                    <div className={pageStyles.stars2} />
                    <div className={pageStyles.stars3} />
                    <div className={pageStyles.shootingStarsLayer}>
                        {[0, 1, 2].map(i => (
                            <div key={i} className={pageStyles.shootingStar} style={{ '--index': i } as React.CSSProperties} />
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className={pageStyles.container} ref={containerRef}>
                    <div className={pageStyles.logoBlock}>
                        <svg className={pageStyles.logoIcon} viewBox="0 0 40 40" fill="currentColor">
                            <path d="M20.6536 28.5839H40V40H20.6536V28.5839Z" />
                            <path d="M0 0H40V25.7143H17.7778V40H0V14.2857H22.2222V11.4286H0V0Z" />
                        </svg>
                        <div className={pageStyles.logoName}>
                            <AppNameLogo />
                        </div>
                    </div>

                    {isDeprecated ? (
                        <>
                            <button className={pageStyles.authButton} onClick={checkUpdate}>
                                {t('auth.checkUpdates')}
                            </button>
                            <span className={pageStyles.terms}>{t('auth.deprecatedRequiresUpdate')}</span>
                        </>
                    ) : (
                        <>
                            <button className={pageStyles.authButton} onClick={startAuthProcess}>
                                {t('auth.discordAuth')}
                            </button>
                            <span className={pageStyles.terms}>
                                {t('auth.consentPrefix')} <br />
                                <a
                                    onClick={async () => {
                                        await readAndSendFile()
                                    }}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t('auth.termsLink')}
                                </a>
                            </span>
                        </>
                    )}
                </div>
            </div>
        </>
    )
}
