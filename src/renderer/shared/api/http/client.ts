import axios from 'axios'
import config from '@common/appConfig'
import { createHttpClient } from '@common/http/createHttpClient'
import type { HttpResponse, HttpResponseType, PreparedHttpRequest } from '@common/http/types'
import getUserToken from '@shared/lib/auth/getUserToken'

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).flatMap(([key, value]) => {
            if (value == null) {
                return []
            }

            if (Array.isArray(value)) {
                return [[key, value.join(', ')]]
            }

            return [[key, String(value)]]
        }),
    )
}

function resolveAxiosResponseType(responseType: HttpResponseType = 'json'): 'arraybuffer' | 'blob' | 'json' | 'text' {
    switch (responseType) {
        case 'arrayBuffer':
            return 'arraybuffer'
        case 'blob':
            return 'blob'
        case 'text':
            return 'text'
        default:
            return 'json'
    }
}

async function axiosTransport<TResponse = unknown>(request: PreparedHttpRequest): Promise<HttpResponse<TResponse>> {
    const response = await axios.request<TResponse>({
        url: request.url,
        method: request.method,
        data: request.body,
        headers: request.headers,
        timeout: request.timeoutMs,
        responseType: resolveAxiosResponseType(request.responseType),
        validateStatus: () => true,
        onUploadProgress: request.onUploadProgress
            ? progressEvent => {
                  request.onUploadProgress?.({
                      loaded: progressEvent.loaded,
                      total: progressEvent.total ?? undefined,
                  })
              }
            : undefined,
    })

    return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        data: response.data,
        headers: normalizeHeaders(response.headers as Record<string, unknown>),
    }
}

const rendererHttpClient = createHttpClient({
    baseUrl: config.SERVER_URL,
    defaultHeaders: {
        Accept: 'application/json',
    },
    getAuthToken: getUserToken,
    transport: axiosTransport,
})

export default rendererHttpClient
