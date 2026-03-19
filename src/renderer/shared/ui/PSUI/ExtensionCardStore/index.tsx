import React from 'react'
import cn from 'clsx'
import * as st from '@shared/ui/PSUI/ExtensionCardStore/card.module.scss'
import { t } from '@app/i18n'

type ExtensionTheme = 'purple' | 'red' | 'wave'
type ExtensionCardSize = 'default' | 'large'
type ExtensionStatus = 'accepted' | 'active' | 'deprecated' | 'pending' | 'rejected'
type ExtensionType = 'css' | 'js' | 'both'

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
    onAuthorClick?: (author: string) => void
    downloadLabel?: string
    downloadDisabled?: boolean
    downloadInstalled?: boolean
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

const InstalledIcon = () => (
    <svg className={st.download_icon} width={20} height={20} viewBox="0 0 16 16" aria-hidden="true">
        <path
            d="M12.7803 4.21967C13.0732 4.51256 13.0732 4.98744 12.7803 5.28033L7.28033 10.7803C6.98744 11.0732 6.51256 11.0732 6.21967 10.7803L3.21967 7.78033C2.92678 7.48744 2.92678 7.01256 3.21967 6.71967C3.51256 6.42678 3.98744 6.42678 4.28033 6.71967L6.75 9.18934L11.7197 4.21967C12.0126 3.92678 12.4874 3.92678 12.7803 4.21967Z"
            fill="currentColor"
        />
    </svg>
)

const StatusBadge: React.FC<{ status: ExtensionStatus }> = ({ status }) => {
    const normalized = status === 'active' ? 'accepted' : status
    const text =
        normalized === 'accepted'
            ? t('store.status.accepted')
            : normalized === 'pending'
              ? t('store.status.pending')
              : normalized === 'rejected'
                ? t('store.status.rejected')
                : t('store.status.deprecated')
    const className =
        normalized === 'accepted'
            ? st.badge_active
            : normalized === 'pending'
              ? st.badge_pending
              : normalized === 'rejected'
                ? st.badge_rejected
                : st.badge_deprecated
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

const ExtensionCardStore: React.FC<ExtensionCardStoreProps> = ({
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
    onAuthorClick,
    onDownloadClick,
    downloadLabel,
    downloadDisabled = false,
    downloadInstalled = false,
}) => {
    const themeClass = theme === 'red' ? st.card_theme_red : theme === 'wave' ? st.card_theme_wave : st.card_theme_purple
    const sizeClass = size === 'large' ? st.card_large : ''
    const rootClassName = [st.card, backgroundImage ? st.card_with_image_bg : themeClass, sizeClass, className ? className : '']
        .filter(Boolean)
        .join(' ')

    const backgroundStyle = backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : {}

    return (
        <article className={rootClassName} style={backgroundStyle}>
            {backgroundImage && <div className={st.card_overlay} />}

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
                        <span className={st.card_authors}>
                            <span className={st.card_authors_label}>Авторы:</span>
                            {authors.map(author => (
                                <span key={author} className={st.card_author_item}>
                                    <button type="button" className={st.card_author_link} onClick={() => onAuthorClick?.(author)}>
                                        {author}
                                    </button>
                                </span>
                            ))}
                        </span>
                    </div>

                    {downloads ? <div className={st.card_downloads}>{downloads}</div> : null}
                </div>
            </div>

            <button
                type="button"
                className={cn(st.download_button, downloadInstalled && st.download_button_installed)}
                onClick={onDownloadClick}
                disabled={downloadDisabled}
            >
                <span className={st.download_content}>
                    {downloadInstalled ? <InstalledIcon /> : <DownloadIcon />}
                    <span className={st.download_count}>{downloadLabel || t('store.download')}</span>
                </span>
            </button>
        </article>
    )
}

export default ExtensionCardStore
