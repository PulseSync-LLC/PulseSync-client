import React, { useEffect, useRef, useState } from 'react'
import cn from 'clsx'
import { MdDeleteForever } from 'react-icons/md'
import * as st from '@shared/ui/PSUI/ExtensionCardStore/card.module.scss'
import { t } from '@app/i18n'

type ExtensionTheme = 'purple' | 'red' | 'wave'
type ExtensionCardSize = 'default' | 'large'
type ExtensionStatus = 'accepted' | 'active' | 'deprecated' | 'pending' | 'rejected'
type ExtensionType = 'css' | 'js' | 'both'
type DownloadVariant = 'default' | 'installed' | 'remove'
type AddonKind = 'theme' | 'script'

export interface ExtensionCardStoreProps {
    title: string
    subtitle: string
    version: string
    authors: string[]
    downloads?: string
    topRightMeta?: string
    theme?: ExtensionTheme
    size?: ExtensionCardSize
    iconImage?: string
    backgroundImage?: string
    className?: string
    status?: ExtensionStatus
    type?: ExtensionType
    kind?: AddonKind
    onDownloadClick?: () => void
    onAuthorClick?: (author: string) => void
    downloadLabel?: string
    downloadDisabled?: boolean
    downloadInstalled?: boolean
    downloadVariant?: DownloadVariant
    isPreInstalled?: boolean
    animationsEnabledRef?: React.MutableRefObject<boolean>
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

const CompactDownloadIcon = () => (
    <svg className={st.header_meta_icon} width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
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

const KindBadge: React.FC<{ kind: AddonKind }> = ({ kind }) => {
    const text = kind === 'script' ? t('store.kind.script') : t('store.kind.theme')
    const className = kind === 'script' ? st.badge_script : st.badge_theme
    return <div className={[st.card_badge, className].join(' ')}>{text}</div>
}

const ReleaseStatusBadge: React.FC<{ status: ExtensionStatus }> = ({ status }) => {
    const text = t(`store.status.${status}`)
    const className =
        status === 'pending'
            ? st.badge_pending
            : status === 'rejected'
              ? st.badge_rejected
              : status === 'deprecated'
                ? st.badge_deprecated
                : st.badge_active

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

type VisibilityState = {
    isIntersecting: boolean
    shouldAnimate: boolean
}

const useIntersectionObserver = (
    ref: React.RefObject<HTMLElement | null>,
    animationsEnabledRef?: React.MutableRefObject<boolean>,
    options?: IntersectionObserverInit,
) => {
    const [visibilityState, setVisibilityState] = useState<VisibilityState>({
        isIntersecting: false,
        shouldAnimate: animationsEnabledRef?.current ?? true,
    })

    useEffect(() => {
        if (!ref.current) return

        const observer = new IntersectionObserver(
            ([entry]) => {
                setVisibilityState(prevState => {
                    if (entry.isIntersecting) {
                        const nextState = {
                            isIntersecting: true,
                            shouldAnimate: animationsEnabledRef?.current ?? true,
                        }

                        if (
                            prevState.isIntersecting === nextState.isIntersecting &&
                            prevState.shouldAnimate === nextState.shouldAnimate
                        ) {
                            return prevState
                        }

                        return nextState
                    }

                    if (!prevState.isIntersecting) return prevState

                    return {
                        ...prevState,
                        isIntersecting: false,
                    }
                })
            },
            {
                ...options,
                rootMargin: '50%',
            },
        )

        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [animationsEnabledRef, ref, options])

    return visibilityState
}

const ExtensionCardStore: React.FC<ExtensionCardStoreProps> = ({
    title,
    subtitle,
    version,
    authors,
    downloads,
    topRightMeta,
    theme = 'purple',
    size = 'default',
    iconImage,
    backgroundImage,
    className,
    status,
    type,
    kind,
    onAuthorClick,
    onDownloadClick,
    downloadLabel,
    downloadDisabled = false,
    downloadInstalled = false,
    downloadVariant = 'default',
    animationsEnabledRef,
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const visibilityState = useIntersectionObserver(containerRef, animationsEnabledRef, { threshold: 0.1 })
    const themeClass = theme === 'red' ? st.card_theme_red : theme === 'wave' ? st.card_theme_wave : st.card_theme_purple
    const sizeClass = size === 'large' ? st.card_large : ''
    const rootClassName = [st.card, backgroundImage ? st.card_with_image_bg : themeClass, sizeClass, className ? className : '']
        .filter(Boolean)
        .join(' ')

    const backgroundStyle = backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : {}

    return (
        <div ref={containerRef} className={st.card_mount} aria-hidden={!visibilityState.isIntersecting}>
            {visibilityState.isIntersecting ? (
                <article className={cn(rootClassName, !visibilityState.shouldAnimate && st.softFadeIn)} style={backgroundStyle}>
                    {backgroundImage && <div className={st.card_overlay} />}

                    <div className={st.card_header_row}>
                        <div className={st.card_header_badges}>
                            {status && <ReleaseStatusBadge status={status} />}
                            {kind && <KindBadge kind={kind} />}
                            {type && <TypeBadge type={type} />}
                        </div>
                        {topRightMeta ? (
                            <div className={st.card_header_meta}>
                                <CompactDownloadIcon />
                                <span>{topRightMeta}</span>
                            </div>
                        ) : null}
                    </div>

                    <div className={st.card_content}>
                        <div className={st.card_title_row}>
                            <h3 className={st.card_title}>{title}</h3>
                            <span className={st.card_title_version}>{version}</span>
                        </div>

                        <div className={st.card_main}>
                            <div className={st.card_icon_wrapper}>
                                <ExtensionIcon imageSrc={iconImage} />
                            </div>

                            <div className={st.card_text}>
                                <p className={st.card_subtitle}>{subtitle}</p>

                                <div className={st.card_meta}>
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
                    </div>

                    <button
                        type="button"
                        className={cn(
                            st.download_button,
                            downloadInstalled && st.download_button_installed,
                            downloadVariant === 'remove' && st.download_button_remove,
                        )}
                        onClick={onDownloadClick}
                        disabled={downloadDisabled}
                    >
                        <span className={st.download_content}>
                            {downloadVariant === 'remove' ? (
                                <MdDeleteForever className={st.download_icon} size={20} />
                            ) : downloadInstalled ? (
                                <InstalledIcon />
                            ) : (
                                <DownloadIcon />
                            )}
                            <span className={st.download_count}>{downloadLabel || t('store.download')}</span>
                        </span>
                    </button>
                </article>
            ) : null}
        </div>
    )
}

export default ExtensionCardStore
