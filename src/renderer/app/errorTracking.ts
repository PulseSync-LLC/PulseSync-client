import * as Sentry from '@sentry/electron/renderer'

import {
    addErrorTrackingDebugIds,
    addErrorTrackingRuntimeTags,
    ERROR_TRACKING_BUILD_TAGS,
    ERROR_TRACKING_ENABLED,
    ERROR_TRACKING_ENVIRONMENT,
    ERROR_TRACKING_RELEASE,
    sanitizeErrorTrackingEvent,
} from '@common/errorTracking'

let initialized = false

export const initRendererErrorTracking = (): void => {
    if (!ERROR_TRACKING_ENABLED || initialized) return

    try {
        Sentry.init({
            release: ERROR_TRACKING_RELEASE,
            environment: ERROR_TRACKING_ENVIRONMENT,
            sendDefaultPii: false,
            maxBreadcrumbs: 0,
            tracesSampleRate: 0,
            beforeSend: event => addErrorTrackingDebugIds(addErrorTrackingRuntimeTags(sanitizeErrorTrackingEvent(event))),
        })
        Sentry.setTags({
            ...ERROR_TRACKING_BUILD_TAGS,
            process: 'renderer',
            platform: navigator.platform || 'unknown',
        })
        initialized = true
    } catch (error) {
        console.warn('Failed to initialize error tracking:', error)
    }
}

export const captureRendererException = (error: unknown, source: string): void => {
    if (!initialized) return
    try {
        Sentry.withScope(scope => {
            scope.setTag('source', source)
            Sentry.captureException(error instanceof Error ? error : new Error(String(error)))
        })
    } catch (captureError) {
        console.warn('Failed to capture renderer error:', captureError)
    }
}
