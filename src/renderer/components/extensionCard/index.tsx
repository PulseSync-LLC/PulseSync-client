import React, { CSSProperties, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import useInView from '../../hooks/useInView'
import AddonInterface from '../../api/interfaces/addon.interface'
import {
    MdCheckCircle,
    MdColorLens,
    MdInfoOutline,
    MdTextSnippet,
    MdWarningAmber,
} from 'react-icons/md'
import * as cardStyles from './card.module.scss'

interface ExtensionCardProps {
    theme: AddonInterface
    isChecked: boolean
    onCheckboxChange: (themeName: string, isChecked: boolean) => void
    className?: string
    style?: CSSProperties
}

const ExtensionCard: React.FC<ExtensionCardProps> = React.memo(
    ({ theme, isChecked, onCheckboxChange, className, style }) => {
        const navigate = useNavigate()
        const [imageSrc, setImageSrc] = useState(
            'static/assets/images/no_themeImage.png',
        )
        const [bannerSrc, setBannerSrc] = useState(
            'static/assets/images/no_themeBackground.png',
        )
        const [showUserInfo, setShowUserInfo] = useState(false)
        const [showWarnInfo, setShowWarnInfo] = useState(false)
        const cardRef = useRef<HTMLDivElement | null>(null)
        const [bannerRef, isBannerInView] = useInView({ threshold: 0.1 })

        function checkMissingFields(addon: AddonInterface): string[] {
            const missing: string[] = []
            if (!addon.name) missing.push('name')
            if (!addon.author) missing.push('author')
            if (!addon.description) missing.push('description')
            if (!addon.version) missing.push('version')
            if (!addon.image) missing.push('image')
            if (!addon.banner) missing.push('banner')
            if (!addon.type) missing.push('type')
            return missing
        }

        const missingFields = checkMissingFields(theme)

        const getEncodedPath = (p: string) => encodeURI(p.replace(/\\/g, '/'))

        useEffect(() => {
            let mounted = true
            if (theme.path && theme.image) {
                const src = getEncodedPath(`${theme.path}/${theme.image}`)
                fetch(src)
                    .then((r) => {
                        if (r.ok && mounted) setImageSrc(src)
                    })
                    .catch(() => {
                        if (mounted) {
                            setImageSrc('static/assets/images/no_themeImage.png')
                        }
                    })
            }
            return () => {
                mounted = false
            }
        }, [theme])

        useEffect(() => {
            if (isBannerInView && theme.path && theme.banner) {
                const src = getEncodedPath(`${theme.path}/${theme.banner}`)
                fetch(src)
                    .then((r) => {
                        if (r.ok) setBannerSrc(src)
                    })
                    .catch(() => {
                        setBannerSrc('static/assets/images/no_themeBackground.png')
                    })
            }
        }, [isBannerInView, theme])

        const handleClick = () => {
            navigate(`/extensionbeta/${theme.name}`, { state: { theme } })
        }

        const isTheme = theme.type === 'theme'
        const checkMarkColorClass = isTheme
            ? cardStyles.card__checkMarkTheme
            : cardStyles.card__checkMarkScript

        const typeBadgeClass = isTheme
            ? cardStyles.card__typeBadgeTheme
            : cardStyles.card__typeBadgeScript

        return (
            <div
                ref={cardRef}
                className={`${className || ''} ${cardStyles.card}`}
                onClick={handleClick}
                style={style}
            >
                {isChecked && (
                    <div
                        className={`${cardStyles.card__checkMark} ${checkMarkColorClass}`}
                    >
                        <MdCheckCircle size={18} />
                    </div>
                )}

                {missingFields.length > 0 && (
                    <>
                        <div
                            className={cardStyles.card__warnBox}
                            onMouseEnter={() => setShowWarnInfo(true)}
                            onMouseLeave={() => setShowWarnInfo(false)}
                        >
                            <MdWarningAmber size={18} />
                        </div>
                        {showWarnInfo && (
                            <div className={cardStyles.card__warnTooltip}>
                                <strong>Исправьте ошибки в metadata.json</strong>
                                <ul>
                                    {missingFields.map((field) => (
                                        <li key={field}>{field}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}

                <div
                    className={cardStyles.card__infoIcon}
                    onMouseEnter={() => setShowUserInfo(true)}
                    onMouseLeave={() => setShowUserInfo(false)}
                >
                    <MdInfoOutline size={20} />
                </div>

                {showUserInfo && (
                    <div
                        className={cardStyles.card__infoTooltip}
                        onMouseEnter={() => setShowUserInfo(true)}
                        onMouseLeave={() => setShowUserInfo(false)}
                    >
                        <p>
                            <strong>Тип:</strong> {isTheme ? 'Тема' : 'Скрипт'}
                        </p>
                        <p>
                            <strong>Автор:</strong> {theme.author}
                        </p>
                    </div>
                )}

                <div
                    ref={bannerRef}
                    className={`${cardStyles.card__banner} ${cardStyles.card__ratio169}`}
                    style={{
                        backgroundImage: `url(${bannerSrc})`,
                        backgroundSize: 'cover',
                    }}
                />

                <div className={cardStyles.card__bottom}>
                    <div className={cardStyles.card__bottomLeft}>
                        <img
                            className={cardStyles.card__themeImage}
                            src={imageSrc}
                            alt="Addon"
                            loading="lazy"
                        />
                        <span className={cardStyles.card__addonTitle}>
                            {theme.name} v{theme.version}
                        </span>
                    </div>
                    <div className={cardStyles.card__divider} />
                    <div className={cardStyles.card__bottomRight}>
                        <span
                            className={`${cardStyles.card__typeBadge} ${typeBadgeClass}`}
                        >
                            {isTheme ? (
                                <>
                                    <MdColorLens size={13} /> Тема
                                </>
                            ) : (
                                <>
                                    <MdTextSnippet size={13} /> Скрипт
                                </>
                            )}
                        </span>
                        <span className={cardStyles.card__location}>
                            {`local • ${theme.lastModified}`}
                        </span>
                    </div>
                </div>
            </div>
        )
    },
)

export default ExtensionCard
