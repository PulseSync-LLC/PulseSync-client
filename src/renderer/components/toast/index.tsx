import React, { JSX, useEffect, useState } from 'react'
import toast, { Renderable, ToastOptions, Toast } from 'react-hot-toast'
import * as styles from './toast.module.scss'

import Check from './../../../../static/assets/toast/check.svg'
import ImportExport from './../../../../static/assets/toast/importExport.svg'
import Warning from './../../../../static/assets/toast/warning.svg'
import Download from './../../../../static/assets/toast/download.svg'
import Error from './../../../../static/assets/toast/error.svg'
import Info from './../../../../static/assets/toast/info.svg'
import Loading from './../../../../static/assets/toast/loading.svg'
import Hide from './../../../../static/assets/toast/hide.svg'

const iToast = {
    custom: (customType: string, customTitle: string, message: Renderable, options?: ToastOptions, value?: number, duration: number = 5000) =>
        createToast(customType, customTitle, message, options, value, duration),
}

function createToast(customType: string, customTitle: string, message: Renderable, options?: ToastOptions, value?: number, duration: number = 5000) {
    const isPersistent = ['loading', 'export', 'import', 'download'].includes(customType)

    const toastId = toast.custom(
        (t: Toast) => (
            <ToastComponent
                t={t}
                customType={customType}
                customTitle={customTitle}
                message={message}
                value={value}
                isPersistent={isPersistent}
                duration={isPersistent ? Infinity : duration}
            />
        ),
        {
            ...options,
            duration: isPersistent ? Infinity : duration,
        },
    )

    return toastId
}

const ToastComponent = ({
    t,
    customType,
    customTitle,
    message,
    value,
    isPersistent,
    duration,
}: {
    t: Toast
    customType: string
    customTitle: string
    message: Renderable
    value?: number
    isPersistent: boolean
    duration: number
}) => {
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        const showTimer = setTimeout(() => setIsVisible(true), 100)

        return () => {
            clearTimeout(showTimer)
        }
    }, [])

    useEffect(() => {
        if (!isPersistent && !t.visible) {
            setIsVisible(false)
        }
    }, [t.visible, isPersistent])

    const handleDismiss = () => {
        setIsVisible(false)
        setTimeout(() => {
            toast.dismiss(t.id)
        }, 500)
    }

    useEffect(() => {
        if (isPersistent && value === 100) {
            setTimeout(() => handleDismiss(), 500)
        }
    }, [value, isPersistent])

    return (
        <div
            className={`${styles.toast} ${isVisible ? styles.toastVisible : styles.toastHidden} ${styles[customType || 'default']}`}
            style={
                {
                    '--colorToast': getColor(customType),
                } as React.CSSProperties
            }
        >
            <div className={styles.iconContainer}>
                {isPersistent ? <ProgressCircle value={value} customType={customType} /> : getIcon(customType)}
            </div>
            <div className={styles.textContainer}>
                <div className={styles.title}>{customTitle || 'Без заголовка'}</div>
                <div className={styles.message}>{message}</div>
            </div>
            {(isPersistent || customType === 'error' || customType === 'info') && (
                <div className={styles.buttonContainer}>
                    <button className={styles.dismissButton} onClick={handleDismiss}>
                        <Hide height={24} width={24} />
                    </button>
                </div>
            )}
        </div>
    )
}

const ProgressCircle = ({ value, customType }: { value?: number; customType?: string }) => (
    <div className={styles.progressCircle}>
        <svg viewBox="0 0 36 36" className={styles.circularProgress}>
            <path
                className={styles.circleBg}
                d="M18 2.0845
                    a 15.9155 15.9155 0 0 1 0 31.831
                    a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
                className={styles.circle}
                strokeDasharray={`${value || 0}, 100`}
                d="M18 2.0845
                    a 15.9155 15.9155 0 0 1 0 31.831
                    a 15.9155 15.9155 0 0 1 0 -31.831"
            />
        </svg>
        <span className={styles.progressText}>{getIcon(customType)}</span>
    </div>
)

const getColor = (type: string): string => {
    const typeColors: Record<string, string> = {
        success: '#87FF77',
        error: '#FF7777',
        warning: '#FFEF77',
        info: '#77FFC9',
        download: '#87FF77',
        loading: '#FFEF77',
        export: '#77F1FF',
        import: '#77F1FF',
        default: '#87FF77',
    }
    return typeColors[type] || typeColors.default
}

const getIcon = (type: string) => {
    const icons: Record<string, JSX.Element> = {
        success: <Check height={24} width={24} />,
        error: <Error height={24} width={24} />,
        info: <Info height={24} width={24} />,
        warning: <Warning height={24} width={24} />,
        download: <Download height={24} width={24} />,
        loading: <Loading height={24} width={24} />,
        export: <ImportExport height={24} width={24} />,
        import: <ImportExport height={24} width={24} />,
    }
    return icons[type] || icons.info
}

export default iToast
