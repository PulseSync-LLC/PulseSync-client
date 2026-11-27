import { createHash } from 'node:crypto'

import { validateAddonInWorker } from '../addons/addonWorkerClient'

import type { WebHostAddonValidationResult } from '../addons/webHostAddonValidation'
import type { AddonValidationOutcome } from '../addons/workerProtocol'

export type { WebHostAddonValidationCategory, WebHostAddonValidationResult } from '../addons/webHostAddonValidation'
export { SUPPORTED_WEB_HOST_API_VERSION } from '../addons/workerProtocol'

const MAX_CACHED_VALIDATIONS = 32
const validationCache = new Map<string, AddonValidationOutcome>()
const pendingValidations = new Map<string, Promise<AddonValidationOutcome>>()

export async function validateWebHostAddonRuntime(content: string): Promise<WebHostAddonValidationResult> {
    if (!content.trim()) return { ok: false, category: 'empty-code', reason: 'bundle is empty' }
    const key = createHash('sha256').update(content).digest('hex')
    const cached = validationCache.get(key)
    if (cached) {
        validationCache.delete(key)
        validationCache.set(key, cached)
        return cached.ok ? { ...cached, code: content } : { ...cached }
    }
    let pending = pendingValidations.get(key)
    if (!pending) {
        pending = validateAddonInWorker(content)
            .then(result => {
                if (validationCache.size >= MAX_CACHED_VALIDATIONS) {
                    const oldest = validationCache.keys().next().value
                    if (oldest !== undefined) validationCache.delete(oldest)
                }
                validationCache.set(key, result)
                return result
            })
            .finally(() => {
                pendingValidations.delete(key)
            })
        pendingValidations.set(key, pending)
    }
    const result = await pending
    return result.ok ? { ...result, code: content } : { ...result }
}
