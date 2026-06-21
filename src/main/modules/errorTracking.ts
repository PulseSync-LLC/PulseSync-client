import * as Sentry from '@sentry/electron/main'

import {
    addErrorTrackingDebugIds,
    addErrorTrackingRuntimeTags,
    ERROR_TRACKING_BUILD_TAGS,
    ERROR_TRACKING_DSN,
    ERROR_TRACKING_ENABLED,
    ERROR_TRACKING_ENVIRONMENT,
    ERROR_TRACKING_RELEASE,
    sanitizeErrorTrackingEvent,
} from '@common/errorTracking'
import logger from './logger'

let initialized = false

export const initMainErrorTracking = (): void => {
    if (!ERROR_TRACKING_ENABLED || initialized) return

    try {
        Sentry.init({
            dsn: ERROR_TRACKING_DSN,
            release: ERROR_TRACKING_RELEASE,
            environment: ERROR_TRACKING_ENVIRONMENT,
            sendDefaultPii: false,
            maxBreadcrumbs: 0,
            tracesSampleRate: 0,
            attachScreenshot: false,
            includeLocalVariables: false,
            integrations: defaults =>
                defaults.filter(
                    integration =>
                        !['OnUncaughtException', 'OnUnhandledRejection', 'PreloadInjection', 'MainProcessSession'].includes(integration.name),
                ),
            beforeSend: event => {
                event.platform = 'javascript'
                return addErrorTrackingDebugIds(addErrorTrackingRuntimeTags(sanitizeErrorTrackingEvent(event)))
            },
        })
        Sentry.setTags({
            ...ERROR_TRACKING_BUILD_TAGS,
            process: 'main',
            platform: process.platform,
            architecture: process.arch,
        })
        initialized = true
    } catch (error) {
        logger.main.warn('Failed to initialize error tracking:', error)
    }
}

export const captureMainException = (error: unknown, source: string): void => {
    if (!initialized) return
    try {
        Sentry.withScope(scope => {
            scope.setTag('source', source)
            Sentry.captureException(error instanceof Error ? error : new Error(String(error)))
        })
    } catch (captureError) {
        logger.main.warn('Failed to capture error:', captureError)
    }
}

export const captureRendererTermination = (details: Electron.RenderProcessGoneDetails): void => {
    if (!initialized) return
    try {
        Sentry.withScope(scope => {
            scope.setTags({
                source: 'render_process_gone',
                reason: details.reason,
                exitCode: String(details.exitCode),
            })
            Sentry.captureMessage('Electron renderer process terminated', 'error')
        })
    } catch (captureError) {
        logger.main.warn('Failed to capture renderer termination:', captureError)
    }
}

export const flushErrorTracking = async (timeout = 1500): Promise<void> => {
    if (!initialized) return
    try {
        await Sentry.flush(timeout)
    } catch (error) {
        logger.main.warn('Failed to flush error tracking:', error)
    }
}
