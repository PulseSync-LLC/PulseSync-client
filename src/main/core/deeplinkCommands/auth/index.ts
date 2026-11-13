import { exchangeBrowserAuthCode, extractBrowserAuthCodeFromUrl } from '../../auth/browserAuth'

import type { DeeplinkCommandContext } from '..'

export default async function authCommand(context: DeeplinkCommandContext): Promise<boolean> {
    const code = extractBrowserAuthCodeFromUrl(context.rawUrl)
    if (!code) return true

    const credentials = await exchangeBrowserAuthCode(code)
    if (!credentials) return true

    await context.handleBrowserAuth(credentials, context.window)
    return true
}
