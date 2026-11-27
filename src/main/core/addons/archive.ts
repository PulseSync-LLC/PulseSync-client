import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

import AdmZip from 'adm-zip'

import { MAX_ADDON_ARCHIVE_BYTES } from './workerProtocol'

class InvalidAddonArchiveError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'InvalidAddonArchiveError'
    }
}

const normalizeArchiveEntryName = (entryName: string): string | null => {
    const rawName = String(entryName || '').replace(/\\/g, '/')
    if (!rawName || rawName.includes('\0') || rawName.startsWith('/') || rawName.startsWith('//') || /^[a-zA-Z]:/.test(rawName)) return null
    const normalizedName = path.posix.normalize(rawName)
    if (
        !normalizedName ||
        normalizedName === '.' ||
        normalizedName === '..' ||
        normalizedName.startsWith('../') ||
        path.posix.isAbsolute(normalizedName)
    )
        return null
    return normalizedName
}

export function extractAddonArchive(archivePath: string, stagingDir: string): string {
    // The parent owns this private directory and commits it only after all validation succeeds.
    if (!path.isAbsolute(archivePath) || !path.isAbsolute(stagingDir)) throw new Error('Addon archive paths must be absolute')
    if (!lstatSync(stagingDir).isDirectory() || lstatSync(stagingDir).isSymbolicLink()) throw new Error('Invalid addon staging directory')
    if (lstatSync(archivePath).size > MAX_ADDON_ARCHIVE_BYTES) throw new InvalidAddonArchiveError('Addon archive is too large')
    const archive = readFileSync(archivePath)
    if (archive.byteLength > MAX_ADDON_ARCHIVE_BYTES) throw new InvalidAddonArchiveError('Addon archive is too large')
    const zip = new AdmZip(archive)
    let hasRootMetadata = false
    let totalUncompressedSize = 0
    for (const entry of zip.getEntries()) {
        const name = normalizeArchiveEntryName(entry.entryName)
        if (!name) throw new InvalidAddonArchiveError(`Unsafe addon archive entry: ${entry.entryName}`)
        if (!entry.isDirectory && name === 'metadata.json') hasRootMetadata = true
        totalUncompressedSize += Number((entry.header as { size?: number }).size) || 0
        if (totalUncompressedSize > MAX_ADDON_ARCHIVE_BYTES) throw new InvalidAddonArchiveError('Unpacked addon archive is too large')
    }
    if (!hasRootMetadata) throw new InvalidAddonArchiveError('Missing metadata.json in addon archive')
    zip.extractAllTo(stagingDir, true)
    return createHash('sha256').update(archive).digest('hex')
}
