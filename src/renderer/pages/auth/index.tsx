import { useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'

import OldHeader from '../../components/layout/old_header'

import userContext from '../../api/context/user.context'
import config from '../../api/config'

import AppNameLogo from './../../../../static/assets/icon/AppName.svg'

import * as pageStyles from './auth.module.scss'
import { RootState } from '../../api/store/store'
import { useSelector } from 'react-redux'

export default function AuthPage() {
    const navigate = useNavigate()
    const { user, app } = useContext(userContext)
    const isDeprecated = useSelector((state: RootState) => state.app.isDeprecated)
    const img1Ref = useRef(null)
    const img2Ref = useRef(null)
    const img3Ref = useRef(null)
    const img4Ref = useRef(null)
    const imgLogo = useRef(null)

    const startAuthProcess = () => {
        window.open(config.SERVER_URL + '/auth/discord')
        navigate('/auth/callback', { replace: true })
    }
    const checkUpdate = () => {
        window.desktopEvents?.send('checkUpdate')
    }

    useEffect(() => {
        if (user.id !== '-1') {
            navigate('/trackinfo', { replace: true })
        }
    }, [user.id, navigate])

    const readAndSendFile = async () => {
        try {
            const response = await fetch('./static/assets/policy/terms.ru.md')
            const fileContent = await response.text()

            window.desktopEvents?.send('open-file', fileContent)
        } catch (error) {
            console.error('Ошибка чтения файла:', error)
        }
    }
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
                { ref: img2Ref, factor: 40, rotation: -5 },
                { ref: img3Ref, factor: 60, rotation: 7 },
                { ref: img4Ref, factor: 80, rotation: -7 },
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
            <OldHeader />
            <div className={pageStyles.main_window}>
                <img
                    ref={img1Ref}
                    className={pageStyles.img1}
                    src="./static/assets/images/FlatCylinder.png"
                    alt="Flat Cylinder"
                />
                <img
                    ref={img2Ref}
                    className={pageStyles.img2}
                    src="./static/assets/images/ThorusKnot.png"
                    alt="Thorus Knot"
                />
                <img ref={img3Ref} className={pageStyles.img3} src="./static/assets/images/Pyramid.png" alt="Pyramid" />
                <img
                    ref={img4Ref}
                    className={pageStyles.img4}
                    src="./static/assets/images/Icosahedron.png"
                    alt="Icosahedron"
                />
                <div className={pageStyles.filter}></div>
                <div className={pageStyles.background}></div>
                <div className={pageStyles.container} ref={imgLogo}>
                    <div className={pageStyles.logoName}>
                        <AppNameLogo />
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
