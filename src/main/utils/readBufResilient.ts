import path from 'node:path'
import fs, { promises as fsp } from 'original-fs'

export async function readBufResilient(inputPath: string): Promise<Buffer> {
    if (!inputPath) throw new Error('empty path')

    const candidates: string[] = []
    if (inputPath.startsWith('file://')) {
        try {
            const url = new URL(inputPath)
            candidates.push(path.normalize(decodeURI(url.pathname)))
        } catch {}
    }

    const normalized = path.normalize(inputPath)
    candidates.push(normalized)
    if (process.platform === 'win32') {
        candidates.push(normalized.replace(/\//g, '\\'))
        candidates.push(normalized.replace(/\\/g, '/'))
        if (!normalized.startsWith('\\\\?\\')) candidates.push(`\\\\?\\${normalized}`)
    }
    try {
        candidates.push(normalized.normalize('NFC'))
    } catch {}
    try {
        candidates.push(normalized.normalize('NFD'))
    } catch {}
    candidates.push(normalized.replace(/^["']|["']$/g, ''))

    let lastError: unknown
    for (const candidate of new Set(candidates)) {
        try {
            return await fsp.readFile(candidate)
        } catch (error) {
            lastError = error
            try {
                return await new Promise<Buffer>((resolve, reject) => {
                    fs.readFile(candidate, (readError, data) => (readError ? reject(readError) : resolve(data as unknown as Buffer)))
                })
            } catch (fallbackError) {
                lastError = fallbackError
            }
        }
    }

    throw lastError ?? new Error('Unable to read file')
}
