import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { dialog, ipcMain } from 'electron'

import semver from 'semver'

import MainEvents from '@common/types/mainEvents'

import { getState } from '../state'
import { getAddonsRoot, isPathInsideBase, resolveExistingPathInsideBase } from '../utils/addonPaths'
import { readAddonProjectConfig, updateAddonProjectConfig } from '../utils/addonProjectManifest'

import type { AddonProjectDocument, AddonProjectOpenRequest } from '@common/addons/project'

const documents: Record<AddonProjectDocument, string> = {
    manifest: 'addon.manifest.json',
    readme: 'addon/README.md',
    changelog: 'addon/CHANGELOG.md',
}
const imageMime: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
}
type ManifestSource = { file: string; source: string; content: string; format: 'json' | 'config' }
type ProjectSession = { root: string; owner: number; writing: boolean; manifestSource?: ManifestSource; addonId?: string }
const sessions = new Map<string, ProjectSession>()
const sessionOwners = new Set<number>()
type ProjectLink = { addonId: string; rootPath: string }
const PROJECT_LINKS_KEY = 'app.addonProjects'

function readProjectLinks(): ProjectLink[] {
    const stored: unknown = getState().get(PROJECT_LINKS_KEY)
    if (!Array.isArray(stored)) return []
    return stored.filter(
        (link): link is ProjectLink => !!link && typeof link === 'object' && typeof link.addonId === 'string' && typeof link.rootPath === 'string',
    )
}

function getSession(id: string, owner: number): ProjectSession {
    const session = sessions.get(id)
    if (!session || session.owner !== owner) throw new Error('INVALID_ADDON_PROJECT')
    return session
}

async function resolveProjectFile(root: string, relativePath: string): Promise<string> {
    const target = path.resolve(root, relativePath)
    if (!relativePath || path.isAbsolute(relativePath) || !isPathInsideBase(root, target) || target === root)
        throw new Error('INVALID_ADDON_PROJECT_PATH')

    let existing = target
    while (true) {
        try {
            await fs.lstat(existing)
            break
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            existing = path.dirname(existing)
        }
    }
    if (!isPathInsideBase(root, await fs.realpath(existing))) throw new Error('INVALID_ADDON_PROJECT_PATH')
    return target
}

