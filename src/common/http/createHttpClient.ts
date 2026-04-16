import type { HttpQueryParams, HttpRequestOptions, HttpResponse, HttpTransport } from './types'

type CreateHttpClientOptions = {
    baseUrl?: string
    defaultHeaders?: Record<string, string>
    getAuthToken?: () => string | null | undefined
    transport: HttpTransport
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
    const normalizedName = name.toLowerCase()
    return Object.keys(headers).some(headerName => headerName.toLowerCase() === normalizedName)
}

function isFormData(body: unknown): body is FormData {
    return typeof FormData !== 'undefined' && body instanceof FormData
}

function isBlob(body: unknown): body is Blob {
    return typeof Blob !== 'undefined' && body instanceof Blob
}

function isArrayBuffer(body: unknown): body is ArrayBuffer {
    return typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer
}

function isUrlSearchParams(body: unknown): body is URLSearchParams {
    return typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams
}

function isJsonBody(body: unknown): body is Record<string, unknown> | unknown[] {
    if (body == null) {
        return false
    }

    if (typeof body === 'string' || isFormData(body) || isBlob(body) || isArrayBuffer(body) || isUrlSearchParams(body)) {
        return false
    }

    return typeof body === 'object'
}

function appendQueryParams(url: URL, query?: HttpQueryParams): void {
    if (!query) {
        return
    }

    for (const [key, rawValue] of Object.entries(query)) {
        if (Array.isArray(rawValue)) {
            for (const item of rawValue) {
                if (item == null) {
                    continue
                }

                url.searchParams.append(key, String(item))
            }
            continue
        }

        if (rawValue == null) {
            continue
        }

        url.searchParams.set(key, String(rawValue))
    }
}

function buildRequestUrl(baseUrl: string | undefined, url: string, query?: HttpQueryParams): string {
    const targetUrl = /^https?:\/\//.test(url) ? new URL(url) : baseUrl ? new URL(url, baseUrl) : null

    if (!targetUrl) {
        throw new Error(`Relative URL "${url}" requires a baseUrl`)
    }

    appendQueryParams(targetUrl, query)
    return targetUrl.toString()
}

export function createHttpClient({ baseUrl, defaultHeaders, getAuthToken, transport }: CreateHttpClientOptions) {
    async function request<TResponse = unknown>(options: HttpRequestOptions): Promise<HttpResponse<TResponse>> {
        const headers: Record<string, string> = {
            ...(defaultHeaders || {}),
            ...(options.headers || {}),
        }

        const authToken = options.authToken ?? (options.auth ? getAuthToken?.() : null)
        if (authToken && !hasHeader(headers, 'Authorization')) {
            headers.Authorization = `Bearer ${authToken}`
        }

        let body: BodyInit | string | undefined

        if (typeof options.body === 'string' || isFormData(options.body) || isBlob(options.body) || isArrayBuffer(options.body) || isUrlSearchParams(options.body)) {
            body = options.body
        } else if (isJsonBody(options.body)) {
            body = JSON.stringify(options.body)
            if (!hasHeader(headers, 'Content-Type')) {
                headers['Content-Type'] = 'application/json'
            }
        }

        return transport<TResponse>({
            ...options,
            method: options.method || 'GET',
            url: buildRequestUrl(baseUrl, options.url, options.query),
            headers,
            body,
        })
    }

    return {
        request,
        get: <TResponse = unknown>(url: string, options?: Omit<HttpRequestOptions, 'url' | 'method'>) =>
            request<TResponse>({ ...options, url, method: 'GET' }),
        post: <TResponse = unknown>(url: string, options?: Omit<HttpRequestOptions, 'url' | 'method'>) =>
            request<TResponse>({ ...options, url, method: 'POST' }),
        put: <TResponse = unknown>(url: string, options?: Omit<HttpRequestOptions, 'url' | 'method'>) =>
            request<TResponse>({ ...options, url, method: 'PUT' }),
        patch: <TResponse = unknown>(url: string, options?: Omit<HttpRequestOptions, 'url' | 'method'>) =>
            request<TResponse>({ ...options, url, method: 'PATCH' }),
        delete: <TResponse = unknown>(url: string, options?: Omit<HttpRequestOptions, 'url' | 'method'>) =>
            request<TResponse>({ ...options, url, method: 'DELETE' }),
    }
}
