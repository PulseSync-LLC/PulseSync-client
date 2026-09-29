export type ArtifactWorkerStage = 'read' | 'checksum' | 'decompress' | 'write' | 'extract' | 'backup' | 'install' | 'cleanup' | 'restore'

export type InstallUnpackedArtifactRequest = {
    mode: 'installUnpacked'
    sourceKind?: 'archive' | 'directory'
    archivePath: string
    archiveExtension: string
    expectedChecksum?: string
    preparedDirectoryPath?: string
    preparedDirectoryMarker?: {
        fileName: string
        value: string
    }
    stagingPath: string
    targetPath: string
}

export type PrepareAsarArtifactRequest = {
    mode: 'prepareAsar'
    archivePath: string
    archiveExtension: string
    expectedChecksum?: string
    outputPath: string
}

export type HashArtifactRequest = {
    mode: 'hashFile'
    filePath: string
}

export type ArtifactWorkerRequest = InstallUnpackedArtifactRequest | PrepareAsarArtifactRequest | HashArtifactRequest

export type ArtifactWorkerRequestMessage = {
    id: number
    request: ArtifactWorkerRequest
}

export type InstallUnpackedArtifactSuccess = {
    ok: true
    mode: 'installUnpacked'
    durations: Record<string, number>
    warnings: ArtifactWorkerWarning[]
}

export type PrepareAsarArtifactSuccess = {
    ok: true
    mode: 'prepareAsar'
    durations: Record<string, number>
    preparedPath: string
    warnings: ArtifactWorkerWarning[]
}

export type HashArtifactSuccess = {
    ok: true
    mode: 'hashFile'
    checksum: string
    durations: Record<string, number>
    warnings: ArtifactWorkerWarning[]
}

export type ArtifactWorkerWarning = {
    stage: 'cache' | 'cleanup'
    code?: string
    message: string
}

export type ArtifactWorkerFailure = {
    ok: false
    stage: ArtifactWorkerStage
    code?: string
    message: string
}

export type ArtifactWorkerResponse = InstallUnpackedArtifactSuccess | PrepareAsarArtifactSuccess | HashArtifactSuccess | ArtifactWorkerFailure

export type ArtifactWorkerResponseMessage = {
    id: number
    response: ArtifactWorkerResponse
    workerThreadId: number
}
