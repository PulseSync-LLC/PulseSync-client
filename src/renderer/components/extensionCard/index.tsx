import React, { CSSProperties, useState, useEffect, useRef } from 'react'
import * as styles from './card.module.scss'
import ThemeInterface from '../../api/interfaces/theme.interface'
import ContextMenu from '../../components/context_menu_themes'
import { createActions } from '../../components/context_menu_themes/sectionConfig'
import { useNavigate } from 'react-router'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import ReactMarkdown from 'react-markdown'

interface Props {
    theme: ThemeInterface
    isChecked: boolean
    onCheckboxChange: (themeName: string, isChecked: boolean) => void
    children?: any
    className?: string
    style?: CSSProperties
}

const ExtensionCard: React.FC<Props> = ({
    theme,
    isChecked,
    onCheckboxChange,
    children,
    className,
    style,
}) => {
    const navigate = useNavigate()
    const [imageSrc, setImageSrc] = useState(
        'static/assets/images/no_themeImage.png',
    )
    const [bannerSrc, setBannerSrc] = useState(
        'static/assets/images/no_themeBackground.png',
    )

    const [contextMenuVisible, setContextMenuVisible] = useState(false)
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
    const [clickEnabled, setClickEnabled] = useState(true)
    const [cardHeight, setCardHeight] = useState('20px')
    const cardRef = useRef<HTMLDivElement | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [isFadingOut, setIsFadingOut] = useState(false)

    const formatPath = (path: string) => {
        return encodeURI(path.replace(/\\/g, '/'))
    }
    function LinkRenderer(props: any) {
        return (
            <a href={props.href} target="_blank" rel="noreferrer">
                {props.children}
            </a>
        )
    }
    useEffect(() => {
        if (theme.path && theme.image) {
            const imgSrc = formatPath(`${theme.path}/${theme.image}`)
            fetch(imgSrc)
                .then(res => {
                    if (res.ok) {
                        setImageSrc(imgSrc)
                    }
                })
                .catch(() => {
                    setImageSrc('static/assets/images/no_themeImage.png')
                })
        }
    }, [theme])

    useEffect(() => {
        if (theme.path && theme.banner) {
            const bannerPath = formatPath(`${theme.path}/${theme.banner}`)
            fetch(bannerPath)
                .then(res => {
                    if (res.ok) {
                        setBannerSrc(bannerPath)
                    }
                })
                .catch(() => {
                    setBannerSrc('static/assets/images/no_themeBackground.png')
                })
        }
    }, [theme])

    const handleClick = () => {
        if (clickEnabled) {
            navigate(`/extensionbeta/${theme.name}`, { state: { theme } })
        }
    }

    const handleMouseEnter = () => {
        timerRef.current = setTimeout(() => {
            if (cardRef.current) {
                setMenuPosition({ x: 0, y: 0 })
                setContextMenuVisible(true)
                setClickEnabled(false)
                setCardHeight('70px')
            }
        }, 500)
    }

    const handleMouseLeave = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
        closeContextMenu()
    }

    const closeContextMenu = () => {
        setIsFadingOut(true)
        setCardHeight('20px')
        setTimeout(() => {
            setContextMenuVisible(false)
            setClickEnabled(true)
            setIsFadingOut(false)
        }, 300)
    }

    return (
        <div
            ref={cardRef}
            className={`${className} ${styles.extensionCard}`}
            onClick={handleClick}
            onMouseLeave={handleMouseLeave}
        >
            <div
                className={styles.imageBanner}
                style={{
                    backgroundImage: `url(${bannerSrc})`,
                    backgroundSize: `cover`,
                }}
            />
            <div className={styles.metadataInfoContainer}>
                <div className={styles.metadataInfo}>
                    <div className={styles.detailInfo}>V{theme.version}</div>
                    <div className={styles.detailInfo}>
                        {theme.lastModified}
                    </div>
                </div>
                <div className={styles.themeLocation}>local</div>
            </div>
            <img
                className={styles.themeImage}
                src={imageSrc}
                alt="Theme image"
            />
            <div className={styles.themeDetail}>
                <div className={styles.detailTop}>
                    <span className={styles.themeName}>{theme.name}</span>
                    <span className={styles.themeAuthor}>
                        By {theme.author}
                    </span>
                </div>
                <div className={styles.themeDescription}>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={{ a: LinkRenderer }}
                    >
                        {theme.description}
                    </ReactMarkdown>
                </div>
            </div>
            <div
                className={styles.triggerContextMenu}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                style={{ height: cardHeight, ...style }}
            >
                <div className={styles.line}></div>
                {contextMenuVisible && (
                    <ContextMenu
                        items={createActions(
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
                        isFadingOut={isFadingOut}
                        setIsFadingOut={setIsFadingOut}
                    />
                )}
            </div>
        </div>
        // <div
        //     ref={cardRef}
        //     className={`${className} ${styles.extensionCard}`}
        //     onClick={handleClick}
        //     onContextMenu={handleRightClick}
        //     style={{
        //         backgroundImage: `linear-gradient(0deg, #292C36 0%, rgba(41, 44, 54, 0.9) 100%), url(${bannerSrc})`,
        //     }}
        // >
        //     <div className={styles.imageOverlay}>
        //         <div className={styles.leftOrig}>
        //             <img className={styles.themeImage} src={imageSrc} alt="Theme image" />
        //             <div className={styles.detailTop}>
        //                 <span className={styles.themeTitle}>{theme.name}</span>
        //                 <span className={styles.themeAuthor}>By {theme.author}</span>
        //             </div>
        //         </div>
        //         <div className={styles.rightOrig}>
        //             <div>(local) ver. {theme.version}</div>
        //             <div>{theme.lastModified}</div>
        //         </div>
        //     </div>
        //     <span className={styles.themeDescription}>
        //         {theme.description}
        //     </span>
        // </div>
    )
}

export default ExtensionCard
