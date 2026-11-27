import { Readable } from 'node:stream'

import { app, net, type Session, session } from 'electron'

import axios, { type AxiosAdapter, AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'

import logger from '../../shared/logger'

import type { ReadableStream } from 'node:stream/web'

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
    data: Readable
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

    throw new AxiosError(
        `Request failed with status code ${status}`,
        status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        response as any,
    )
}

async function requestBuffer(options: ElectronRequestOptions): Promise<ElectronBufferedResponse> {
    const response = await requestStream(options)
    const chunks: Buffer[] = []

    for await (const chunk of response.data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))

    return {
        ...response,
        data: Buffer.concat(chunks),
    }
}

async function requestStream(options: ElectronRequestOptions): Promise<ElectronStreamResponse> {
    const controller = new AbortController()
    const abort = () => controller.abort(new Error('Request aborted'))
    const cleanup = () => options.signal?.removeEventListener?.('abort', abort)
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener?.('abort', abort, { once: true })
    const timeout =
        options.timeoutMs && options.timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('Request timeout')), options.timeoutMs) : undefined

    try {
        const response = await net.fetch(options.url, {
            body: (await bodyToRequestChunk(options.body)) as BodyInit | undefined,
            headers: normalizeHeaders(options.headers ?? {}),
            method: options.method || 'GET',
            redirect: 'follow',
            signal: controller.signal,
        })
        const stream = response.body ? Readable.fromWeb(response.body as ReadableStream<Uint8Array>) : Readable.from([])
        stream.once('end', cleanup)
        stream.once('close', () => {
            cleanup()
            if (!stream.readableEnded) controller.abort()
        })
        const headers: Record<string, string | string[]> = Object.fromEntries(response.headers.entries())
        const cookies = response.headers.getSetCookie()
        if (cookies.length) headers['set-cookie'] = cookies
        return { data: stream, headers, status: response.status, statusText: response.statusText }
    } catch (error) {
        cleanup()
        if (controller.signal.aborted) throw controller.signal.reason
        throw error
    } finally {
        clearTimeout(timeout)
    }
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
            try {
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
            } catch (error) {
                response.data.destroy()
                throw error
            }
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

function electronFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return net.fetch(input instanceof URL ? input.toString() : input, init)
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

    await setSystemProxy(session.defaultSession)

    logger.main.info('System proxy support enabled')
}
