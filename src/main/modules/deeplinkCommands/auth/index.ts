import { extractBrowserAuthCredentialsFromUrl } from '../../auth/browserAuth'
import type { DeeplinkCommandContext } from '..'

export default async function authCommand(context: DeeplinkCommandContext): Promise<boolean> {
    const credentials = extractBrowserAuthCredentialsFromUrl(context.rawUrl)
    if (!credentials) return false

    await context.handleBrowserAuth(credentials, context.window)
    return true
}
