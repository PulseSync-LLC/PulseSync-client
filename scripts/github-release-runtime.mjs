import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_RENDERER_MANIFEST_URL = 'https://pulsesync-llc.github.io/PulseSync-renderer/app/desktop/manifest.json'
const DESKTOP_MANIFEST_PATTERN = /^desktop-update(?:-hybrid)?-[a-z0-9_-]+\.json$/iu
const RUNTIME_ARTIFACT_PATTERN = /^pulsesync-(?:host|component|bootstrapper)-/iu

function argValue(args, flag) {
    const index = args.indexOf(flag)
    return index === -1 ? null : args[index + 1] || null
}

function requiredArg(args, flag) {
    const value = argValue(args, flag)
    if (!value) throw new Error(`${flag} is required`)
    return value
}

function requireRepository(value) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
        throw new Error(`Invalid GitHub repository: ${value}`)
    }
    return value
}

function resolveInsideWorkspace(value, label) {
    const resolved = path.resolve(value)
    const relative = path.relative(process.cwd(), resolved)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`${label} must be a non-root directory inside the workspace: ${resolved}`)
    }
    return resolved
}

function requireDirectory(directory, label) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        throw new Error(`${label} does not exist: ${directory}`)
    }
}

function listFiles(root) {
    const files = []
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                visit(entryPath)
            } else if (entry.isFile()) {
                files.push(entryPath)
            }
        }
    }
    visit(root)
    return files.sort((left, right) => left.localeCompare(right))
}

function isNestedPublicationFile(file, sourceRoot) {
    const parentSegments = path.relative(sourceRoot, file).split(path.sep).slice(0, -1)
    return parentSegments.some(segment => segment === 'bootstrapper' || segment === 'desktop-core')
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function buildFileIndex(files) {
    const index = new Map()
    for (const file of files) {
        const name = path.basename(file)
        const matches = index.get(name) || []
        matches.push(file)
        index.set(name, matches)
    }
    return index
}

function uniqueSourceFile(index, name) {
    const matches = index.get(name) || []
    if (!matches.length) throw new Error(`Release artifact is missing: ${name}`)
    if (matches.length === 1) return matches[0]

    const hashes = new Set(matches.map(sha256File))
    if (hashes.size !== 1) {
        throw new Error(`Release artifact basename is ambiguous: ${name} (${matches.join(', ')})`)
    }
    return matches[0]
}

function copyExact(source, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    if (fs.existsSync(destination)) {
        if (sha256File(source) !== sha256File(destination)) {
            throw new Error(`Prepared release asset collision: ${path.basename(destination)}`)
        }
        return false
    }
    fs.copyFileSync(source, destination)
    return true
}

function releaseDownloadUrl(repository, tag, assetName) {
    return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`
}

function artifactAssetName(artifact, label) {
    if (!artifact || typeof artifact !== 'object' || typeof artifact.url !== 'string') {
        throw new Error(`${label} has no artifact URL`)
    }
    let parsed
    try {
        parsed = new URL(artifact.url)
    } catch {
        throw new Error(`${label} has an invalid artifact URL: ${artifact.url}`)
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${label} artifact URL must use HTTP(S): ${artifact.url}`)
    }
    const encodedName = parsed.pathname.split('/').filter(Boolean).at(-1)
    if (!encodedName) throw new Error(`${label} artifact URL has no filename: ${artifact.url}`)
    const name = decodeURIComponent(encodedName)
    if (path.basename(name) !== name || !name.trim()) {
        throw new Error(`${label} artifact filename is invalid: ${name}`)
    }
    return name
}

function rewriteVersionedArtifact(descriptor, label, context) {
    if (!descriptor || typeof descriptor !== 'object') throw new Error(`${label} descriptor is invalid`)
    delete descriptor.files
    const artifact = descriptor.artifact
    const assetName = artifactAssetName(artifact, label)
    const sourceFile = uniqueSourceFile(context.fileIndex, assetName)
    const actualHash = sha256File(sourceFile)
    const actualSize = fs.statSync(sourceFile).size
    if (typeof artifact.sha256 !== 'string' || artifact.sha256.toLowerCase() !== actualHash) {
        throw new Error(`${label} SHA-256 does not match ${assetName}`)
    }
    if (artifact.size !== undefined && artifact.size !== actualSize) {
        throw new Error(`${label} size does not match ${assetName}`)
    }
    artifact.url = releaseDownloadUrl(context.repository, context.tag, assetName)
    context.referencedAssets.set(assetName, sourceFile)
}

function transformManifest(sourceFile, context) {
    const manifest = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
    if (!manifest || typeof manifest !== 'object' || ![3, 4].includes(manifest.schemaVersion)) {
        throw new Error(`Unsupported desktop manifest schema: ${sourceFile}`)
    }
    if (!manifest.targets || typeof manifest.targets !== 'object') {
        throw new Error(`Desktop manifest has no targets: ${sourceFile}`)
    }

    for (const [dist, target] of Object.entries(manifest.targets)) {
        if (!target || typeof target !== 'object') throw new Error(`Desktop target is invalid: ${dist}`)
        rewriteVersionedArtifact(target.host, `targets.${dist}.host`, context)
        if (!target.components || typeof target.components !== 'object') {
            throw new Error(`Desktop target has no components: ${dist}`)
        }
        for (const [name, component] of Object.entries(target.components)) {
            rewriteVersionedArtifact(component, `targets.${dist}.components.${name}`, context)
        }
        if (target.bootstrapper !== undefined) {
            rewriteVersionedArtifact(target.bootstrapper, `targets.${dist}.bootstrapper`, context)
        }
    }

    manifest.rendererManifestUrl = context.rendererManifestUrl
    return manifest
}

