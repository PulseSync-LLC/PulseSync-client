import { extractInstallModUpdateFromDeepLink } from '../../mod/installModUpdateFrom'
import type { DeeplinkCommandContext } from '..'

const PATCH_TYPE_FROM_MOD = 'from_mod'
const normalizeAction = (value: string): string => value.trim().replace(/-/g, '_').toLowerCase()

export default async function patchCommand(context: DeeplinkCommandContext): Promise<boolean> {
    const patchType = context.args[0]
    if (!patchType || normalizeAction(patchType) !== PATCH_TYPE_FROM_MOD) return false

    const asarPath = extractInstallModUpdateFromDeepLink(context.rawUrl)
    if (!asarPath) return false

    await context.handleInstallModUpdateFrom(asarPath, context.window)
    return true
}
