import type { WebHostAddonValidationResult } from './webHostAddonValidation'

export const SUPPORTED_WEB_HOST_API_VERSION = 1
export const MAX_ADDON_ARCHIVE_BYTES = 100 * 1024 * 1024

export type AddonValidationOutcome = { ok: true; apiVersion: number } | Extract<WebHostAddonValidationResult, { ok: false }>

export type AddonWorkerRequest =
    | { operation: 'validate'; content: string }
    | { operation: 'sanitize'; content: string }
    | { operation: 'extract'; archivePath: string; stagingDir: string }

export type AddonWorkerResult =
    | { operation: 'validate'; validation: AddonValidationOutcome }
    | { operation: 'sanitize'; blocked: boolean }
    | { operation: 'extract'; packageHash: string }

export type AddonWorkerRequestMessage = { id: number; request: AddonWorkerRequest }
export type AddonWorkerResponseMessage = { id: number } & (
    | { ok: true; result: AddonWorkerResult }
    | { ok: false; message: string; invalidArchive: boolean }
)
