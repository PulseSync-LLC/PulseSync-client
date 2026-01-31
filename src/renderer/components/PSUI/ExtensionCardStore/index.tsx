import React, { useState, useCallback } from 'react'
import * as st from './card.module.scss'
import { t } from '../../../i18n'

type ExtensionTheme = 'purple' | 'red' | 'wave'
type ExtensionCardSize = 'default' | 'large'
type ExtensionStatus = 'active' | 'deprecated'
type ExtensionType = 'css' | 'js' | 'both'
type ButtonState = 'initial' | 'downloading' | 'installing' | 'installed'

export interface ExtensionCardStoreProps {
    title: string
    subtitle: string
    version: string
    authors: string[]
    downloads?: string
    theme?: ExtensionTheme
    size?: ExtensionCardSize
    iconImage?: string
    backgroundImage?: string
    className?: string
    status?: ExtensionStatus
    type?: ExtensionType
    onDownloadClick?: () => void
    onAuthorsClick?: () => void
    isPreInstalled?: boolean
}

const DownloadIcon = () => (
    <svg className={st.download_icon} width={20} height={20} viewBox="0 0 16 16" aria-hidden="true">
        <path
            d="M8 1.5C8.41421 1.5 8.75 1.83579 8.75 2.25V8.378L10.9586 6.16935C11.2515 5.87645 11.7263 5.87645 12.0192 6.16935C12.3121 6.46225 12.3121 6.93712 12.0192 7.23L8.53033 10.7189C8.23744 11.0118 7.76256 11.0118 7.46967 10.7189L3.98076 7.23C3.68787 6.93712 3.68787 6.46225 3.98076 6.16935C4.27365 5.87645 4.74853 5.87645 5.04142 6.16935L7.25 8.378V2.25C7.25 1.83579 7.58579 1.5 8 1.5Z"
            fill="currentColor"
        />
        <path
            d="M3 11.75C2.58579 11.75 2.25 12.0858 2.25 12.5C2.25 12.9142 2.58579 13.25 3 13.25H13C13.4142 13.25 13.75 12.9142 13.75 12.5C13.75 12.0858 13.4142 11.75 13 11.75H3Z"
            fill="currentColor"
        />
    </svg>
)

const CheckIcon = () => (
    <svg className={st.download_icon} width={20} height={20} viewBox="0 0 16 16" aria-hidden="true">
        <path
            d="M12.7803 4.21967C13.0732 4.51256 13.0732 4.98744 12.7803 5.28033L7.28033 10.7803C6.98744 11.0732 6.51256 11.0732 6.21967 10.7803L3.21967 7.78033C2.92678 7.48744 2.92678 7.01256 3.21967 6.71967C3.51256 6.42678 3.98744 6.42678 4.28033 6.71967L6.75 9.18934L11.7197 4.21967C12.0126 3.92678 12.4874 3.92678 12.7803 4.21967Z"
            fill="currentColor"
        />
    </svg>
)

const SpinnerIcon = () => (
    <svg className={[st.download_icon, st.spinner].join(' ')} width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className={st.spinner_circle_bg} />
        {}
        <path
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0112 4.417v3.013a5 5 0 00-4 4.883H6v2.981z"
            className={st.spinner_path}
            fill="currentColor"
        />
    </svg>
)

const StatusBadge: React.FC<{ status: ExtensionStatus }> = ({ status }) => {
    const text = status === 'active' ? t('store.status.active') : t('store.status.deprecated')
    const className = status === 'active' ? st.badge_active : st.badge_deprecated
    return <div className={[st.card_badge, className].join(' ')}>{text}</div>
}

const TypeBadge: React.FC<{ type: ExtensionType }> = ({ type }) => {
    let text = ''
    let typeClass = ''
    switch (type) {
        case 'css':
            text = t('store.type.css')
            typeClass = st.badge_css
            break
        case 'js':
            text = t('store.type.js')
            typeClass = st.badge_js
            break
        case 'both':
            text = t('store.type.both')
            typeClass = st.badge_both
            break
        default:
            return null
    }
    return <div className={[st.card_badge, typeClass].join(' ')}>{text}</div>
}

