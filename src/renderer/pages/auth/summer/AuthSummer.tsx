import { useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'

import Header from '../../../components/layout/header'
import userContext from '../../../api/context/user.context'
import { staticAsset } from '../../../utils/staticAssets'
import { checkUpdateHard, openAuthCallback, readAndSendTerms, useAuthRedirect } from '../authUtils'

import * as pageStyles from './summer_auth.module.scss'
import { RootState } from '../../../api/store/store'
import { useSelector } from 'react-redux'

export default function AuthSummer() {
    const navigate = useNavigate()
    const { user } = useContext(userContext)
    const isDeprecated = useSelector((state: RootState) => state.app.isAppDeprecated)
    const img1Ref = useRef(null)
    const img2Ref = useRef(null)
    const img3Ref = useRef(null)
    const img4Ref = useRef(null)
    const imgLogo = useRef(null)

    const pulseChanRef = useRef(null)
    const jmhIntervalRef = useRef(null)

    const isDraggingRef = useRef(false)
    const dragOffsetRef = useRef({ x: 0, y: 0 })
    const initPosRef = useRef({ pos: '', left: '', top: '' })

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
        const handleMouseMove = (e: MouseEvent) => {
            const { innerWidth, innerHeight } = window
            const offsetX = (e.clientX - innerWidth / 2) / (innerWidth / 2)
            const offsetY = (e.clientY - innerHeight / 2) / (innerHeight / 2)
            const layers = [
                { ref: img1Ref, f: 60, r: 5 },
                { ref: img2Ref, f: 60, r: -5 },
                { ref: img3Ref, f: 60, r: 7 },
                { ref: img4Ref, f: 60, r: -7 },
                { ref: imgLogo, f: -10, r: 0 },
            ]
            layers.forEach(({ ref, f, r }) => {
                if (ref.current) {
                    const tx = offsetX * f
                    const ty = offsetY * f
                    const rot = offsetX * r
                    ref.current.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg)`
                }
            })
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey && e.code === 'KeyR') || e.key.toLowerCase() === 'f5') {
                e.preventDefault()
            }
        }
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [])

    const onDrag = (e: MouseEvent) => {
        if (!isDraggingRef.current || !pulseChanRef.current) return
        const x = e.clientX - dragOffsetRef.current.x
        const y = e.clientY - dragOffsetRef.current.y
        pulseChanRef.current.style.left = `${x}px`
        pulseChanRef.current.style.top = `${y}px`
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!pulseChanRef.current) return
        const el = pulseChanRef.current

        const style = getComputedStyle(el)
        initPosRef.current = {
            pos: style.position,
            left: el.style.left,
            top: el.style.top,
        }

        el.style.position = 'absolute'
        const rect = el.getBoundingClientRect()
        dragOffsetRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        }
        isDraggingRef.current = true
        document.addEventListener('mousemove', onDrag)

        if (jmhIntervalRef.current) clearInterval(jmhIntervalRef.current)
        jmhIntervalRef.current = setInterval(() => {
            const sX = 0.85 + Math.random() * 0.05
            const sY = 0.85 + Math.random() * 0.05
            const rot = (Math.random() - 0.5) * 10
            el.style.transform = `scale(${sX},${sY}) rotate(${rot}deg)`
        }, 40)

        document.addEventListener('mouseup', handleMouseUp)
    }

    const handleMouseUp = () => {
        isDraggingRef.current = false
        document.removeEventListener('mousemove', onDrag)
        document.removeEventListener('mouseup', handleMouseUp)

        if (jmhIntervalRef.current) {
            clearInterval(jmhIntervalRef.current)
            jmhIntervalRef.current = null
        }

        if (!pulseChanRef.current) return
        const el = pulseChanRef.current

        el.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1), left 0.5s ease, top 0.5s ease'
        el.style.transform = 'scale(1) rotate(0deg)'
        el.style.position = initPosRef.current.pos
        el.style.left = initPosRef.current.left
        el.style.top = initPosRef.current.top
    }

    useEffect(
        () => () => {
            if (jmhIntervalRef.current) clearInterval(jmhIntervalRef.current)
            document.removeEventListener('mousemove', onDrag)
            document.removeEventListener('mouseup', handleMouseUp)
        },
        [],
    )

    return (
        <>
            <Header />
            <div className={pageStyles.main_window}>
                <img ref={img1Ref} className={pageStyles.img1} src={staticAsset('assets/images/FlatCylinder.png')} alt="FlatCylinder" />
                <img ref={img2Ref} className={pageStyles.img2} src={staticAsset('assets/images/ThorusKnot.png')} alt="ThorusKnot" />
                <img ref={img3Ref} className={pageStyles.img3} src={staticAsset('assets/images/Pyramid.png')} alt="Pyramid" />
                <img ref={img4Ref} className={pageStyles.img4} src={staticAsset('assets/images/Icosahedron.png')} alt="Icosahedron" />

                <div className={pageStyles.filter} />
                <div className={pageStyles.background} />

                <div className={pageStyles.container} ref={imgLogo}>
                    <div className={pageStyles.logoName}>
                        <img
                            ref={pulseChanRef}
                            className={pageStyles.imgChan}
                            src={staticAsset('assets/images/PulseChan3D.png')}
                            alt="PulseChan"
                            draggable={false}
                            onDragStart={e => e.preventDefault()}
                            onMouseDown={handleMouseDown}
                            onTouchStart={e => {
                                e.preventDefault()
                                handleMouseDown(e as any)
                            }}
                        />
                        <img className={pageStyles.imgLogo} src={staticAsset('assets/images/LogoName3D.png')} alt="LogoName" />
                    </div>

                    {isDeprecated ? (
                        <>
                            <button className={pageStyles.discordAuth} onClick={checkUpdate}>
                                Проверить обновления
                            </button>
                            <span className={pageStyles.terms}>Приложение устарело и требует обновления 😡</span>
                        </>
                    ) : (
                        <>
                            <button className={pageStyles.discordAuth} onClick={startAuthProcess}>
                                Авторизация через Discord
                            </button>
                            <span className={pageStyles.terms}>
                                Нажимая на "Авторизация через Discord", вы соглашаетесь с
                                <br />
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
