import { app, net, session, type Session } from 'electron'
import axios, { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { PassThrough } from 'stream'
import logger from '../logger'

const ELECTRON_UPDATER_SESSION_PARTITION = 'electron-updater'

let axiosAdapterInstalled = false
let fetchInstalled = false
let sessionHandlerInstalled = false

type ElectronRequestOptions = {
    body?: unknown
    headers?: Record<string, string | string[]>
    method?: string
    signal?: RequestSignal | null
    timeoutMs?: number
    url: string
}

type RequestSignal = {
    readonly aborted: boolean
    addEventListener?: (type: 'abort', listener: () => void, options?: { once?: boolean }) => void
    removeEventListener?: (type: 'abort', listener: () => void) => void
}

type ElectronResponseMeta = {
    headers: Record<string, string | string[]>
    status: number
    statusText: string
}

type ElectronBufferedResponse = ElectronResponseMeta & {
    data: Buffer
}

type ElectronStreamResponse = ElectronResponseMeta & {
    data: PassThrough
}

function normalizeHeaders(headers: Record<string, string | string[]>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]))
}

function normalizeAxiosHeaders(config: InternalAxiosRequestConfig): Record<string, string> {
    const rawHeaders = AxiosHeaders.from(config.headers).normalize(false).toJSON()

    return Object.fromEntries(
        Object.entries(rawHeaders).flatMap(([key, value]) => {
            if (value == null) {
                return []
            }

            if (Array.isArray(value)) {
                return [[key, value.map(String).join(', ')]]
            }

            return [[key, String(value)]]
        }),
    )
}

async function bodyToRequestChunk(body: unknown): Promise<string | Buffer | undefined> {
    if (body == null) {
        return undefined
    }

    if (typeof body === 'string' || Buffer.isBuffer(body)) {
        return body
    }

    if (body instanceof URLSearchParams) {
        return body.toString()
    }

    if (body instanceof ArrayBuffer) {
        return Buffer.from(body)
    }

    if (ArrayBuffer.isView(body)) {
        return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
    }

    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return Buffer.from(await body.arrayBuffer())
    }

    if (typeof Response !== 'undefined') {
        return Buffer.from(await new Response(body as BodyInit).arrayBuffer())
    }

    return String(body)
}

function makeNetworkError(error: unknown, config?: InternalAxiosRequestConfig): AxiosError {
    if (error instanceof AxiosError) {
        return error
    }

    if (error instanceof Error) {
        return AxiosError.from(error, AxiosError.ERR_NETWORK, config)
    }

    return new AxiosError(String(error), AxiosError.ERR_NETWORK, config)
}

function makeCanceledError(config?: InternalAxiosRequestConfig): AxiosError {
    return new AxiosError('Request aborted', AxiosError.ERR_CANCELED, config)
}

function makeTimeoutError(config?: InternalAxiosRequestConfig): AxiosError {
    return new AxiosError(`timeout of ${config?.timeout ?? 0}ms exceeded`, AxiosError.ECONNABORTED, config)
}

function rejectForStatus<TResponse>(response: TResponse, status: number, config: InternalAxiosRequestConfig): TResponse {
    const validateStatus = config.validateStatus
    if (!status || !validateStatus || validateStatus(status)) {
        return response
    }

    throw new AxiosError(`Request failed with status code ${status}`, status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, null, response as any)
}

async function requestBuffer(options: ElectronRequestOptions): Promise<ElectronBufferedResponse> {
    const response = await requestStream(options)
    const chunks: Buffer[] = []

    await new Promise<void>((resolve, reject) => {
        response.data.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        response.data.on('end', resolve)
        response.data.on('error', reject)
    })

    return {
        ...response,
        data: Buffer.concat(chunks),
    }
}

async function requestStream(options: ElectronRequestOptions): Promise<ElectronStreamResponse> {
    const requestBody = await bodyToRequestChunk(options.body)

    return await new Promise<ElectronStreamResponse>((resolve, reject) => {
        let completed = false
        let timeoutId: NodeJS.Timeout | null = null

        const request = net.request({
            headers: options.headers,
            method: options.method || 'GET',
            redirect: 'follow',
            session: session.defaultSession,
            url: options.url,
        })

        const fail = (error: unknown) => {
            if (completed) {
                return
            }

            completed = true
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
            reject(error)
        }

        const abort = (error: unknown) => {
            try {
                request.abort()
            } catch {}
            fail(error)
        }

        if (options.signal?.aborted) {
            abort(new Error('Request aborted'))
            return
        }

        const abortListener = () => abort(new Error('Request aborted'))
        options.signal?.addEventListener?.('abort', abortListener, { once: true })

        if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
            timeoutId = setTimeout(() => abort(new Error('Request timeout')), options.timeoutMs)
        }

        request.on('response', response => {
            if (completed) {
                return
            }

            completed = true
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
            options.signal?.removeEventListener?.('abort', abortListener)

            const stream = new PassThrough()
            response.on('data', chunk => stream.write(chunk))
            response.on('end', () => stream.end())
            response.on('aborted', () => stream.destroy(new Error('Response aborted')))
            response.on('error', error => stream.destroy(error))

            resolve({
                data: stream,
                headers: response.headers,
                status: response.statusCode,
                statusText: response.statusMessage,
            })
        })

        request.on('error', error => {
            options.signal?.removeEventListener?.('abort', abortListener)
            fail(error)
        })

        request.on('abort', () => {
            options.signal?.removeEventListener?.('abort', abortListener)
            fail(new Error('Request aborted'))
        })

        if (requestBody == null) {
            request.end()
            return
        }

        request.end(requestBody)
    })
}

