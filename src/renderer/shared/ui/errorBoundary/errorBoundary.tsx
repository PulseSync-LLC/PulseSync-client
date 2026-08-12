import React from 'react'
import * as styles from '@shared/ui/errorBoundary/errorBoundary.module.scss'
import toast from '@shared/ui/toast'
import { t } from '@app/i18n'
import { desktopApi } from '@shared/desktop/desktopApi'

interface ErrorBoundaryProps {
    children: React.ReactNode
}

class ErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    {
        hasError: boolean
        error: Error | null
    }
> {
    constructor(props: ErrorBoundaryProps) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        desktopApi.logs.reactError({
            type: 'react-error-boundary',
            message: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack,
        })
    }
    copyToClipboard = (text: string) => {
        desktopApi.system
            .writeClipboardText(text)
            .then(() => {
                toast.custom('success', t('common.successTitle'), t('errors.copiedToClipboard'))
            })
            .catch(err => {
                toast.custom('error', t('common.oopsTitle'), t('errors.copyFailed'))
                console.error(t('errors.copyStackFailed'), err)
            })
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className={styles.errorBoundary}>
                    <h1>{t('errors.title')}</h1>
                    <p>{this.state.error?.message || t('errors.unknownError')}</p>
                    <pre onClick={() => this.copyToClipboard(this.state.error?.stack || t('errors.noStackTrace'))}>
                        {this.state.error?.stack || t('errors.noStackTrace')}
                    </pre>
                </div>
            )
        }

        return this.props.children
    }
}

export default ErrorBoundary
