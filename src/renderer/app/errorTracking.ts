import * as Sentry from '@sentry/electron/renderer'

import {
    addErrorTrackingDebugIds,
    addErrorTrackingRuntimeTags,
    ERROR_TRACKING_BUILD_TAGS,
    ERROR_TRACKING_DIST,
    ERROR_TRACKING_ENABLED,
    ERROR_TRACKING_ENVIRONMENT,
    sanitizeErrorTrackingEvent,
} from '@common/errorTracking'
import { getRendererErrorTrackingRelease } from '@common/errorTrackingRelease'

let initialized = false

export const initRendererErrorTracking = (): void => {
    if (!ERROR_TRACKING_ENABLED || initialized) return

    try {
        Sentry.init({
            release: getRendererErrorTrackingRelease(PULSESYNC_RENDERER_BUILD_NUMBER),
            dist: ERROR_TRACKING_DIST,
            environment: ERROR_TRACKING_ENVIRONMENT,
            dataCollection: {
                userInfo: false,
            },
            maxBreadcrumbs: 0,
            tracesSampleRate: 0,
            beforeSend: event => addErrorTrackingDebugIds(addErrorTrackingRuntimeTags(sanitizeErrorTrackingEvent(event))),
        })
        Sentry.setTags({
            ...ERROR_TRACKING_BUILD_TAGS,
            process: 'renderer',
            'renderer.build_number': PULSESYNC_RENDERER_BUILD_NUMBER,
            platform: navigator.platform || 'unknown',
        })
        initialized = true
    } catch (error) {
        console.warn('Failed to initialize error tracking:', error)
    }
}

export const setRendererErrorTrackingUser = (user?: { id?: string | null; email?: string | null } | null): void => {
    if (!initialized) return
    const id = user?.id?.trim()
    if (!id || id === '-1') {
        Sentry.setUser(null)
        return
    }

    const email = user?.email?.trim()
    Sentry.setUser({
        id,
        ...(email ? { email } : {}),
    })
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
