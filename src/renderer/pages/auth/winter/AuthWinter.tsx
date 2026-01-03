import { useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'

import Header from '../../../components/layout/header'
import userContext from '../../../api/context/user.context'
import { staticAsset } from '../../../utils/staticAssets'
import { checkUpdateHard, openAuthCallback, readAndSendTerms, useAuthRedirect } from '../authUtils'

import AppNameLogo from './../../../../../static/assets/icon/AppName.svg'

import Snowfall from './Snowfall'
import * as pageStyles from './winter_auth.module.scss'
import { useSelector } from 'react-redux'
import { RootState } from '../../../api/store/store'

export default function AuthPage() {
    const navigate = useNavigate()
    const { user } = useContext(userContext)
    const isDeprecated = useSelector((state: RootState) => state.app.isAppDeprecated)
    const img1Ref = useRef(null)
    const img2Ref = useRef(null)
    const img3Ref = useRef(null)
    const imgLogo = useRef(null)

    const startAuthProcess = () => openAuthCallback(navigate)
    const checkUpdate = () => checkUpdateHard()
    const readAndSendFile = async () => {
        try {
            await readAndSendTerms()
        } catch (error) {
            console.error('Ошибка чтения файла:', error)
        }
    }

    useAuthRedirect(user.id, navigate)
    useEffect(() => {
        const handleMouseMove = (e: { clientX: any; clientY: any }) => {
            const { innerWidth, innerHeight } = window
            const mouseX = e.clientX
            const mouseY = e.clientY

            const centerX = innerWidth / 2
            const centerY = innerHeight / 2

            const offsetX = (mouseX - centerX) / centerX
            const offsetY = (mouseY - centerY) / centerY

            const movementIntensity = [
                { ref: img1Ref, factor: 20, rotation: 5 },
                { ref: img2Ref, factor: 20, rotation: -5 },
                { ref: img3Ref, factor: 20, rotation: 5 },
                { ref: imgLogo, factor: -10, rotation: 0 },
            ]

            movementIntensity.forEach(({ ref, factor, rotation }) => {
                if (ref.current) {
                    const translateX = offsetX * factor
                    const translateY = offsetY * factor
                    const rotate = offsetX * rotation
                    ref.current.style.transform = `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg)`
                }
            })
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
            <Snowfall />
            <div className={pageStyles.main_window}>
                <img ref={img1Ref} className={pageStyles.img1} src={staticAsset('assets/images/winter/balls.png')} alt="Flat Cylinder" />
                <img ref={img2Ref} className={pageStyles.img2} src={staticAsset('assets/images/winter/charactertree.png')} alt="Thorus Knot" />
                <img ref={img3Ref} className={pageStyles.img3} src={staticAsset('assets/images/winter/snowman.png')} alt="Pyramid" />
                <div className={pageStyles.filter}></div>
                <div className={pageStyles.background}></div>
                <div className={pageStyles.container} ref={imgLogo}>
                    <div className={pageStyles.logoName}>
                        <AppNameLogo />
                        <img className={pageStyles.hat} src={staticAsset('assets/images/winter/hat.png')} />
                    </div>
                    {isDeprecated ? (
                        <>
                            <button className={pageStyles.discordAuth} onClick={checkUpdate}>
                                Проверить обновления
                            </button>
                            <span className={pageStyles.terms}>Приложение устарело и требует обновления 😡😡😡</span>
                        </>
                    ) : (
                        <>
                            <button className={pageStyles.discordAuth} onClick={startAuthProcess}>
                                Авторизация через Discord
                            </button>
                            <span className={pageStyles.terms}>
                                Нажимая на “Авторизация через Discord”, вы соглашаетесь с <br />
                                <a
                                    onClick={async () => {
                                        await readAndSendFile()
                                    }}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Соглашением об использовании программы
                                </a>
                            </span>
                        </>
                    )}
                </div>
            </div>
        </>
    )
}
