import React, { CSSProperties, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router'
import useInView from '../../hooks/useInView'
import Addon from '../../api/interfaces/addon.interface'
import { MdCheckCircle, MdColorLens, MdInfo, MdTextSnippet } from 'react-icons/md'
import * as cardStyles from './card.module.scss'
import { useUserProfileModal } from '../../context/UserProfileModalContext'
import config from '../../api/config'

const imageCache = new Map<string, string>()
const bannerCache = new Map<string, string>()

interface ExtensionCardProps {
    addon: Addon
    isChecked: boolean
    onCheckboxChange: (themeName: string, isChecked: boolean) => void
    className?: string
    style?: CSSProperties
}

const ExtensionCard: React.FC<ExtensionCardProps> = React.memo(({ addon, isChecked, onCheckboxChange, className, style }) => {
    const navigate = useNavigate()
    const { openUserProfile } = useUserProfileModal()

    const [imageSrc, setImageSrc] = useState('static/assets/images/no_themeImage.png')
    const [bannerSrc, setBannerSrc] = useState('static/assets/images/no_themeBackground.png')
    const [showUserInfo, setShowUserInfo] = useState(false)
    const cardRef = useRef<HTMLDivElement | null>(null)
    const [bannerRef, isBannerInView] = useInView({ threshold: 0.1 })

    const missingFields = useMemo(() => {
        const missing: string[] = []
        if (!addon.name) missing.push('Отсутствует name')
        if (!addon.author) missing.push('Отсутствует author')
        if (!addon.version) missing.push('Отсутствует version')
        if (!addon.image) missing.push('Отсутствует image')
        if (!addon.banner) missing.push('Отсутствует banner')
        if (!addon.type) missing.push('Неопределенный type! type должен быть либо theme либо script')
        return missing
    }, [addon])

    const getAssetUrl = useCallback(
        (filename: string) => {
            return `http://127.0.0.1:${config.MAIN_PORT}/addon_file?name=${encodeURIComponent(addon.name)}&file=${encodeURIComponent(filename)}`
        },
        [addon.name],
    )

    useEffect(() => {
        if (!addon.image) {
            setImageSrc('static/assets/images/no_themeImage.png')
            return
        }
        const key = `${addon.name}|${addon.image}`
        if (imageCache.has(key)) {
            setImageSrc(imageCache.get(key)!)
            return
        }
        const url = getAssetUrl(addon.image)
        fetch(url)
            .then(r => {
                if (!r.ok) throw new Error('Not found')
                return r.blob()
            })
            .then(blob => {
                const blobUrl = URL.createObjectURL(blob)
                imageCache.set(key, blobUrl)
                setImageSrc(blobUrl)
            })
            .catch(() => {
                setImageSrc('static/assets/images/no_themeImage.png')
            })
    }, [addon.name, addon.image, getAssetUrl])

    useEffect(() => {
        if (!(isBannerInView && addon.banner)) {
            return
        }
        const key = `${addon.name}|${addon.banner}`
        if (bannerCache.has(key)) {
            setBannerSrc(bannerCache.get(key)!)
            return
        }
        const url = getAssetUrl(addon.banner)
        fetch(url)
            .then(r => {
                if (!r.ok) throw new Error('Not found')
                return r.blob()
            })
            .then(blob => {
                const blobUrl = URL.createObjectURL(blob)
                bannerCache.set(key, blobUrl)
                setBannerSrc(blobUrl)
            })
            .catch(() => {
                setBannerSrc('static/assets/images/no_themeBackground.png')
            })
    }, [addon.name, addon.banner, isBannerInView, getAssetUrl])

    const handleCardClick = useCallback(() => {
        navigate(`/extensionbeta/${addon.name}`, { state: { theme: addon } })
    }, [navigate, addon])

    const handleMouseEnter = useCallback(() => setShowUserInfo(true), [])
    const handleMouseLeave = useCallback(() => setShowUserInfo(false), [])

    const isTheme = addon.type === 'theme' || !addon.type
    const checkMarkColorClass = isTheme ? cardStyles.card__checkMarkTheme : cardStyles.card__checkMarkScript
    const typeBadgeClass = isTheme ? cardStyles.card__typeBadgeTheme : cardStyles.card__typeBadgeScript

    const bannerStyle = useMemo(
        () => ({
            backgroundImage: `url(${bannerSrc})`,
            backgroundSize: 'cover',
        }),
        [bannerSrc],
    )

    return (
        <div ref={cardRef} className={`${className || ''} ${cardStyles.card}`} onClick={handleCardClick} style={style}>
            {isChecked && (
                <div className={`${cardStyles.card__checkMark} ${checkMarkColorClass}`}>
                    <MdCheckCircle size={18} />
                </div>
            )}

            {missingFields.length > 0 && (
                <div className={cardStyles.card__warnTooltip}>
                    <strong>Исправьте ошибки в metadata.json</strong>
                    <ul>
                        {missingFields.map(field => (
                            <li key={field}>{field}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className={cardStyles.card__infoIcon} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                <MdInfo size={20} />
            </div>

            {showUserInfo && (
                <div className={cardStyles.card__infoTooltip} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                    <p>
                        <strong>Тип:</strong> {isTheme ? 'Тема' : 'Скрипт'}
                    </p>
                    <p>
                        <strong>Автор:</strong>{' '}
                        {Array.isArray(addon.author) ? (
                            addon.author.map((userName: string, index: number) => (
                                <span
                                    key={userName}
                                    onClick={e => {
                                        e.stopPropagation()
                                        openUserProfile(userName)
                                    }}
                                    style={{ cursor: 'pointer' }}
                                >
                                    {userName}
                                    {index < addon.author.length - 1 && ', '}
                                </span>
                            ))
                        ) : (
                            <span
                                onClick={e => {
                                    e.stopPropagation()
                                    openUserProfile(addon.author as string)
                                }}
                                style={{ cursor: 'pointer' }}
                            >
                                {addon.author}
                            </span>
                        )}
                    </p>
                </div>
            )}

            <div ref={bannerRef} className={`${cardStyles.card__banner} ${cardStyles.card__ratio169}`} style={bannerStyle} />

            <div className={cardStyles.card__bottom}>
                <div className={cardStyles.card__bottomLeft}>
                    <img className={cardStyles.card__themeImage} src={imageSrc} alt="Addon" loading="lazy" />
                    <div className={cardStyles.card__boxTitle}>
                        <span className={cardStyles.card__addonTitle}>
                            {addon.name} v{addon.version}
                        </span>
                    </div>
                </div>
                <div className={cardStyles.card__divider} />
                <div className={cardStyles.card__bottomRight}>
                    <span className={`${cardStyles.card__typeBadge} ${typeBadgeClass}`}>
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
                    <span className={cardStyles.card__location}>{`local • ${addon.lastModified}`}</span>
                </div>
            </div>
        </div>
    )
})

export default ExtensionCard
