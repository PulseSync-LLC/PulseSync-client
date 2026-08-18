import * as Sentry from '@sentry/electron/main'

import {
    addErrorTrackingDebugIds,
    addErrorTrackingRuntimeTags,
    ERROR_TRACKING_BUILD_TAGS,
    ERROR_TRACKING_DIST,
    ERROR_TRACKING_DSN,
    ERROR_TRACKING_ENABLED,
    ERROR_TRACKING_ENVIRONMENT,
    sanitizeErrorTrackingEvent,
} from '@common/errorTracking'
import { getDesktopErrorTrackingRelease } from '@common/errorTrackingRelease'

import logger from './logger'

const INITIALIZED_KEY = Symbol.for('pulsesync.errorTracking.initialized')
const errorTrackingRuntime = globalThis as typeof globalThis & { [INITIALIZED_KEY]?: boolean }
type MainErrorTrackingIdentity = { version: string; commit: string }

let currentIdentity: MainErrorTrackingIdentity = {
    version: PULSESYNC_VERSION,
    commit: PULSESYNC_BRANCH || 'unknown',
}

const isInitialized = (): boolean => errorTrackingRuntime[INITIALIZED_KEY] === true

const applyMainErrorTrackingIdentity = (identity: MainErrorTrackingIdentity): void => {
    currentIdentity = identity
    if (!isInitialized()) return

    Sentry.setTags({
        ...ERROR_TRACKING_BUILD_TAGS,
        'desktop.commit': identity.commit,
        'desktop.version': identity.version,
        process: 'main',
        platform: process.platform,
        architecture: process.arch,
    })
}

export const initMainErrorTracking = (identity: MainErrorTrackingIdentity): void => {
    if (!ERROR_TRACKING_ENABLED) return

    currentIdentity = identity
    if (isInitialized()) {
        applyMainErrorTrackingIdentity(identity)
        return
    }

    try {
        Sentry.init({
            dsn: ERROR_TRACKING_DSN,
            release: getDesktopErrorTrackingRelease(identity.version, identity.commit),
            dist: ERROR_TRACKING_DIST,
            environment: ERROR_TRACKING_ENVIRONMENT,
            dataCollection: {
                userInfo: false,
            },
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
                event.release = getDesktopErrorTrackingRelease(currentIdentity.version, currentIdentity.commit)
                return addErrorTrackingDebugIds(addErrorTrackingRuntimeTags(sanitizeErrorTrackingEvent(event)))
            },
        })
        errorTrackingRuntime[INITIALIZED_KEY] = true
        applyMainErrorTrackingIdentity(identity)
    } catch (error) {
        logger.main.warn('Failed to initialize error tracking:', error)
    }
}

export const setMainErrorTrackingUser = (user?: { id?: string | null; email?: string | null } | null): void => {
    if (!isInitialized()) return
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

export const captureMainException = (error: unknown, source: string): void => {
    if (!isInitialized()) return
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
    if (!isInitialized()) return
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
    if (!isInitialized()) return
    try {
        await Sentry.flush(timeout)
    } catch (error) {
        logger.main.warn('Failed to flush error tracking:', error)
    }
}
