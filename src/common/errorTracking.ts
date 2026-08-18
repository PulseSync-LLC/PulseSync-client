import { branch } from './appConfig'

export const ERROR_TRACKING_DSN = 'https://f8abbc9ce46c42989b72758349a3a245@ru-node-1.pulsesync.dev/events/1'
export const ERROR_TRACKING_ENABLED = import.meta.env.PROD
export const ERROR_TRACKING_ENVIRONMENT = import.meta.env.PROD ? branch : 'development'
export const ERROR_TRACKING_DIST = PULSESYNC_DIST

export const ERROR_TRACKING_BUILD_TAGS = {
    channel: ERROR_TRACKING_ENVIRONMENT,
    commit: PULSESYNC_BRANCH || 'unknown',
    dist: ERROR_TRACKING_DIST || 'unknown',
}

type ErrorTrackingEvent = {
    message?: string
    tags?: Record<string, unknown>
    user?: unknown
    request?: unknown
    breadcrumbs?: unknown
    extra?: unknown
    contexts?: Record<string, unknown>
    transaction?: string
    debug_meta?: {
        images?: Array<{
            type?: string
            code_file?: string
            debug_id?: string
        }>
    }
    logentry?: {
        message?: string
        formatted?: string
    }
    exception?: {
        values?: Array<{
            value?: string
            stacktrace?: {
                frames?: Array<{
                    filename?: string
                    abs_path?: string
                }>
            }
        }>
    }
}

const getContextString = (context: unknown, key: string): string | undefined => {
    if (!context || typeof context !== 'object') return undefined
    const value = (context as Record<string, unknown>)[key]
    return typeof value === 'string' && value ? value : undefined
}

export const addErrorTrackingRuntimeTags = <T extends ErrorTrackingEvent>(event: T): T => {
    const contexts = event.contexts
    if (!contexts) return event

    const runtimeName = getContextString(contexts.runtime, 'name')
    const runtimeVersion = getContextString(contexts.runtime, 'version')
    const chromeVersion = getContextString(contexts.chrome, 'version')
    const nodeVersion = getContextString(contexts.node, 'version')
    const appVersion = getContextString(contexts.app, 'app_version')
    const runtimeTags: Record<string, string> = {}

    if (chromeVersion && contexts.browser && typeof contexts.browser === 'object') {
        contexts.browser = { ...(contexts.browser as Record<string, unknown>), version: chromeVersion }
    }

    if (runtimeName?.toLowerCase() === 'electron' && runtimeVersion) runtimeTags['electron.version'] = runtimeVersion
    if (chromeVersion) runtimeTags['chrome.version'] = chromeVersion
    if (nodeVersion) runtimeTags['node.version'] = nodeVersion
    if (appVersion) runtimeTags['app.version'] = appVersion

    if (Object.keys(runtimeTags).length > 0) event.tags = { ...event.tags, ...runtimeTags }
    return event
}

const normalizeBundlePath = (value: string): string =>
    value
        .replace(/\\/g, '/')
        .replace(/^file:\/\//u, '')
        .toLowerCase()

const comparableBundlePath = (value: string): string => {
    const normalized = normalizeBundlePath(value)
    const viteIndex = normalized.indexOf('/.vite/')
    return viteIndex >= 0 ? normalized.slice(viteIndex) : normalized
}

const canonicalBundlePath = (value: string): string => {
    const comparablePath = comparableBundlePath(value)
    return comparablePath.startsWith('/.vite/') ? `app://${comparablePath}` : value
}

const extractBundlePathFromStackLine = (line: string): string | undefined => {
    const location = line.match(/\((.+):\d+:\d+\)$/u)?.[1] ?? line.match(/\bat\s+(.+):\d+:\d+$/u)?.[1]
    return location && /\.(?:cjs|mjs|js)$/u.test(location) ? location : undefined
}

export const addErrorTrackingDebugIds = <T extends ErrorTrackingEvent>(event: T): T => {
    const debugIds = (globalThis as typeof globalThis & { _sentryDebugIds?: Record<string, string> })._sentryDebugIds
    if (!debugIds) {
        if (event.debug_meta?.images?.some(image => image.type === 'sourcemap')) {
            event.debug_meta.images = event.debug_meta.images.map(image =>
                image.type === 'sourcemap' && image.code_file ? { ...image, code_file: canonicalBundlePath(image.code_file) } : image,
            )
        }
        return event
    }
    const debugIdValues = [...new Set(Object.values(debugIds).filter(Boolean))]
    const singleDebugId = debugIdValues.length === 1 ? debugIdValues[0] : undefined

    const mappings = Object.entries(debugIds).flatMap(([stack, debugId]) => {
        const codeFile = stack
            .split('\n')
            .slice(1)
            .map(extractBundlePathFromStackLine)
            .find((value): value is string => Boolean(value))
        return codeFile ? [{ codeFile: canonicalBundlePath(codeFile), comparablePath: comparableBundlePath(codeFile), debugId }] : []
    })
    if (event.debug_meta?.images?.some(image => image.type === 'sourcemap')) {
        event.debug_meta.images = event.debug_meta.images.map(image =>
            image.type === 'sourcemap' && image.code_file ? { ...image, code_file: canonicalBundlePath(image.code_file) } : image,
        )
    }

    const images = event.debug_meta?.images ?? []
    for (const exception of event.exception?.values ?? []) {
        for (const frame of exception.stacktrace?.frames ?? []) {
            const codeFile = frame.abs_path ?? frame.filename
            if (!codeFile) continue

            const comparablePath = comparableBundlePath(codeFile)
            const mapping = mappings.find(candidate => candidate.comparablePath === comparablePath)
            const image =
                mapping ??
                (singleDebugId && comparablePath.startsWith('/.vite/')
                    ? { codeFile: canonicalBundlePath(codeFile), debugId: singleDebugId }
                    : undefined)
            if (!image || images.some(existingImage => existingImage.code_file === image.codeFile && existingImage.debug_id === image.debugId))
                continue

            images.push({
                type: 'sourcemap',
                code_file: image.codeFile,
                debug_id: image.debugId,
            })
        }
    }

    if (images.length > 0) {
        event.debug_meta = { ...event.debug_meta, images }
    }
    return event
}

const stripUrlDetails = (value: string): string =>
    value.replace(/https?:\/\/[^\s)\]}]+/g, rawUrl => {
        try {
            const url = new URL(rawUrl)
            url.search = ''
            url.hash = ''
            return url.toString()
        } catch {
            return rawUrl
        }
    })

const redactSensitiveText = (value: string): string =>
    stripUrlDetails(value)
        .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [Filtered]')
        .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, '[Filtered JWT]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[Filtered Email]')
        .replace(/\b(authorization|password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[Filtered]')

const redactUserPath = (value: string): string =>
    value.replace(/([A-Z]:\\Users\\)[^\\]+/gi, '$1[Filtered]').replace(/(\/(?:home|Users)\/)[^/]+/g, '$1[Filtered]')

export const sanitizeErrorTrackingEvent = <T extends ErrorTrackingEvent>(event: T): T => {
    if (event.message) event.message = redactSensitiveText(event.message)
    if (event.logentry?.message) event.logentry.message = redactSensitiveText(event.logentry.message)
    if (event.logentry?.formatted) event.logentry.formatted = redactSensitiveText(event.logentry.formatted)
    for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = redactSensitiveText(exception.value)
        for (const frame of exception.stacktrace?.frames ?? []) {
            if (frame.filename) frame.filename = redactUserPath(frame.filename)
            if (frame.abs_path) frame.abs_path = redactUserPath(frame.abs_path)
        }
    }

    return event
}
