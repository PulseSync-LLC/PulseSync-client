export type DownloadProgress = { base?: number; scale?: number; resetOnComplete?: boolean }

export type ModDownloadFailure = {
    error: string
    type: string
}
