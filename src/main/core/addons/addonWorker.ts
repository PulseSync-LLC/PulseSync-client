import { parentPort } from 'node:worker_threads'

import { extractAddonArchive } from './archive'
import { sanitizeLegacyScript } from './legacyScriptValidation'
import { validateWebHostAddonRuntime } from './webHostAddonValidation'

import type { AddonWorkerRequestMessage, AddonWorkerResponseMessage } from './workerProtocol'

if (!parentPort) throw new Error('Addon worker requires a parent port')

parentPort.on('message', ({ id, request }: AddonWorkerRequestMessage) => {
    let response: AddonWorkerResponseMessage
    try {
        if (request.operation === 'validate') {
            const validation = validateWebHostAddonRuntime(request.content)
            response = {
                id,
                ok: true,
                result: { operation: 'validate', validation: validation.ok ? { ok: true, apiVersion: validation.apiVersion } : validation },
            }
        } else if (request.operation === 'sanitize') {
            response = { id, ok: true, result: { operation: 'sanitize', blocked: sanitizeLegacyScript(request.content) !== request.content } }
        } else if (request.operation === 'extract') {
            response = { id, ok: true, result: { operation: 'extract', packageHash: extractAddonArchive(request.archivePath, request.stagingDir) } }
        } else {
            throw new Error('Unknown addon worker operation')
        }
    } catch (error) {
        response = {
            id,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            invalidArchive: (error as Error)?.name === 'InvalidAddonArchiveError',
        }
    }
    parentPort!.postMessage(response)
})
