import React from 'react'
import * as Sentry from '@sentry/electron/renderer'
import * as styles from './errorBoundary.module.scss'
import toast from '../toast'

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
        window.desktopEvents?.send('log-error', {
            type: 'react-error-boundary',
            message: error.message,
            stack: error.stack,
            componentStack: errorInfo.componentStack,
        })
        Sentry.captureException(error)
    }
    copyToClipboard = (text: string) => {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                toast.custom(
                    'success',
                    'Успешно!',
                    'Содержание ошибки скопировано в буфер обмена',
                )
            })
            .catch((err) => {
                toast.custom(
                    'error',
                    'Ой...',
                    'Произошла ошибка при попытке записи в буфер обмена',
                )
                console.error('Failed to copy stack trace: ', err)
            })
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className={styles.errorBoundary}>
                    <h1>Так, погоди-ка... Что-то здесь не так...</h1>
                    <p>{this.state.error?.message || 'An unknown error occurred'}</p>
                    <pre
                        onClick={() =>
                            this.copyToClipboard(
                                this.state.error?.stack ||
                                    'No stack trace available',
                            )
                        }
                    >
                        {this.state.error?.stack || 'No stack trace available'}
                    </pre>
                </div>
            )
        }

        return this.props.children
    }
}

export default ErrorBoundary
