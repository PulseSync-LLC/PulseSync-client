export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type HttpQueryPrimitive = string | number | boolean | null | undefined

export type HttpQueryParams = Record<string, HttpQueryPrimitive | HttpQueryPrimitive[]>

export type HttpResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer'

export type HttpUploadProgress = {
    loaded: number
    total?: number
}

export type HttpRequestOptions = {
    url: string
    method?: HttpMethod
    query?: HttpQueryParams
    headers?: Record<string, string>
    body?: unknown
    auth?: boolean
    authToken?: string | null
    responseType?: HttpResponseType
    timeoutMs?: number
    onUploadProgress?: (progress: HttpUploadProgress) => void
}

export type PreparedHttpRequest = Omit<HttpRequestOptions, 'url' | 'body'> & {
    url: string
    body?: BodyInit | string
    headers: Record<string, string>
}

export type HttpResponse<TResponse = unknown> = {
    ok: boolean
    status: number
    data: TResponse
    headers: Record<string, string>
}

export type HttpTransport = <TResponse = unknown>(request: PreparedHttpRequest) => Promise<HttpResponse<TResponse>>
