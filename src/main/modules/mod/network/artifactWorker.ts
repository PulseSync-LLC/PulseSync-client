import { parentPort, threadId, workerData } from 'node:worker_threads'

import { type NativeArtifactDurations, type NativeArtifactResult, requirePulseSyncNative } from '../../nativeModules/pulsesyncNative'

import type {
    ArtifactWorkerFailure,
    ArtifactWorkerRequest,
    ArtifactWorkerRequestMessage,
    ArtifactWorkerResponse,
    ArtifactWorkerResponseMessage,
    ArtifactWorkerStage,
    ArtifactWorkerWarning,
    HashArtifactRequest,
    InstallUnpackedArtifactRequest,
    PrepareAsarArtifactRequest,
} from './artifactWorker.types'

const durationFields: Array<[keyof NativeArtifactDurations, string]> = [
    ['readMs', 'read'],
    ['checksumMs', 'checksum'],
    ['decompressMs', 'decompress'],
    ['writeMs', 'write'],
    ['cloneMs', 'clone'],
    ['extractMs', 'extract'],
    ['cacheWriteMs', 'cacheWrite'],
    ['backupMs', 'backup'],
    ['installMs', 'install'],
    ['cleanupMs', 'cleanup'],
]

function mapDurations(durations: NativeArtifactDurations): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [nativeName, workerName] of durationFields) {
        const value = durations[nativeName]
        if (value > 0) result[workerName] = value
    }
    return result
}

function mapWarnings(result: NativeArtifactResult): ArtifactWorkerWarning[] {
    return result.warnings.map(warning => ({
        stage: warning.stage === 'cache' ? 'cache' : 'cleanup',
        code: warning.code,
        message: warning.message,
    }))
}

function mapFailure(result: NativeArtifactResult, fallbackStage: ArtifactWorkerStage): ArtifactWorkerFailure {
    return {
        ok: false,
        stage: (result.stage as ArtifactWorkerStage | undefined) ?? fallbackStage,
        code: result.code,
        message: result.message ?? 'Native artifact operation failed',
    }
}

async function prepareAsarArtifact(request: PrepareAsarArtifactRequest): Promise<ArtifactWorkerResponse> {
    const result = requirePulseSyncNative().prepareAsarArtifact({
        archivePath: request.archivePath,
        archiveExtension: request.archiveExtension,
        expectedChecksum: request.expectedChecksum,
        outputPath: request.outputPath,
    })
    if (!result.ok) return mapFailure(result, 'write')
    return {
        ok: true,
        mode: 'prepareAsar',
        durations: mapDurations(result.durations),
        preparedPath: result.preparedPath ?? request.outputPath,
        warnings: mapWarnings(result),
    }
}

async function installUnpackedArtifact(request: InstallUnpackedArtifactRequest): Promise<ArtifactWorkerResponse> {
    const result = requirePulseSyncNative().installUnpackedArtifact({
        sourceKind: request.sourceKind ?? 'archive',
        archivePath: request.archivePath,
        archiveExtension: request.archiveExtension,
        expectedChecksum: request.expectedChecksum,
        preparedDirectoryPath: request.preparedDirectoryPath,
        preparedDirectoryMarker: request.preparedDirectoryMarker,
        stagingPath: request.stagingPath,
        targetPath: request.targetPath,
    })
    if (!result.ok) return mapFailure(result, 'install')
    return {
        ok: true,
        mode: 'installUnpacked',
        durations: mapDurations(result.durations),
        warnings: mapWarnings(result),
    }
}

async function hashArtifact(request: HashArtifactRequest): Promise<ArtifactWorkerResponse> {
    const startedAt = Date.now()
    try {
        return {
            ok: true,
            mode: 'hashFile',
            checksum: requirePulseSyncNative().hashFile(request.filePath),
            durations: { checksum: Date.now() - startedAt },
            warnings: [],
        }
    } catch (error: any) {
        return {
            ok: false,
            stage: 'checksum',
            code: typeof error?.code === 'string' ? error.code : undefined,
            message: error instanceof Error ? error.message : String(error),
        }
    }
}

async function processArtifact(request: ArtifactWorkerRequest): Promise<ArtifactWorkerResponse> {
    if (request.mode === 'prepareAsar') return await prepareAsarArtifact(request)
    if (request.mode === 'hashFile') return await hashArtifact(request)
    return await installUnpackedArtifact(request)
}

async function processArtifactSafely(request: ArtifactWorkerRequest): Promise<ArtifactWorkerResponse> {
    try {
        return await processArtifact(request)
    } catch (error: any) {
        return {
            ok: false,
            stage: request.mode === 'hashFile' ? 'checksum' : 'install',
            code: typeof error?.code === 'string' ? error.code : undefined,
            message: error instanceof Error ? error.message : String(error),
        }
    }
}

if (workerData !== undefined) {
    void processArtifactSafely(workerData as ArtifactWorkerRequest).then(response => parentPort?.postMessage(response))
} else {
    let requestQueue = Promise.resolve()
    parentPort?.on('message', (message: ArtifactWorkerRequestMessage) => {
        requestQueue = requestQueue.then(async () => {
            const response = await processArtifactSafely(message.request)
            const responseMessage: ArtifactWorkerResponseMessage = {
                id: message.id,
                response,
                workerThreadId: threadId,
            }
            parentPort?.postMessage(responseMessage)
        })
    })
}
