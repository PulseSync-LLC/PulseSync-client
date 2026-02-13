import React from 'react'
import * as styles from './errorBoundary.module.scss'
import toast from '../toast'
import MainEvents from '../../../common/types/mainEvents'
import { t } from '../../i18n'

interface ErrorBoundaryProps {
    children: React.ReactNode
}

class ErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    {
        hasError: boolean
        error: Error
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
        window.desktopEvents?.send(MainEvents.LOG_ERROR, {
            type: 'react-error-boundary',
            message: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack,
        })
    }
    copyToClipboard = (text: string) => {
        navigator.clipboard
            .writeText(text)
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
