const DEFAULT_ATTEMPTS = 4
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 8_000
const IDEMPOTENT_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PUT'])

export type NetworkRetryOptions = {
    attempts?: number
    baseDelayMs?: number
    label?: string
    maxDelayMs?: number
    retryUnsafe?: boolean
}

const sleep = (delayMs: number): Promise<void> => new Promise(resolve => setTimeout(resolve, delayMs))

const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'

const isTransientStatus = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500

export function isTransientNetworkError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || isAbortError(error)) return false
    const value = error as {
        code?: unknown
        name?: unknown
        message?: unknown
        status?: unknown
        $metadata?: { httpStatusCode?: number }
        cause?: unknown
    }
    const status = value.$metadata?.httpStatusCode ?? value.status
    if (typeof status === 'number' && status >= 400) return isTransientStatus(status)
    if (
        typeof value.code === 'string' &&
        /^(EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/u.test(value.code)
    )
        return true
    if (value.name === 'TimeoutError') return true
    if (
        typeof value.message === 'string' &&
        /(?:connection reset|connection timed out|connect timeout|TLS handshake timeout|i\/o timeout|\bEOF\b|socket hang up|fetch failed)/iu.test(
            value.message,
        )
    )
        return true
    return value.cause !== error && isTransientNetworkError(value.cause)
}

export async function retryNetworkOperation<T>(operation: () => Promise<T>, retryOptions: Omit<NetworkRetryOptions, 'retryUnsafe'> = {}): Promise<T> {
    const options: Required<NetworkRetryOptions> = {
        attempts: retryOptions.attempts ?? DEFAULT_ATTEMPTS,
        baseDelayMs: retryOptions.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
        maxDelayMs: retryOptions.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
        label: retryOptions.label ?? 'Network operation',
        retryUnsafe: false,
    }
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        try {
            return await operation()
        } catch (error) {
            if (!isTransientNetworkError(error) || attempt === options.attempts) throw error
            await waitBeforeRetry(attempt, null, options, error instanceof Error ? error.message : String(error))
        }
    }
    throw new Error(`${options.label} exhausted retry attempts`)
}

const retryAfterMs = (response: Response | null): number | null => {
    const value = response?.headers.get('retry-after')?.trim()
    if (!value) return null

    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000

    const date = Date.parse(value)
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

const backoffMs = (attempt: number, baseDelayMs: number, maxDelayMs: number): number => {
    const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
    return Math.round(exponential * (0.75 + Math.random() * 0.5))
}

const waitBeforeRetry = async (attempt: number, response: Response | null, options: Required<NetworkRetryOptions>, reason: string): Promise<void> => {
    const calculatedDelay = backoffMs(attempt, options.baseDelayMs, options.maxDelayMs)
    const delay = Math.min(options.maxDelayMs, retryAfterMs(response) ?? calculatedDelay)
    console.warn(`[network-retry] ${options.label}: ${reason}; retry ${attempt + 1}/${options.attempts} in ${delay}ms`)
    await sleep(delay)
}

export async function fetchWithRetry(
    input: string | URL | Request,
    init: RequestInit = {},
    retryOptions: NetworkRetryOptions = {},
): Promise<Response> {
    const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const options: Required<NetworkRetryOptions> = {
        attempts: retryOptions.attempts ?? DEFAULT_ATTEMPTS,
        baseDelayMs: retryOptions.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
        label: retryOptions.label ?? `${method} request`,
        maxDelayMs: retryOptions.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
        retryUnsafe: retryOptions.retryUnsafe ?? false,
    }
    const retryAllowed = IDEMPOTENT_METHODS.has(method) || options.retryUnsafe

    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        try {
            const response = await fetch(input, init)
            if (!retryAllowed || !isTransientStatus(response.status) || attempt === options.attempts) return response

            await response.body?.cancel().catch(() => undefined)
            await waitBeforeRetry(attempt, response, options, `HTTP ${response.status}`)
        } catch (error) {
            if (!retryAllowed || isAbortError(error) || attempt === options.attempts) throw error
            await waitBeforeRetry(attempt, null, options, error instanceof Error ? error.message : String(error))
        }
    }

    throw new Error(`${options.label} exhausted retry attempts`)
}
