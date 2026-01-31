import { DiscordState } from './types/rpcTypes'
import { readDiscord } from './state'
import { t } from '../../i18n'

export function isTimeoutErrorMessage(msg: string | undefined) {
    if (!msg) return false
    return /timed?\s*out|timeout|ETIMEDOUT/i.test(msg)
}

export async function handleRpcError(e: Error): Promise<string> {
    const state = await readDiscord()
    if (state !== DiscordState.SUCCESS) {
        return t(`main.discordRpc.states.${state}`)
    }
    return isTimeoutErrorMessage(e?.message) ? t('main.discordRpc.timeoutRateLimit') : e.message
}
