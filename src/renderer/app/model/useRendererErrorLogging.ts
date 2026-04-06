import { useEffect, useRef } from 'react'

import MainEvents from '@common/types/mainEvents'

export function useRendererErrorLogging() {
    const rendererLoggingInitialized = useRef(false)

    useEffect(() => {
        if (rendererLoggingInitialized.current) return
        rendererLoggingInitialized.current = true
        if (typeof window === 'undefined') return

        const sendRendererError = (text: string) => {
            window.desktopEvents?.send(MainEvents.RENDERER_LOG, { error: true, text })
        }

        const formatLogValue = (value: any) => {
            if (value instanceof Error) {
                const stack = value.stack ? `\n${value.stack}` : ''
                return `${value.name}: ${value.message}${stack}`
            }
            if (typeof value === 'string') return value
            try {
                return JSON.stringify(value)
            } catch {
                return String(value)
            }
        }

        const formatLogArgs = (args: any[]) => args.map(formatLogValue).join(' ')

        const originalConsoleError = console.error.bind(console)
        let isLoggingConsoleError = false
        console.error = (...args: any[]) => {
            if (!isLoggingConsoleError) {
                isLoggingConsoleError = true
                try {
                    sendRendererError(formatLogArgs(args))
                } catch (err) {
                    originalConsoleError('[Logger Error]', err)
                } finally {
                    isLoggingConsoleError = false
                }
            }
            originalConsoleError(...args)
        }

        const originalFetch = window.fetch?.bind(window)
        if (originalFetch) {
            window.fetch = (async (...args: Parameters<typeof fetch>) => {
                const [input] = args
                const url =
                    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : 'unknown'

                try {
                    const response = await originalFetch(...args)
                    if (!response.ok) {
                        sendRendererError(`Fetch error: ${response.status} ${response.statusText} (${url})`)
                    }
                    return response
                } catch (error) {
                    sendRendererError(`Fetch exception: ${url} - ${formatLogValue(error)}`)
                    throw error
                }
            }) as typeof window.fetch
        }

        const onError = (event: ErrorEvent) => {
            const detail = event.error ? ` - ${formatLogValue(event.error)}` : ''
            sendRendererError(`Unhandled error: ${event.message}${detail}`)
        }

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            sendRendererError(`Unhandled rejection: ${formatLogValue(event.reason)}`)
        }

        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onUnhandledRejection)

        return () => {
            console.error = originalConsoleError
            if (originalFetch) {
                window.fetch = originalFetch
            }
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onUnhandledRejection)
        }
    }, [])
}
