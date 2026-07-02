export type BootstrapperArtifact = {
    sha256: string
    signature?: string
    signatureAlgorithm?: 'ed25519'
    size?: number
    url: string
}

export type BootstrapperDistArtifacts = {
    app: BootstrapperArtifact
    bootstrapper?: BootstrapperArtifact
    nativeModules?: BootstrapperArtifact
}

export type BootstrapperUpdateManifest = {
    artifacts: Record<string, BootstrapperDistArtifacts>
    channel: string
    clientVersion: string
    deprecatedVersions?: string[]
    desktopApi?: string
    minClientVersion?: string
    rendererManifestUrl?: string
    schemaVersion: 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
    return readString(record, key) ?? undefined
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function parseArtifact(value: unknown, label: string): BootstrapperArtifact {
    if (!isRecord(value)) {
        throw new Error(`Manifest artifact "${label}" must be an object`)
    }

    const url = readString(value, 'url')
    const sha256 = readString(value, 'sha256')

    if (!url) {
        throw new Error(`Manifest artifact "${label}" is missing url`)
    }
    if (!sha256) {
        throw new Error(`Manifest artifact "${label}" is missing sha256`)
    }
    if (!/^[a-f0-9]{64}$/iu.test(sha256)) {
        throw new Error(`Manifest artifact "${label}" has invalid sha256`)
    }

    const signatureAlgorithm = readOptionalString(value, 'signatureAlgorithm')
    if (signatureAlgorithm && signatureAlgorithm !== 'ed25519') {
        throw new Error(`Manifest artifact "${label}" has unsupported signatureAlgorithm`)
    }

    return {
        url,
        sha256: sha256.toLowerCase(),
        size: readOptionalNumber(value, 'size'),
        signature: readOptionalString(value, 'signature'),
        signatureAlgorithm: signatureAlgorithm as 'ed25519' | undefined,
    }
}

function parseDistArtifacts(value: unknown, dist: string): BootstrapperDistArtifacts {
    if (!isRecord(value)) {
        throw new Error(`Manifest artifacts.${dist} must be an object`)
    }

    if (!value.app) {
        throw new Error(`Manifest artifacts.${dist}.app is required`)
    }

    return {
        app: parseArtifact(value.app, `${dist}.app`),
        bootstrapper: value.bootstrapper ? parseArtifact(value.bootstrapper, `${dist}.bootstrapper`) : undefined,
        nativeModules: value.nativeModules ? parseArtifact(value.nativeModules, `${dist}.nativeModules`) : undefined,
    }
}

export function parseBootstrapperManifest(payload: unknown): BootstrapperUpdateManifest {
    if (!isRecord(payload)) {
        throw new Error('Manifest must be an object')
    }

    if (payload.schemaVersion !== 1) {
        throw new Error('Manifest schemaVersion must be 1')
    }

    const channel = readString(payload, 'channel')
    const clientVersion = readString(payload, 'clientVersion')
    if (!channel) {
        throw new Error('Manifest channel is required')
    }
    if (!clientVersion) {
        throw new Error('Manifest clientVersion is required')
    }

    if (!isRecord(payload.artifacts)) {
        throw new Error('Manifest artifacts must be an object')
    }

    const artifacts = Object.fromEntries(Object.entries(payload.artifacts).map(([dist, value]) => [dist, parseDistArtifacts(value, dist)]))
    if (!Object.keys(artifacts).length) {
        throw new Error('Manifest artifacts must include at least one dist')
    }

    const deprecatedVersions = Array.isArray(payload.deprecatedVersions)
        ? payload.deprecatedVersions.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        : undefined

    return {
        schemaVersion: 1,
        channel,
        clientVersion,
        artifacts,
        deprecatedVersions,
        desktopApi: readOptionalString(payload, 'desktopApi'),
        minClientVersion: readOptionalString(payload, 'minClientVersion'),
        rendererManifestUrl: readOptionalString(payload, 'rendererManifestUrl'),
    }
}
