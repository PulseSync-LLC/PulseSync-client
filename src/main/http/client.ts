import config from '@common/appConfig'
import { createHttpClient } from '@common/http/createHttpClient'
import type { HttpResponse, HttpResponseType, PreparedHttpRequest } from '@common/http/types'

function headersToRecord(headers: Headers): Record<string, string> {
    return Object.fromEntries(headers.entries())
}

async function parseResponseBody<TResponse>(response: Response, responseType: HttpResponseType = 'json'): Promise<TResponse> {
    if (responseType === 'arrayBuffer') {
        return (await response.arrayBuffer()) as TResponse
    }

    if (responseType === 'blob') {
        return (await response.blob()) as TResponse
    }

    if (responseType === 'text') {
        return (await response.text()) as TResponse
    }

    const text = await response.text()
    if (!text) {
        return null as TResponse
    }

    return JSON.parse(text) as TResponse
}

async function fetchTransport<TResponse = unknown>(request: PreparedHttpRequest): Promise<HttpResponse<TResponse>> {
    const controller = new AbortController()
    const timeoutId =
        typeof request.timeoutMs === 'number' && request.timeoutMs > 0 ? setTimeout(() => controller.abort(), request.timeoutMs) : null

    try {
        const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: controller.signal,
        })

        return {
            ok: response.ok,
            status: response.status,
            data: await parseResponseBody<TResponse>(response, request.responseType),
            headers: headersToRecord(response.headers),
        }
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId)
        }
    }
}

const mainHttpClient = createHttpClient({
    baseUrl: config.SERVER_URL,
    defaultHeaders: {
        Accept: 'application/json',
    },
    transport: fetchTransport,
})

export default mainHttpClient