function ordinaryReleaseAssetName(baseName) {
    return /^pulsesync-app-.+-universal\.dmg$/iu.test(baseName) ? baseName.replace(/-universal\.dmg$/iu, '-x64-arm64.dmg') : baseName
}

function flattenOrdinaryAssets(files, sourceRoot, targetRoot) {
    const copyCounts = new Map()
    let copied = 0
    for (const file of files) {
        const baseName = path.basename(file)
        if (DESKTOP_MANIFEST_PATTERN.test(baseName) || RUNTIME_ARTIFACT_PATTERN.test(baseName)) continue

        let targetName = ordinaryReleaseAssetName(baseName)
        const existing = path.join(targetRoot, targetName)
        if (fs.existsSync(existing) && sha256File(existing) !== sha256File(file)) {
            const relative = path.relative(sourceRoot, file)
            const bucket = relative.split(path.sep)[0].replace(/[^A-Za-z0-9_.-]+/gu, '-') || 'artifact'
            const nextCount = (copyCounts.get(targetName) || 0) + 1
            copyCounts.set(targetName, nextCount)
            targetName = `${bucket}-${nextCount}-${targetName}`
        }
        if (copyExact(file, path.join(targetRoot, targetName))) copied += 1
    }
    return copied
}

function verifyPreparedManifest(manifest, targetRoot, repository, tag) {
    const expectedPrefix = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/`
    for (const [dist, target] of Object.entries(manifest.targets)) {
        const descriptors = [
            [`targets.${dist}.host`, target.host],
            ...Object.entries(target.components).map(([name, value]) => [`targets.${dist}.components.${name}`, value]),
            ...(target.bootstrapper ? [[`targets.${dist}.bootstrapper`, target.bootstrapper]] : []),
        ]
        for (const [label, descriptor] of descriptors) {
            if ('files' in descriptor) throw new Error(`${label} still contains file/delta delivery`)
            const artifact = descriptor.artifact
            if (!artifact.url.startsWith(expectedPrefix)) throw new Error(`${label} is not GitHub-hosted: ${artifact.url}`)
            const assetName = artifactAssetName(artifact, label)
            const targetFile = path.join(targetRoot, assetName)
            if (!fs.existsSync(targetFile)) throw new Error(`${label} references an unprepared asset: ${assetName}`)
            if (sha256File(targetFile) !== artifact.sha256.toLowerCase()) throw new Error(`${label} prepared asset hash changed: ${assetName}`)
        }
    }
}

function prepareRelease(args) {
    const sourceRoot = resolveInsideWorkspace(requiredArg(args, '--source'), 'Source')
    const targetRoot = resolveInsideWorkspace(requiredArg(args, '--target'), 'Target')
    const repository = requireRepository(requiredArg(args, '--repository'))
    const tag = requiredArg(args, '--tag')
    const rendererManifestUrl = argValue(args, '--renderer-manifest-url') || DEFAULT_RENDERER_MANIFEST_URL
    requireDirectory(sourceRoot, 'Downloaded release artifacts')
    if (targetRoot.startsWith(`${sourceRoot}${path.sep}`) || sourceRoot.startsWith(`${targetRoot}${path.sep}`)) {
        throw new Error('Source and target release directories must not contain each other')
    }

    fs.rmSync(targetRoot, { force: true, recursive: true })
    fs.mkdirSync(targetRoot, { recursive: true })
    const allFiles = listFiles(sourceRoot)
    const files = allFiles.filter(file => !isNestedPublicationFile(file, sourceRoot))
    const fileIndex = buildFileIndex(files)
    const manifestFiles = files.filter(file => DESKTOP_MANIFEST_PATTERN.test(path.basename(file)))
    if (!manifestFiles.length) throw new Error(`No desktop update manifests found under ${sourceRoot}`)

    const referencedAssets = new Map()
    const context = { fileIndex, referencedAssets, rendererManifestUrl, repository, tag }
    const transformedManifests = []
    for (const manifestFile of manifestFiles) {
        const name = path.basename(manifestFile)
        uniqueSourceFile(fileIndex, name)
        const manifest = transformManifest(manifestFile, context)
        transformedManifests.push([name, manifest])
    }

    const ordinaryCount = flattenOrdinaryAssets(files, sourceRoot, targetRoot)
    for (const [name, sourceFile] of referencedAssets) {
        copyExact(sourceFile, path.join(targetRoot, name))
    }
    for (const [name, manifest] of transformedManifests) {
        fs.writeFileSync(path.join(targetRoot, name), `${JSON.stringify(manifest, null, 4)}\n`, 'utf8')
        verifyPreparedManifest(manifest, targetRoot, repository, tag)
    }

    console.log(
        `Prepared GitHub release ${tag}: ${transformedManifests.length} manifests, ${referencedAssets.size} runtime assets, ${ordinaryCount} ordinary assets`,
    )
    console.log(`Prepared release directory: ${targetRoot}`)
}

async function main() {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'prepare') {
        prepareRelease(args)
        return
    }
    throw new Error('Usage: node scripts/github-release-runtime.mjs prepare [options]')
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exit(1)
})
