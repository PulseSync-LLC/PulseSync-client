import type { ClaimActiveAppResultV1, StartResultV1 } from './contracts'

type PackagedLaunchRouteInput = {
    handoffId?: string
    isPackaged: boolean
    launchReservationId?: string
    platform: NodeJS.Platform
}

export function requiresCanonicalStart(input: PackagedLaunchRouteInput): boolean {
    return input.isPackaged && input.platform !== 'darwin' && !input.launchReservationId && !input.handoffId
}

export function claimShouldUseCanonicalStart(claim: ClaimActiveAppResultV1): boolean {
    return claim.state === 'blocked' && (claim.block.code === 'different-live-lease' || claim.block.code === 'missing-launch-reservation')
}

export function canonicalStartSucceeded(result: StartResultV1): boolean {
    return result.state === 'enqueued' || result.state === 'launched' || result.state === 'reserved'
}

export function normalizeSecondInstanceArgv(commandLine: string[], isPackaged: boolean): string[] {
    if (!isPackaged) {
        return [...commandLine]
    }
    const payload = commandLine.slice(1)
    const separator = payload.indexOf('--')
    if (separator >= 0) {
        return payload.slice(separator + 1)
    }
    return payload.filter(argument => !argument.startsWith('--'))
}