async function readDocument(session: ProjectSession, document: AddonProjectDocument): Promise<string> {
    if (!Object.hasOwn(documents, document)) throw new Error('INVALID_ADDON_PROJECT_DOCUMENT')
    if (document === 'manifest') return (await readManifest(session)).content
    const file = await resolveProjectFile(session.root, documents[document])
    try {
        return await fs.readFile(file, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
        throw error
    }
}

async function readManifest(session: ProjectSession): Promise<ManifestSource> {
    const jsonFile = await resolveProjectFile(session.root, 'addon.manifest.json')
    try {
        const source = await fs.readFile(jsonFile, 'utf8')
        return { file: jsonFile, source, content: source, format: 'json' }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const file = await resolveProjectFile(session.root, 'addon.config.mjs')
    const source = await fs.readFile(file, 'utf8')
    const content = `${JSON.stringify(readAddonProjectConfig(source), null, 4)}\n`
    return { file, source, content, format: 'config' }
}

function validateManifest(content: string): string {
    const manifest = JSON.parse(content.replace(/^\uFEFF/, ''))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('INVALID_ADDON_PROJECT_MANIFEST')
    for (const key of ['id', 'name', 'version']) {
        if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error('INVALID_ADDON_PROJECT_MANIFEST')
    }
    if (!semver.valid(manifest.version)) throw new Error('INVALID_ADDON_PROJECT_MANIFEST')
    if (
        !(typeof manifest.author === 'string' && manifest.author.trim()) &&
        !(
            Array.isArray(manifest.author) &&
            manifest.author.length &&
            manifest.author.every((author: unknown) => typeof author === 'string' && author.trim())
        )
    )
        throw new Error('INVALID_ADDON_PROJECT_MANIFEST')
    for (const key of ['tags', 'dependencies', 'conflictsWith', 'allowedUrls', 'supportedVersions']) {
        if (manifest[key] !== undefined && (!Array.isArray(manifest[key]) || !manifest[key].every((value: unknown) => typeof value === 'string')))
            throw new Error('INVALID_ADDON_PROJECT_MANIFEST')
    }
    if (manifest.supportedVersions?.some((version: string) => !semver.validRange(version))) throw new Error('INVALID_ADDON_PROJECT_MANIFEST')
    for (const key of ['image', 'banner', 'libraryLogo']) {
        const value = manifest[key]
        if (value === undefined || value === '') continue
        if (
            typeof value !== 'string' ||
            path.isAbsolute(value) ||
            !isPathInsideBase('/addon', path.resolve('/addon', value)) ||
            !imageMime[path.extname(value).toLowerCase()]
        )
            throw new Error('INVALID_ADDON_PROJECT_IMAGE')
    }
    return manifest.id.trim()
}

async function loadProject(rootPath: string, owner: number, expectedAddonId?: string): Promise<{ session: ProjectSession; addonId: string }> {
    const root = await fs.realpath(rootPath)
    const session: ProjectSession = { root, owner, writing: false }
    const config = await resolveProjectFile(root, 'addon.config.mjs')
    const staticDirectory = await resolveProjectFile(root, 'addon')
    if (!(await fs.stat(config)).isFile() || !(await fs.stat(staticDirectory)).isDirectory()) throw new Error('INVALID_ADDON_PROJECT')
    const addonId = validateManifest(await readDocument(session, 'manifest'))
    if (expectedAddonId && addonId !== expectedAddonId) throw new Error('ADDON_PROJECT_ID_MISMATCH')
    session.addonId = addonId
    return { session, addonId }
}

async function getInstalledAddonId(request: AddonProjectOpenRequest): Promise<string> {
    if (
        !request ||
        typeof request.directoryName !== 'string' ||
        !request.directoryName ||
        path.basename(request.directoryName) !== request.directoryName ||
        (request.linkedOnly !== undefined && typeof request.linkedOnly !== 'boolean')
    )
        throw new Error('INVALID_ADDON_PROJECT')
    const root = getAddonsRoot()
    const file = resolveExistingPathInsideBase(root, path.join(root, request.directoryName, 'metadata.json'))
    if (!file) throw new Error('INVALID_ADDON_PROJECT')
    const metadata = JSON.parse(await fs.readFile(file, 'utf8'))
    if (metadata.type !== 'web-addon' || typeof metadata.id !== 'string' || !metadata.id.trim()) throw new Error('INVALID_ADDON_PROJECT')
    return metadata.id.trim()
}

export function registerAddonProjectEvents(): void {
    ipcMain.handle(MainEvents.ADDON_PROJECT_OPEN, async (event, request?: AddonProjectOpenRequest) => {
        const expectedAddonId = request === undefined ? undefined : await getInstalledAddonId(request)
        const saved = expectedAddonId ? readProjectLinks().find(link => link.addonId === expectedAddonId) : undefined
        let opened: Awaited<ReturnType<typeof loadProject>> | undefined
        if (saved) {
            try {
                opened = await loadProject(saved.rootPath, event.sender.id, expectedAddonId)
            } catch {
                getState().set(
                    PROJECT_LINKS_KEY,
                    readProjectLinks().filter(link => link.addonId !== expectedAddonId),
                )
            }
        }
        if (!opened) {
            if (request?.linkedOnly) return null
            const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
            if (result.canceled || !result.filePaths[0]) return null
            opened = await loadProject(result.filePaths[0], event.sender.id, expectedAddonId)
        }
        const { session, addonId } = opened
        getState().set(PROJECT_LINKS_KEY, [...readProjectLinks().filter(link => link.addonId !== addonId), { addonId, rootPath: session.root }])
        for (const [previousId, previous] of sessions) {
            if (previous.owner === event.sender.id) sessions.delete(previousId)
        }
        const id = randomUUID()
        sessions.set(id, session)
        if (!sessionOwners.has(event.sender.id)) {
            const owner = event.sender.id
            sessionOwners.add(owner)
            event.sender.once('destroyed', () => {
                for (const [sessionId, opened] of sessions) {
                    if (opened.owner === owner) sessions.delete(sessionId)
                }
                sessionOwners.delete(owner)
            })
        }
        return { id, rootPath: session.root }
    })

    ipcMain.handle(MainEvents.ADDON_PROJECT_CLOSE, (event, id: string) => {
        getSession(id, event.sender.id)
        sessions.delete(id)
    })

    ipcMain.handle(MainEvents.ADDON_PROJECT_RESET_LINK, (event, id: string) => {
        const session = getSession(id, event.sender.id)
        getState().set(
            PROJECT_LINKS_KEY,
            readProjectLinks().filter(link => link.addonId !== session.addonId),
        )
    })

    ipcMain.handle(MainEvents.ADDON_PROJECT_READ_TEXT, async (event, id: string, document: AddonProjectDocument) => {
        const session = getSession(id, event.sender.id)
        if (document === 'manifest') {
            session.manifestSource = await readManifest(session)
            return session.manifestSource.content
        }
        return readDocument(session, document)
    })

    ipcMain.handle(
        MainEvents.ADDON_PROJECT_WRITE_TEXT,
        async (event, id: string, document: AddonProjectDocument, content: string, expectedContent: string) => {
            const session = getSession(id, event.sender.id)
            if (session.writing || typeof content !== 'string' || typeof expectedContent !== 'string') throw new Error('INVALID_ADDON_PROJECT_WRITE')
            session.writing = true
            let temporaryFile: string | undefined
            try {
                let manifest: ManifestSource | undefined
                let output = content
                if (document === 'manifest') {
                    validateManifest(content)
                    manifest = await readManifest(session)
                    const matchesExpected =
                        manifest.format === 'json'
                            ? manifest.content === expectedContent
                            : isDeepStrictEqual(JSON.parse(manifest.content), JSON.parse(expectedContent))
                    if (
                        !matchesExpected ||
                        (session.manifestSource &&
                            (session.manifestSource.file !== manifest.file || session.manifestSource.source !== manifest.source))
                    )
                        throw new Error('ADDON_PROJECT_CHANGED')
                    if (manifest.format === 'config') {
                        output = updateAddonProjectConfig(manifest.source, JSON.parse(content))
                        if (!isDeepStrictEqual(readAddonProjectConfig(output), JSON.parse(content)))
                            throw new Error('UNSUPPORTED_ADDON_PROJECT_CONFIG')
                    }
                } else if ((await readDocument(session, document)) !== expectedContent) {
                    throw new Error('ADDON_PROJECT_CHANGED')
                }
                const file = manifest?.file ?? (await resolveProjectFile(session.root, documents[document]))
                temporaryFile = path.join(path.dirname(file), `.pulsesync-editor-${randomUUID()}.tmp`)
                await fs.writeFile(temporaryFile, output, { encoding: 'utf8', flag: 'wx' })
                if (manifest) {
                    const latest = await readManifest(session)
                    if (latest.file !== manifest.file || latest.source !== manifest.source) throw new Error('ADDON_PROJECT_CHANGED')
                } else if ((await readDocument(session, document)) !== expectedContent) {
                    throw new Error('ADDON_PROJECT_CHANGED')
                }
                await fs.rename(temporaryFile, file)
                if (manifest) session.manifestSource = { ...manifest, source: output, content }
            } finally {
                if (temporaryFile) await fs.rm(temporaryFile, { force: true }).catch(() => undefined)
                session.writing = false
            }
        },
    )

    ipcMain.handle(MainEvents.ADDON_PROJECT_PICK_IMAGE, async (event, id: string, name: string) => {
        const session = getSession(id, event.sender.id)
        if (!['image', 'banner', 'libraryLogo'].includes(name)) throw new Error('INVALID_ADDON_PROJECT_IMAGE')
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: Object.keys(imageMime).map(extension => extension.slice(1)) }],
        })
        if (result.canceled || !result.filePaths[0]) return null
        getSession(id, event.sender.id)
        const source = result.filePaths[0]
        const extension = path.extname(source).toLowerCase()
        if (!imageMime[extension]) throw new Error('INVALID_ADDON_PROJECT_IMAGE')
        const relativePath = `Assets/${name}-${randomUUID()}${extension}`
        const target = await resolveProjectFile(session.root, `addon/${relativePath}`)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await resolveProjectFile(session.root, `addon/${relativePath}`)
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL)
        return relativePath
    })

    ipcMain.handle(MainEvents.ADDON_PROJECT_IMAGE_DATA_URL, async (event, id: string, relativePath: string) => {
        const session = getSession(id, event.sender.id)
        if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) return null
        const mime = imageMime[path.extname(relativePath).toLowerCase()]
        if (!mime) return null
        try {
            const staticRoot = await fs.realpath(await resolveProjectFile(session.root, 'addon'))
            const file = await resolveProjectFile(staticRoot, relativePath)
            return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`
        } catch {
            return null
        }
    })
}
