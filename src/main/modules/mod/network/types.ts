export type ReplaceStage = 'move' | 'copy'

export type ReplaceDirFailure = { ok: false; error: any; stage: ReplaceStage }
export type ReplaceDirResult = { ok: true } | ReplaceDirFailure

export type RetryStageFailure = { success: false; error: any; recoverable: boolean }
export type RetryStageResult = { success: true } | RetryStageFailure

export type DownloadProgress = { base?: number; scale?: number; resetOnComplete?: boolean }

export type ModCompatibilityResult = {
    success: boolean
    message?: string
    code?: string
    url?: string
    requiredVersion?: string
    recommendedVersion?: string
}