function parseResponseData(buffer: Buffer, responseType: InternalAxiosRequestConfig['responseType']): unknown {
    if (responseType === 'arraybuffer') {
        return buffer
    }

    if (responseType === 'blob' && typeof Blob !== 'undefined') {
        return new Blob([bufferToArrayBuffer(buffer)])
    }

    return buffer.toString('utf8')
}

const electronNetAxiosAdapter: AxiosAdapter = async config => {
    try {
        const url = axios.getUri(config)
        const requestOptions: ElectronRequestOptions = {
            body: config.data,
            headers: normalizeAxiosHeaders(config),
            method: config.method?.toUpperCase() || 'GET',
            signal: config.signal,
            timeoutMs: config.timeout,
            url,
        }

        if (config.responseType === 'stream') {
            const response = await requestStream(requestOptions)
            return rejectForStatus(
                {
                    config,
                    data: response.data,
                    headers: normalizeHeaders(response.headers),
                    request: null,
                    status: response.status,
                    statusText: response.statusText,
                },
                response.status,
                config,
            )
        }

        const response = await requestBuffer(requestOptions)
        return rejectForStatus(
            {
                config,
                data: parseResponseData(response.data, config.responseType),
                headers: normalizeHeaders(response.headers),
                request: null,
                status: response.status,
                statusText: response.statusText,
            },
            response.status,
            config,
        )
    } catch (error) {
        if (error instanceof Error && error.message === 'Request aborted') {
            throw makeCanceledError(config)
        }

        if (error instanceof Error && error.message === 'Request timeout') {
            throw makeTimeoutError(config)
        }

        throw makeNetworkError(error, config)
    }
}

function getFetchUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') {
        return input
    }

    if (input instanceof URL) {
        return input.toString()
    }

    return input.url
}

function getFetchMethod(input: RequestInfo | URL, init?: RequestInit): string {
    if (init?.method) {
        return init.method
    }

    if (typeof input === 'object' && 'method' in input) {
        return input.method
    }

    return 'GET'
}

function getFetchSignal(input: RequestInfo | URL, init?: RequestInit): RequestSignal | null {
    if (init?.signal) {
        return init.signal
    }

    if (typeof input === 'object' && 'signal' in input) {
        return input.signal
    }

    return null
}

function appendHeaders(target: Headers, headers?: HeadersInit): void {
    if (!headers) {
        return
    }

    new Headers(headers).forEach((value, key) => target.set(key, value))
}

function getFetchHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> {
    const headers = new Headers()

    if (typeof input === 'object' && 'headers' in input) {
        appendHeaders(headers, input.headers)
    }
    appendHeaders(headers, init?.headers)

    return Object.fromEntries(headers.entries())
}

async function getFetchBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
    if (init?.body != null) {
        return init.body
    }

    if (typeof input === 'object' && 'arrayBuffer' in input && !input.bodyUsed && !['GET', 'HEAD'].includes(input.method.toUpperCase())) {
        return Buffer.from(await input.arrayBuffer())
    }

    return undefined
}

async function electronFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await requestBuffer({
        body: await getFetchBody(input, init),
        headers: getFetchHeaders(input, init),
        method: getFetchMethod(input, init),
        signal: getFetchSignal(input, init),
        url: getFetchUrl(input),
    })

    return new Response(bufferToArrayBuffer(response.data), {
        headers: normalizeHeaders(response.headers),
        status: response.status,
        statusText: response.statusText,
    })
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function installAxiosAdapter(): void {
    if (axiosAdapterInstalled) {
        return
    }

    axios.defaults.adapter = electronNetAxiosAdapter
    axiosAdapterInstalled = true
}

function installFetch(): void {
    if (fetchInstalled) {
        return
    }

    globalThis.fetch = electronFetch
    fetchInstalled = true
}

async function setSystemProxy(targetSession: Session): Promise<void> {
    await targetSession.setProxy({ mode: 'system' })
}

function installSessionHandler(): void {
    if (sessionHandlerInstalled) {
        return
    }

    app.on('session-created', targetSession => {
        void setSystemProxy(targetSession).catch(error => {
            logger.main.warn('Failed to apply system proxy to created session:', error)
        })
    })
    sessionHandlerInstalled = true
}

export async function enableSystemProxySupport(): Promise<void> {
    installAxiosAdapter()
    installFetch()
    installSessionHandler()

    await Promise.all([
        setSystemProxy(session.defaultSession),
        setSystemProxy(
            session.fromPartition(ELECTRON_UPDATER_SESSION_PARTITION, {
                cache: false,
            }),
        ),
    ])

    logger.main.info('System proxy support enabled')
}
