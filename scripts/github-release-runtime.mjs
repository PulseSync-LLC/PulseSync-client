import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const GITHUB_RENDERER_BASE_URL = 'https://static.pulsesync.dev/app'
const DESKTOP_MANIFEST_PATTERN = /^desktop-update(?:-hybrid)?-[a-z0-9_-]+\.json$/iu
const RUNTIME_ARTIFACT_PATTERN = /^pulsesync-(?:host|component|bootstrapper)-/iu

function rendererManifestUrlForChannel(channel) {
    const rendererChannel = channel?.trim().toLowerCase() === 'beta' ? 'beta' : 'dev'
    return `${GITHUB_RENDERER_BASE_URL}/${rendererChannel}/desktop/manifest.json`
}

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

function resolveFileInsideWorkspace(value, label) {
    const resolved = path.resolve(value)
    const relative = path.relative(process.cwd(), resolved)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw new Error(`${label} must be a file inside the workspace: ${resolved}`)
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

async function downloadCanonicalArtifact(artifact, assetName, label, context) {
    if (!context.canonicalArtifactRoot) {
        throw new Error(`${label} SHA-256 does not match ${assetName}`)
    }

    const targetDir = path.join(context.canonicalArtifactRoot, artifact.sha256.slice(0, 16))
    const targetFile = path.join(targetDir, assetName)
    if (fs.existsSync(targetFile) && sha256File(targetFile) === artifact.sha256.toLowerCase()) return targetFile

    const response = await fetch(artifact.url, { headers: githubHeaders() })
    if (!response.ok) throw new Error(`${label} canonical artifact download failed (${response.status}): ${artifact.url}`)
    if (!response.body) throw new Error(`${label} canonical artifact response is empty: ${artifact.url}`)

    fs.mkdirSync(targetDir, { recursive: true })
    const temporaryFile = `${targetFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    try {
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporaryFile))
        const actualHash = sha256File(temporaryFile)
        const actualSize = fs.statSync(temporaryFile).size
        if (actualHash !== artifact.sha256.toLowerCase() || (artifact.size !== undefined && artifact.size !== actualSize)) {
            throw new Error(`${label} downloaded canonical artifact does not match its descriptor`)
        }
        fs.renameSync(temporaryFile, targetFile)
    } finally {
        fs.rmSync(temporaryFile, { force: true })
    }
    console.log(`Recovered canonical runtime asset: ${assetName}`)
    return targetFile
}

async function rewriteVersionedArtifact(descriptor, label, context) {
    if (!descriptor || typeof descriptor !== 'object') throw new Error(`${label} descriptor is invalid`)
    delete descriptor.files
    const artifact = descriptor.artifact
    const assetName = artifactAssetName(artifact, label)
    if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(artifact.sha256)) {
        throw new Error(`${label} has an invalid SHA-256`)
    }
    const expectedHash = artifact.sha256.toLowerCase()
    const sourceFile = (context.fileIndex.get(assetName) || []).find(candidate => {
        const stat = fs.statSync(candidate)
        return (artifact.size === undefined || artifact.size === stat.size) && sha256File(candidate) === expectedHash
    })
    const resolvedSourceFile = sourceFile || (await downloadCanonicalArtifact(artifact, assetName, label, context))
    if (artifact.size !== undefined && artifact.size !== fs.statSync(resolvedSourceFile).size) {
        throw new Error(`${label} size does not match ${assetName}`)
    }
    artifact.url = releaseDownloadUrl(context.repository, context.tag, assetName)
    context.referencedAssets.set(assetName, resolvedSourceFile)
}

async function transformManifest(sourceFile, context) {
    const manifest = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
    if (!manifest || typeof manifest !== 'object' || ![3, 4, 5].includes(manifest.schemaVersion)) {
        throw new Error(`Unsupported desktop manifest schema: ${sourceFile}`)
    }
    if (!manifest.targets || typeof manifest.targets !== 'object') {
        throw new Error(`Desktop manifest has no targets: ${sourceFile}`)
    }

    for (const [dist, target] of Object.entries(manifest.targets)) {
        if (!target || typeof target !== 'object') throw new Error(`Desktop target is invalid: ${dist}`)
        await rewriteVersionedArtifact(target.host, `targets.${dist}.host`, context)
        if (!target.components || typeof target.components !== 'object') {
            throw new Error(`Desktop target has no components: ${dist}`)
        }
        for (const [name, component] of Object.entries(target.components)) {
            await rewriteVersionedArtifact(component, `targets.${dist}.components.${name}`, context)
        }
        if (target.bootstrapper !== undefined) {
            await rewriteVersionedArtifact(target.bootstrapper, `targets.${dist}.bootstrapper`, context)
        }
    }

    manifest.rendererManifestUrl = context.rendererManifestUrl || rendererManifestUrlForChannel(manifest.channel)
    return manifest
}

function requireManifest(value, label) {
    if (!value || typeof value !== 'object' || ![3, 4, 5].includes(value.schemaVersion) || !value.targets || typeof value.targets !== 'object') {
        throw new Error(`${label} is not a supported desktop manifest`)
    }
    return value
}

function prereleaseChannel(tag) {
    const normalized = tag.trim().replace(/^v/u, '')
    const separator = normalized.indexOf('-')
    if (separator === -1) return null
    return normalized
        .slice(separator + 1)
        .split(/[.+]/u)[0]
        .toLowerCase()
}

function githubHeaders() {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    return {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'User-Agent': 'PulseSyncComponentPublisher',
        'X-GitHub-Api-Version': '2022-11-28',
    }
}

async function fetchJson(url, label) {
    const response = await fetch(url, { headers: githubHeaders() })
    if (!response.ok) throw new Error(`${label} request failed (${response.status}): ${url}`)
    return await response.json()
}

async function findPreviousGitHubManifest(repository, channel, manifestName, currentTag) {
    const wantPrerelease = channel === 'alpha' || channel === 'dev'
    for (let page = 1; page <= 10; page += 1) {
        const releases = await fetchJson(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, 'GitHub releases')
        if (!Array.isArray(releases)) throw new Error('GitHub releases response is invalid')
        for (const release of releases) {
            if (!release || release.draft === true || release.tag_name === currentTag || release.prerelease !== wantPrerelease) continue
            if (wantPrerelease && prereleaseChannel(release.tag_name || '') !== channel) continue
            const asset = Array.isArray(release.assets) ? release.assets.find(candidate => candidate?.name === manifestName) : null
            if (!asset?.browser_download_url) continue
            const manifest = requireManifest(await fetchJson(asset.browser_download_url, 'Previous GitHub manifest'), 'Previous GitHub manifest')
            if (manifest.channel !== channel) continue
            return { manifest, tag: release.tag_name }
        }
        if (releases.length < 100) break
    }
    throw new Error(`No previous GitHub ${channel} manifest ${manifestName} found in ${repository}; publish a full release first`)
}

function copyManifestTopLevel(source, target) {
    const fields = [
        'schemaVersion',
        'metadataVersion',
        'channel',
        'desktopVersion',
        'bundleVersion',
        'deprecatedVersions',
        'desktopApi',
        'minClientVersion',
        'rendererManifestUrl',
    ]
    for (const field of fields) {
        if (Object.hasOwn(source, field)) target[field] = structuredClone(source[field])
        else delete target[field]
    }
}

function verifyComponentManifest(manifest, targetRoot, repository, tag, dist, component) {
    const repositoryPrefix = `https://github.com/${repository}/releases/download/`
    const currentPrefix = `${repositoryPrefix}${encodeURIComponent(tag)}/`
    const target = manifest.targets[dist]
    const descriptors = [
        ['host', target.host],
        ...Object.entries(target.components).map(([name, value]) => [`component:${name}`, value]),
        ...(target.bootstrapper ? [['bootstrapper', target.bootstrapper]] : []),
    ]
    for (const [key, descriptor] of descriptors) {
        if ('files' in descriptor) throw new Error(`${key} still contains file/delta delivery`)
        if (!descriptor.artifact.url.startsWith(repositoryPrefix)) throw new Error(`${key} is not GitHub-hosted: ${descriptor.artifact.url}`)
    }
    const selected = component === 'bootstrapper' ? target.bootstrapper : target.components[component]
    if (!selected) throw new Error(`Prepared manifest is missing selected component: ${component}`)
    if (!selected.artifact.url.startsWith(currentPrefix))
        throw new Error(`Selected component is not hosted by current release: ${selected.artifact.url}`)
    const assetName = artifactAssetName(selected.artifact, component)
    const assetPath = path.join(targetRoot, assetName)
    if (!fs.existsSync(assetPath) || sha256File(assetPath) !== selected.artifact.sha256.toLowerCase()) {
        throw new Error(`Selected component asset is missing or changed: ${assetName}`)
    }
    if (manifest.rendererManifestUrl !== rendererManifestUrlForChannel(manifest.channel)) {
        throw new Error(`Component manifest renderer must use GitHub Pages: ${manifest.rendererManifestUrl}`)
    }
}

async function prepareComponentRelease(args) {
    const sourceManifestFile = resolveFileInsideWorkspace(requiredArg(args, '--source-manifest'), 'Source manifest')
    const sourceAssetFile = resolveFileInsideWorkspace(requiredArg(args, '--source-asset'), 'Source component asset')
    const targetRoot = resolveInsideWorkspace(requiredArg(args, '--target'), 'Target')
    const repository = requireRepository(requiredArg(args, '--repository'))
    const tag = requiredArg(args, '--tag')
    const channel = requiredArg(args, '--channel').toLowerCase()
    const dist = requiredArg(args, '--dist').toLowerCase()
    const component = requiredArg(args, '--component')
    if (!['alpha', 'beta', 'dev'].includes(channel)) throw new Error(`Unsupported component release channel: ${channel}`)
    if (!/^(?:win32|linux|darwin)-[a-z0-9_-]+$/u.test(dist)) throw new Error(`Invalid component release dist: ${dist}`)
    if (!['desktopCore', 'artifactWorker', 'pulsesyncNative', 'bootstrapper'].includes(component)) {
        throw new Error(`Unsupported runtime component: ${component}`)
    }

    const sourceManifest = requireManifest(JSON.parse(fs.readFileSync(sourceManifestFile, 'utf8')), 'Source manifest')
    if (sourceManifest.channel !== channel) throw new Error(`Source manifest channel mismatch: ${sourceManifest.channel}`)
    const sourceTarget = sourceManifest.targets[dist]
    if (!sourceTarget) throw new Error(`Source manifest has no target: ${dist}`)
    const manifestName = path.basename(sourceManifestFile)
    if (!DESKTOP_MANIFEST_PATTERN.test(manifestName)) throw new Error(`Unexpected desktop manifest filename: ${manifestName}`)
    const previousManifestFile = argValue(args, '--previous-github-manifest')
    const previous = previousManifestFile
        ? {
              manifest: requireManifest(
                  JSON.parse(fs.readFileSync(resolveFileInsideWorkspace(previousManifestFile, 'Previous GitHub manifest'), 'utf8')),
                  'Previous GitHub manifest',
              ),
              tag: 'local-fixture',
          }
        : await findPreviousGitHubManifest(repository, channel, manifestName, tag)
    if (previous.manifest.channel !== channel) throw new Error(`Previous GitHub manifest channel mismatch: ${previous.manifest.channel}`)
    const previousTarget = previous.manifest.targets[dist]
    if (!previousTarget || previousTarget.layout !== sourceTarget.layout) {
        throw new Error(`Previous GitHub manifest target/layout mismatch for ${dist}`)
    }

    const selectedSource = component === 'bootstrapper' ? sourceTarget.bootstrapper : sourceTarget.components?.[component]
    if (!selectedSource) throw new Error(`Source manifest does not contain selected component: ${component}`)
    const selected = structuredClone(selectedSource)
    const assetName = artifactAssetName(selected.artifact, component)
    if (path.basename(sourceAssetFile) !== assetName) {
        throw new Error(`Source component asset mismatch: expected ${assetName}, got ${path.basename(sourceAssetFile)}`)
    }
    const context = {
        fileIndex: buildFileIndex([sourceAssetFile]),
        referencedAssets: new Map(),
        rendererManifestUrl: rendererManifestUrlForChannel(channel),
        repository,
        tag,
    }
    await rewriteVersionedArtifact(selected, `targets.${dist}.${component}`, context)

    const manifest = structuredClone(previous.manifest)
    copyManifestTopLevel(sourceManifest, manifest)
    manifest.rendererManifestUrl = rendererManifestUrlForChannel(channel)
    const mergedTarget = structuredClone(previousTarget)
    if (component === 'bootstrapper') mergedTarget.bootstrapper = selected
    else mergedTarget.components[component] = selected
    manifest.targets = { [dist]: mergedTarget }

    fs.rmSync(targetRoot, { force: true, recursive: true })
    fs.mkdirSync(targetRoot, { recursive: true })
    copyExact(sourceAssetFile, path.join(targetRoot, assetName))
    fs.writeFileSync(path.join(targetRoot, manifestName), `${JSON.stringify(manifest, null, 4)}\n`, 'utf8')
    verifyComponentManifest(manifest, targetRoot, repository, tag, dist, component)
    console.log(`Prepared ${component} GitHub release ${tag} for ${dist}; inherited unchanged runtime from ${previous.tag}`)
    console.log(`Prepared release directory: ${targetRoot}`)
}

async function checkComponentBase(args) {
    const repository = requireRepository(requiredArg(args, '--repository'))
    const channel = requiredArg(args, '--channel').toLowerCase()
    const dist = requiredArg(args, '--dist').toLowerCase()
    const tag = requiredArg(args, '--tag')
    if (!['alpha', 'beta', 'dev'].includes(channel)) throw new Error(`Unsupported component release channel: ${channel}`)
    const name = dist.startsWith('darwin-') ? `desktop-update-hybrid-${dist}.json` : `desktop-update-${dist}.json`
    const previous = await findPreviousGitHubManifest(repository, channel, name, tag)
    if (!previous.manifest.targets[dist]) throw new Error(`Previous GitHub manifest has no target: ${dist}`)
    console.log(`GitHub component baseline: ${previous.tag}/${name}`)
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

async function prepareRelease(args) {
    const sourceRoot = resolveInsideWorkspace(requiredArg(args, '--source'), 'Source')
    const targetRoot = resolveInsideWorkspace(requiredArg(args, '--target'), 'Target')
    const repository = requireRepository(requiredArg(args, '--repository'))
    const tag = requiredArg(args, '--tag')
    const rendererManifestUrl = argValue(args, '--renderer-manifest-url')
    requireDirectory(sourceRoot, 'Downloaded release artifacts')
    if (targetRoot.startsWith(`${sourceRoot}${path.sep}`) || sourceRoot.startsWith(`${targetRoot}${path.sep}`)) {
        throw new Error('Source and target release directories must not contain each other')
    }

    fs.rmSync(targetRoot, { force: true, recursive: true })
    fs.mkdirSync(targetRoot, { recursive: true })
    const canonicalArtifactRoot = path.join(targetRoot, '.canonical-runtime')
    const allFiles = listFiles(sourceRoot)
    const files = allFiles.filter(file => !isNestedPublicationFile(file, sourceRoot))
    const fileIndex = buildFileIndex(files)
    const manifestFiles = files.filter(file => DESKTOP_MANIFEST_PATTERN.test(path.basename(file)))
    if (!manifestFiles.length) throw new Error(`No desktop update manifests found under ${sourceRoot}`)

    const referencedAssets = new Map()
    const context = { canonicalArtifactRoot, fileIndex, referencedAssets, rendererManifestUrl, repository, tag }
    const transformedManifests = []
    let ordinaryCount
    try {
        for (const manifestFile of manifestFiles) {
            const name = path.basename(manifestFile)
            uniqueSourceFile(fileIndex, name)
            const manifest = await transformManifest(manifestFile, context)
            transformedManifests.push([name, manifest])
        }

        ordinaryCount = flattenOrdinaryAssets(files, sourceRoot, targetRoot)
        for (const [name, sourceFile] of referencedAssets) {
            copyExact(sourceFile, path.join(targetRoot, name))
        }
        for (const [name, manifest] of transformedManifests) {
            fs.writeFileSync(path.join(targetRoot, name), `${JSON.stringify(manifest, null, 4)}\n`, 'utf8')
            verifyPreparedManifest(manifest, targetRoot, repository, tag)
        }
    } finally {
        fs.rmSync(canonicalArtifactRoot, { force: true, recursive: true })
    }

    console.log(
        `Prepared GitHub release ${tag}: ${transformedManifests.length} manifests, ${referencedAssets.size} runtime assets, ${ordinaryCount} ordinary assets`,
    )
    console.log(`Prepared release directory: ${targetRoot}`)
}

async function main() {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'prepare') {
        await prepareRelease(args)
        return
    }
    if (command === 'prepare-component') {
        await prepareComponentRelease(args)
        return
    }
    if (command === 'check-component-base') {
        await checkComponentBase(args)
        return
    }
    throw new Error('Usage: node scripts/github-release-runtime.mjs <prepare|prepare-component|check-component-base> [options]')
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exit(1)
})
