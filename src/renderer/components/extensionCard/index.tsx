import React, { CSSProperties, useState, useEffect, useRef } from 'react'
import * as cardStyles from './card.module.scss'
import AddonInterface from '../../api/interfaces/addon.interface'
import ContextMenu from '../../components/context_menu_themes'
import { createContextMenuActions } from '../../components/context_menu_themes/sectionConfig'
import { useNavigate } from 'react-router'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import ReactMarkdown from 'react-markdown'
import useInView from '../../hooks/useInView'

interface ExtensionCardProps {
    theme: AddonInterface
    isChecked: boolean
    onCheckboxChange: (themeName: string, isChecked: boolean) => void
    children?: any
    className?: string
    style?: CSSProperties
}

const ExtensionCard: React.FC<ExtensionCardProps> = React.memo(
    ({ theme, isChecked, onCheckboxChange, children, className, style }) => {
        const navigate = useNavigate()
        const [imageSrc, setImageSrc] = useState(
            'static/assets/images/no_themeImage.png',
        )
        const [bannerSrc, setBannerSrc] = useState(
            'static/assets/images/no_themeBackground.png',
        )
        const [contextMenuVisible, setContextMenuVisible] = useState(false)
        const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
        const [clickAllowed, setClickAllowed] = useState(true)
        const [cardHeight, setCardHeight] = useState('20px')
        const cardRef = useRef<HTMLDivElement | null>(null)
        const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
        const [fadingOut, setFadingOut] = useState(false)

        const [bannerRef, isBannerInView] = useInView({
            root: null,
            rootMargin: '0px',
            threshold: 0.1,
        })

        const getEncodedPath = (path: string) => encodeURI(path.replace(/\\/g, '/'))

        const LinkRenderer = React.useCallback(
            (props: any) => (
                <a href={props.href} target="_blank" rel="noreferrer">
                    {props.children}
                </a>
            ),
            [],
        )

        useEffect(() => {
            let isMounted = true
            if (theme.path && theme.image) {
                const imgSrc = getEncodedPath(`${theme.path}/${theme.image}`)
                fetch(imgSrc)
                    .then((res) => {
                        if (res.ok && isMounted) setImageSrc(imgSrc)
                    })
                    .catch(
                        () =>
                            isMounted &&
                            setImageSrc('static/assets/images/no_themeImage.png'),
                    )
            }
            return () => {
                isMounted = false
            }
        }, [theme])

        useEffect(() => {
            if (isBannerInView && theme.path && theme.banner) {
                const bannerPath = getEncodedPath(`${theme.path}/${theme.banner}`)
                fetch(bannerPath)
                    .then((res) => {
                        if (res.ok) setBannerSrc(bannerPath)
                    })
                    .catch(() =>
                        setBannerSrc('static/assets/images/no_themeBackground.png'),
                    )
            }
        }, [isBannerInView, theme])

        const handleClick = () => {
            if (clickAllowed) {
                navigate(`/extensionbeta/${theme.name}`, { state: { theme } })
            }
        }

        const handleMouseHoverStart = () => {
            hoverTimerRef.current = setTimeout(() => {
                if (cardRef.current) {
                    setMenuPosition({ x: 0, y: 0 })
                    setContextMenuVisible(true)
                    setClickAllowed(false)
                    setCardHeight('70px')
                }
            }, 500)
        }

        const handleMouseHoverEnd = () => {
            if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current)
                hoverTimerRef.current = null
            }
            closeContextMenu()
        }

        const closeContextMenu = () => {
            setFadingOut(true)
            setCardHeight('20px')
            setTimeout(() => {
                setContextMenuVisible(false)
                setClickAllowed(true)
                setFadingOut(false)
            }, 300)
        }

        return (
            <div
                ref={cardRef}
                className={`${className} ${cardStyles.extensionCard}`}
                onClick={handleClick}
                onMouseLeave={handleMouseHoverEnd}
            >
                <div
                    ref={bannerRef}
                    className={cardStyles.imageBanner}
                    style={{
                        backgroundImage: `url(${isBannerInView && theme.path && theme.banner ? getEncodedPath(`${theme.path}/${theme.banner}`) : 'static/assets/images/no_themeBackground.png'})`,
                        backgroundSize: 'cover',
                        transition: 'background-image 0.3s ease-in-out',
                    }}
                />
                <div className={cardStyles.metadataInfoContainer}>
                    <div className={cardStyles.metadataInfo}>
                        <div className={cardStyles.detailInfo}>V{theme.version}</div>
                        <div className={cardStyles.detailInfo}>
                            {theme.lastModified}
                        </div>
                    </div>
                    <div className={cardStyles.themeLocation}>local</div>
                </div>
                <img
                    className={cardStyles.themeImage}
                    src={imageSrc}
                    alt="Addon image"
                    loading="lazy"
                />
                <div className={cardStyles.themeDetail}>
                    <div className={cardStyles.detailTop}>
                        <span className={cardStyles.themeName}>{theme.name}</span>
                        <span className={cardStyles.themeAuthor}>
                            By {theme.author}
                        </span>
                    </div>
                    <div className={cardStyles.themeDescription}>
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={{ a: LinkRenderer }}
                        >
                            {theme.description}
                        </ReactMarkdown>
                    </div>
                </div>
                <div
                    className={cardStyles.triggerContextMenu}
                    onMouseEnter={handleMouseHoverStart}
                    onMouseLeave={handleMouseHoverEnd}
                    style={{ height: cardHeight, ...style }}
                >
                    <div className={cardStyles.line}></div>
                    {contextMenuVisible && (
                        <ContextMenu
                            items={createContextMenuActions(
                                onCheckboxChange,
                                isChecked,
                                {
                                    showCheck: true,
                                    showDirectory: true,
                                    showExport: true,
                                    showDelete: true,
                                },
                                theme,
                            )}
                            position={menuPosition}
                            onClose={closeContextMenu}
                            isFadingOut={fadingOut}
                            setIsFadingOut={setFadingOut}
                        />
                    )}
                </div>
            </div>
        )
    },
)

export default ExtensionCard
