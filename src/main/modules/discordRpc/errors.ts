import { DiscordState } from './types/rpcTypes'
import { readDiscord } from './state'

export function isTimeoutErrorMessage(msg: string | undefined) {
    if (!msg) return false
    return /timed?\s*out|timeout|ETIMEDOUT/i.test(msg)
}

export async function handleRpcError(e: Error): Promise<string> {
    const state = await readDiscord()
    if (state !== DiscordState.SUCCESS) {
        return state
    }
    return isTimeoutErrorMessage(e?.message)
        ? 'Тайм-аут подключения. Возможны рейт-лимиты от Discord. Если не показывается активность, то попробуйте снова через 10–15 минут.'
        : e.message
}
