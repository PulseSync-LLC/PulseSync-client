const PROD_REMOTE_RENDERER_ORIGINS = new Set(['https://app.pulsesync.dev', 'https://pulsesync.dev'])
const DEV_REMOTE_RENDERER_ORIGINS = new Set(['http://localhost:3100', 'http://127.0.0.1:3100'])
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'yandexmusic:'])

const PROD_CONNECT_SOURCES = ['https:', 'wss:', 'data:']
const DEV_CONNECT_SOURCES = ['http://localhost:3100', 'http://127.0.0.1:3100', 'ws://localhost:3100', 'ws://127.0.0.1:3100']

export function shouldAllowDevRemoteRenderer(isDevMode: boolean, isDevMarkedBuild: boolean): boolean {
    return isDevMode || isDevMarkedBuild || process.env.PULSESYNC_ALLOW_LOCAL_REMOTE_RENDERER === '1'
}

export function getRemoteRendererAllowedOrigins(isDevMode: boolean): Set<string> {
    return new Set([...PROD_REMOTE_RENDERER_ORIGINS, ...(isDevMode ? DEV_REMOTE_RENDERER_ORIGINS : [])])
}

export function getUrlOrigin(rawUrl: string): string | null {
    try {
        return new URL(rawUrl).origin
    } catch {
        return null
    }
}

export function isAllowedRemoteRendererUrl(rawUrl: string, isDevMode: boolean): boolean {
    try {
        const url = new URL(rawUrl)
        if (url.protocol !== 'https:' && !(isDevMode && url.protocol === 'http:')) {
            return false
        }
        return getRemoteRendererAllowedOrigins(isDevMode).has(url.origin)
    } catch {
        return false
    }
}

export function isAllowedRemoteRendererNavigation(rawUrl: string, activeRemoteOrigin: string): boolean {
    try {
        const url = new URL(rawUrl)
        return url.origin === activeRemoteOrigin
    } catch {
        return false
    }
}

export function isAllowedRemoteRendererWindowOpen(rawUrl: string, activeRemoteOrigin: string): boolean {
    try {
        const url = new URL(rawUrl)
        if (url.origin === activeRemoteOrigin) {
            return true
        }
        return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)
    } catch {
        return false
    }
}

export function getRemoteRendererUrlPattern(activeRemoteOrigin: string): string {
    const url = new URL(activeRemoteOrigin)
    return `${url.protocol}//${url.host}/*`
}

export function buildRemoteRendererContentSecurityPolicy(isDevMode: boolean): string {
    const scriptSources = ["'self'", ...(isDevMode ? ["'unsafe-eval'", "'unsafe-inline'"] : [])]
    const connectSources = ["'self'", ...PROD_CONNECT_SOURCES, ...(isDevMode ? DEV_CONNECT_SOURCES : [])]

    return [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        `script-src ${scriptSources.join(' ')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "media-src 'self' data: blob: https:",
        `connect-src ${connectSources.join(' ')}`,
    ].join('; ')
}
