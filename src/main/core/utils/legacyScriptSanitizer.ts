import { createHash } from 'node:crypto'

import { checkLegacyScriptInWorker } from '../addons/addonWorkerClient'

const MAX_CACHED_SCRIPTS = 32
const cached = new Map<string, boolean>()
const pending = new Map<string, Promise<boolean>>()

export async function sanitizeLegacyScript(content: string): Promise<string> {
    if (!content.trim()) return content
    const key = createHash('sha256').update(content).digest('hex')
    if (cached.has(key)) {
        const blocked = cached.get(key)!
        cached.delete(key)
        cached.set(key, blocked)
        return blocked ? '' : content
    }
    let request = pending.get(key)
    if (!request) {
        request = checkLegacyScriptInWorker(content)
            .then(blocked => {
                if (cached.size >= MAX_CACHED_SCRIPTS) {
                    const oldest = cached.keys().next().value
                    if (oldest !== undefined) cached.delete(oldest)
                }
                cached.set(key, blocked)
                return blocked
            })
            .finally(() => {
                pending.delete(key)
            })
        pending.set(key, request)
    }
    return (await request) ? '' : content
}
