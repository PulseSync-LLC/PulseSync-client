import * as fs from 'original-fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as zlib from 'node:zlib'
import { parentPort, threadId, workerData } from 'node:worker_threads'
import AdmZip from 'adm-zip'
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

const RECOVERABLE_CODES = new Set(['EXDEV', 'EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EEXIST'])
const FILE_HASH_BUFFER_SIZE = 1024 * 1024

async function decompressZstdStable(buffer: Buffer): Promise<Buffer> {
    const { ZstdCodec } = await import('zstd-codec')

    return new Promise((resolve, reject) => {
        try {
            ZstdCodec.run((zstd: any) => {
                try {
                    const decompressed = new zstd.Streaming().decompress(buffer)
                    if (!decompressed) throw new Error('Failed to decompress zstd archive')
                    resolve(Buffer.from(decompressed))
                } catch (error) {
                    reject(error)
                }
            })
        } catch (error) {
            reject(error)
        }
    })
}

function decompressZstdNative(buffer: Buffer): Buffer {
    return zlib.zstdDecompressSync(buffer)
}

type ArchivePreparationRequest = {
    archivePath: string
    archiveExtension: string
    expectedChecksum?: string
}

class StageError extends Error {
    constructor(
        public readonly stage: ArtifactWorkerStage,
        cause: unknown,
    ) {
        super(cause instanceof Error ? cause.message : String(cause), { cause })
    }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function runStage<T>(stage: ArtifactWorkerStage, operation: () => T | Promise<T>): Promise<T> {
    try {
        return await operation()
    } catch (error) {
        throw new StageError(stage, error)
    }
}

async function retryFilesystemOperation(operation: () => void): Promise<void> {
    const maxAttempts = process.platform === 'win32' ? 6 : 2
    let lastError: any

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            operation()
            return
        } catch (error: any) {
            lastError = error
            if (!RECOVERABLE_CODES.has(error?.code) || attempt === maxAttempts) break
            await sleep(150 * attempt)
        }
    }

    throw lastError
}

function isZipBuffer(buffer: Buffer): boolean {
    return (
        buffer.length >= 4 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06) || (buffer[2] === 0x07 && buffer[3] === 0x08))
    )
}

function resolveExtractedRoot(stagingPath: string, targetPath: string): string {
    const entries = fs.readdirSync(stagingPath, { withFileTypes: true }).filter(entry => entry.name !== '__MACOSX' && entry.name !== '.DS_Store')
    if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].name !== path.basename(targetPath)) return stagingPath
    return path.join(stagingPath, entries[0].name)
}

async function readAndPrepareArchive(
    request: ArchivePreparationRequest,
    durations: Record<string, number>,
    zstdDecoder: 'native' | 'stable',
): Promise<Buffer> {
    const measure = async <T>(name: string, operation: () => Promise<T> | T): Promise<T> => {
        const startedAt = Date.now()
        try {
            return await operation()
        } finally {
            durations[name] = Date.now() - startedAt
        }
    }

    const archive = await measure('read', () => runStage('read', () => fs.readFileSync(request.archivePath)))

    if (request.expectedChecksum) {
        await measure('checksum', () =>
            runStage('checksum', () => {
                const actualChecksum = crypto.createHash('sha256').update(archive).digest('hex')
                if (actualChecksum !== request.expectedChecksum) {
                    const error: NodeJS.ErrnoException = new Error('Archive checksum mismatch')
                    error.code = 'CHECKSUM_MISMATCH'
                    throw error
                }
            }),
        )
    }

    return await measure('decompress', () =>
        runStage('decompress', async () => {
            if (request.archiveExtension === '.gz') return zlib.gunzipSync(archive)
            if (request.archiveExtension === '.zst' || request.archiveExtension === '.zstd') {
                if (zstdDecoder === 'native') return decompressZstdNative(archive)

                try {
                    return await decompressZstdStable(archive)
                } catch {
                    return decompressZstdNative(archive)
                }
            }
            return archive
        }),
    )
}

async function prepareAsarArtifact(request: PrepareAsarArtifactRequest): Promise<ArtifactWorkerResponse> {
    const durations: Record<string, number> = {}
    const warnings: ArtifactWorkerWarning[] = []
    const measure = async <T>(name: string, operation: () => Promise<T> | T): Promise<T> => {
        const startedAt = Date.now()
        try {
            return await operation()
        } finally {
            durations[name] = Date.now() - startedAt
        }
    }

    try {
        const asarBuffer = await readAndPrepareArchive(request, durations, 'native')
        await measure('write', () => runStage('write', () => fs.writeFileSync(request.outputPath, asarBuffer)))
        return { ok: true, mode: 'prepareAsar', durations, preparedPath: request.outputPath, warnings }
    } catch (error: any) {
        try {
            fs.rmSync(request.outputPath, { force: true })
        } catch {}
        const cause = error instanceof StageError ? error.cause : error
        return {
            ok: false,
            stage: error instanceof StageError ? error.stage : 'install',
            code: typeof (cause as any)?.code === 'string' ? (cause as any).code : undefined,
            message: error instanceof Error ? error.message : String(error),
        }
    }
}

