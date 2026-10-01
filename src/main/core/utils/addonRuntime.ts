import * as fs from 'original-fs'

import logger from '../../shared/logger'
import { resolveExistingFileInsideBase } from './addonPaths'
import { validateWebHostAddonRuntime } from './webHostAddonRuntime'

type RuntimeMetadata = { type?: unknown; css?: unknown; script?: unknown; id?: unknown }

export async function classifyAddonRuntime(directory: string, metadata: RuntimeMetadata): Promise<'legacy' | 'style' | 'isolated'> {
    try {
        if (metadata.type === 'theme' && typeof metadata.css === 'string') {
            const cssPath = resolveExistingFileInsideBase(directory, metadata.css)
            const css = cssPath ? await fs.promises.readFile(cssPath, 'utf8') : ''
            const declaredScript = typeof metadata.script === 'string' && metadata.script.trim() ? metadata.script : null
            const scriptPath = declaredScript ? resolveExistingFileInsideBase(directory, declaredScript) : null
            const script = scriptPath ? await fs.promises.readFile(scriptPath, 'utf8') : ''
            if (css.trim() && css.trim() !== '{}' && (!declaredScript || scriptPath) && !script.trim()) return 'style'
        } else if (metadata.type === 'web-addon' && typeof metadata.script === 'string') {
            const scriptPath = resolveExistingFileInsideBase(directory, metadata.script)
            if (scriptPath) {
                const validation = validateWebHostAddonRuntime(await fs.promises.readFile(scriptPath, 'utf8'))
                if (validation.ok) return 'isolated'
                logger.main.warn(
                    `[PulseSync Addons] Blocked isolated addon ${String(metadata.id || directory)}: ${validation.category}: ${validation.reason}`,
                )
            }
        }
    } catch (error) {
        logger.main.warn(`Addons: failed to classify runtime in ${directory}: ${String(error)}`)
    }
    return 'legacy'
}