const ExtensionIcon: React.FC<{ imageSrc?: string }> = ({ imageSrc }) => (
    <div className={st.card_icon}>
        {imageSrc ? <img src={imageSrc} alt="Icon" className={st.card_icon_image} /> : <div className={st.card_icon_placeholder} />}
    </div>
)

const ExtensionCardStore: React.FC<ExtensionCardStoreProps> = props => {
    const {
        title,
        subtitle,
        version,
        authors,
        downloads,
        theme = 'purple',
        size = 'default',
        iconImage,
        backgroundImage,
        className,
        status,
        type,
        onAuthorsClick,
        isPreInstalled = false,
    } = props

    const [buttonState, setButtonState] = useState<ButtonState>(isPreInstalled ? 'installed' : 'initial')
    const [progress, setProgress] = useState<number>(0)

    const handleDownloadClick = useCallback(() => {
        if (buttonState !== 'initial') return

        console.log(t('store.logs.downloadStart', { title }))

        setButtonState('downloading')
        setProgress(0)

        let downloadInterval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(downloadInterval)
                    return 100
                }
                return Math.min(100, prev + Math.floor(Math.random() * 15) + 5)
            })
        }, 200)

        setTimeout(() => {
            clearInterval(downloadInterval)
            setButtonState('installing')
            console.log(t('store.logs.downloadComplete'))

            setTimeout(() => {
                setButtonState('installed')
                console.log(t('store.logs.installComplete', { title }))

                if (props.onDownloadClick) {
                    props.onDownloadClick()
                }
            }, 1500)
        }, 2500)
    }, [buttonState, title, props])

    let buttonText
    let buttonIcon
    let buttonClass = st.download_button

    switch (buttonState) {
        case 'initial':
            buttonText = t('store.download')
            buttonIcon = <DownloadIcon />
            break
        case 'downloading':
            buttonText = `${Math.floor(progress)}%`
            buttonIcon = <SpinnerIcon />
            buttonClass = [st.download_button, st.button_downloading].join(' ')
            break
        case 'installing':
            buttonIcon = <SpinnerIcon />
            buttonClass = [st.download_button, st.button_installing].join(' ')
            break
        case 'installed':
            buttonIcon = <CheckIcon />
            buttonClass = [st.download_button, st.button_installed].join(' ')
            break
    }

    const themeClass = theme === 'red' ? st.card_theme_red : theme === 'wave' ? st.card_theme_wave : st.card_theme_purple

    const sizeClass = size === 'large' ? st.card_large : ''

    const rootClassName = [st.card, backgroundImage ? st.card_with_image_bg : themeClass, sizeClass, className ? className : '']
        .filter(Boolean)
        .join(' ')

    const handleAuthorsClick = () => {
        if (onAuthorsClick) {
            onAuthorsClick()
        }
    }

    const backgroundStyle = backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : {}

    return (
        <article className={rootClassName} style={backgroundStyle}>
            {backgroundImage && <div className={st.card_overlay} />}

            {}
            <div className={st.card_header_badges}>
                {status && <StatusBadge status={status} />}
                {type && <TypeBadge type={type} />}
            </div>

            <div className={st.card_main}>
                <div className={st.card_icon_wrapper}>
                    <ExtensionIcon imageSrc={iconImage} />
                </div>

                <div className={st.card_text}>
                    <h3 className={st.card_title}>{title}</h3>
                    <p className={st.card_subtitle}>{subtitle}</p>

                    <div className={st.card_meta}>
                        <span className={st.card_version}>{version}</span>
                        <span className={st.card_dot} />
                        <button type="button" className={st.card_authors} onClick={handleAuthorsClick}>
                            By&nbsp;
                            {authors.join(', ')}
                        </button>
                    </div>
                </div>
            </div>

            {}
            <button type="button" className={buttonClass} onClick={handleDownloadClick}>
                {}
                {buttonState === 'downloading' && <div className={st.download_progress_bar} style={{ width: `${progress}%` }} />}

                {}
                <span className={st.download_content}>
                    {buttonIcon}
                    <span className={st.download_count}>
                        {buttonText === t('store.download') ? downloads || t('common.notAvailable') : buttonText}
                    </span>
                </span>
            </button>
        </article>
    )
}

export default ExtensionCardStore