async function installUnpackedArtifact(request: InstallUnpackedArtifactRequest): Promise<ArtifactWorkerResponse> {
    const durations: Record<string, number> = {}
    const warnings: ArtifactWorkerWarning[] = []
    const measure = async <T>(name: string, operation: () => Promise<T> | T): Promise<T> => {
        const startedAt = Date.now()
        try {
            return await operation()
        } finally {
            durations[name] = Date.now() - startedAt
        }
    }
    let backupPath: string | null = null

    try {
        let extractedRoot: string
        if (request.sourceKind === 'directory') {
            await measure('clone', () =>
                runStage('extract', () => {
                    fs.rmSync(request.stagingPath, { recursive: true, force: true })
                    fs.cpSync(request.archivePath, request.stagingPath, { recursive: true, force: true })
                }),
            )
            extractedRoot = request.stagingPath
        } else {
            const zipBuffer = await readAndPrepareArchive(request, durations, 'stable')

            await measure('extract', () =>
                runStage('extract', () => {
                    if (!isZipBuffer(zipBuffer)) throw new Error('Expected ZIP archive')
                    fs.rmSync(request.stagingPath, { recursive: true, force: true })
                    fs.mkdirSync(request.stagingPath, { recursive: true })
                    new AdmZip(zipBuffer).extractAllTo(request.stagingPath, true)
                }),
            )

            extractedRoot = resolveExtractedRoot(request.stagingPath, request.targetPath)
        }

        if (request.preparedDirectoryPath && request.preparedDirectoryMarker) {
            const preparedDirectoryPath = request.preparedDirectoryPath
            const marker = request.preparedDirectoryMarker
            await measure('cacheWrite', () => {
                const tempCachePath = `${preparedDirectoryPath}.tmp-${process.pid}-${Date.now()}`
                try {
                    fs.rmSync(tempCachePath, { recursive: true, force: true })
                    fs.mkdirSync(path.dirname(preparedDirectoryPath), { recursive: true })
                    fs.cpSync(extractedRoot, tempCachePath, { recursive: true, force: true })
                    fs.writeFileSync(path.join(tempCachePath, marker.fileName), `${marker.value}\n`, 'utf8')
                    fs.renameSync(tempCachePath, preparedDirectoryPath)
                } catch (error: any) {
                    warnings.push({
                        stage: 'cache',
                        code: typeof error?.code === 'string' ? error.code : undefined,
                        message: error instanceof Error ? error.message : String(error),
                    })
                } finally {
                    try {
                        fs.rmSync(tempCachePath, { recursive: true, force: true })
                    } catch {}
                }
            })
        }

        fs.mkdirSync(path.dirname(request.targetPath), { recursive: true })

        if (fs.existsSync(request.targetPath)) {
            backupPath = `${request.targetPath}.pulsesync-backup-${process.pid}-${Date.now()}`
            await measure('backup', () =>
                runStage('backup', () => retryFilesystemOperation(() => fs.renameSync(request.targetPath, backupPath as string))),
            )
        }

        await measure('install', () =>
            runStage('install', async () => {
                try {
                    await retryFilesystemOperation(() => fs.renameSync(extractedRoot, request.targetPath))
                } catch (error: any) {
                    if (error?.code !== 'EXDEV') throw error
                    await retryFilesystemOperation(() => fs.cpSync(extractedRoot, request.targetPath, { recursive: true, force: true }))
                }
            }),
        )

        await measure('cleanup', () => {
            for (const cleanupPath of [request.stagingPath, backupPath]) {
                if (!cleanupPath) continue
                try {
                    fs.rmSync(cleanupPath, { recursive: true, force: true })
                } catch (error: any) {
                    warnings.push({
                        stage: 'cleanup',
                        code: typeof error?.code === 'string' ? error.code : undefined,
                        message: error instanceof Error ? error.message : String(error),
                    })
                }
            }
        })

        return { ok: true, mode: 'installUnpacked', durations, warnings }
    } catch (error: any) {
        if (backupPath && fs.existsSync(backupPath)) {
            try {
                fs.rmSync(request.targetPath, { recursive: true, force: true })
                await retryFilesystemOperation(() => fs.renameSync(backupPath as string, request.targetPath))
            } catch (restoreError) {
                error = new StageError('restore', restoreError)
            }
        }

        try {
            fs.rmSync(request.stagingPath, { recursive: true, force: true })
        } catch {}

        const cause = error instanceof StageError ? error.cause : error
        const failure: ArtifactWorkerFailure = {
            ok: false,
            stage: error instanceof StageError ? error.stage : 'install',
            code: typeof (cause as any)?.code === 'string' ? (cause as any).code : undefined,
            message: error instanceof Error ? error.message : String(error),
        }
        return failure
    }
}

async function hashArtifact(request: HashArtifactRequest): Promise<ArtifactWorkerResponse> {
    const startedAt = Date.now()
    let descriptor: number | null = null
    try {
        const hasher = crypto.createHash('sha256')
        const buffer = Buffer.allocUnsafe(FILE_HASH_BUFFER_SIZE)
        descriptor = fs.openSync(request.filePath, 'r')
        let bytesRead = 0
        do {
            bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
            if (bytesRead > 0) hasher.update(buffer.subarray(0, bytesRead))
        } while (bytesRead > 0)
        fs.closeSync(descriptor)
        descriptor = null
        const checksum = hasher.digest('hex')
        return {
            ok: true,
            mode: 'hashFile',
            checksum,
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
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor)
            } catch {}
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
            stage: 'install',
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
