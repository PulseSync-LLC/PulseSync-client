import 'dotenv/config'
import path from 'path'
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import semver from 'semver'

const VERSIONED_ARTIFACT_RE = /^pulsesync-app-(.+)-([a-z0-9_-]+)\.([a-z0-9]+(?:\.[a-z0-9]+)?)$/iu

type ResolveDevVersionOptions = {
    baseVersion: string
    branch: string
    prefix: string
    channel: string
}

function argValue(...flags: string[]): string | null {
    for (const flag of flags) {
        const index = process.argv.indexOf(flag)
        if (index !== -1) {
            return process.argv[index + 1] || null
        }
    }

    return null
}

function readRequiredEnv(name: string): string {
    const value = process.env[name]?.trim()
    if (!value) {
        throw new Error(`${name} is not set`)
    }

    return value
}

function createS3Client(): S3Client {
    return new S3Client({
        region: process.env.S3_REGION,
        credentials: {
            accessKeyId: readRequiredEnv('S3_ACCESS_KEY_ID'),
            secretAccessKey: readRequiredEnv('S3_SECRET_ACCESS_KEY'),
        },
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: true,
        maxAttempts: Number(process.env.S3_MAX_ATTEMPTS) || 3,
    })
}

function parseArtifactVersion(key: string): string | null {
    const match = VERSIONED_ARTIFACT_RE.exec(path.basename(key))
    return match?.[1] ?? null
}

function extractPrereleaseSequence(version: string, baseVersion: string, channel: string): number | null {
    const parsedVersion = semver.parse(version)
    if (!parsedVersion) {
        return null
    }

    const normalizedBaseVersion = `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`
    if (normalizedBaseVersion !== baseVersion) {
        return null
    }

    const [prereleaseChannel, prereleaseSequence] = parsedVersion.prerelease
    if (typeof prereleaseChannel !== 'string' || prereleaseChannel.toLowerCase() !== channel.toLowerCase()) {
        return null
    }

    if (typeof prereleaseSequence !== 'number' || !Number.isInteger(prereleaseSequence) || prereleaseSequence < 0) {
        return null
    }

    return prereleaseSequence
}

async function resolveNextDevVersion({ baseVersion, branch, prefix, channel }: ResolveDevVersionOptions): Promise<string> {
    const bucket = readRequiredEnv('S3_BUCKET')
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/gu, '')
    const branchPrefix = `${normalizedPrefix}/${branch}/`
    const client = createS3Client()

    let continuationToken: string | undefined
    let maxSequence = 0
    const seenVersions = new Set<string>()

    do {
        const response = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: branchPrefix,
                ContinuationToken: continuationToken,
            }),
        )

        for (const object of response.Contents ?? []) {
            if (!object.Key) {
                continue
            }

            const artifactVersion = parseArtifactVersion(object.Key)
            if (!artifactVersion || seenVersions.has(artifactVersion)) {
                continue
            }

            seenVersions.add(artifactVersion)

            const sequence = extractPrereleaseSequence(artifactVersion, baseVersion, channel)
            if (sequence !== null) {
                maxSequence = Math.max(maxSequence, sequence)
            }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return `${baseVersion}-${channel}.${maxSequence + 1}`
}

async function main(): Promise<void> {
    const baseVersion = argValue('--base-version', '--baseVersion')
    if (!baseVersion) {
        throw new Error('Usage: tsx scripts/resolve-dev-version.ts --base-version <x.y.z> [--branch dev] [--prefix builds/app] [--channel dev]')
    }

    if (!semver.valid(baseVersion)) {
        throw new Error(`Invalid base version: ${baseVersion}`)
    }

    const branch = argValue('--branch') || 'dev'
    const prefix = argValue('--prefix') || 'builds/app'
    const channel = argValue('--channel') || 'dev'

    const nextVersion = await resolveNextDevVersion({
        baseVersion,
        branch,
        prefix,
        channel,
    })

    process.stdout.write(nextVersion)
}

main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
})
