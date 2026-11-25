import { randomUUID } from 'node:crypto'

import { listeningUuid, record } from '@common/listening/validation'

import { currentAuthSessionId, getAuthToken, isCurrentAuthToken } from '../auth/session'
import mainHttpClient from '../http/client'
import { getState } from '../state'

export class ListeningAccess {
    private clientId = ''
    sessionId(): string {
        return currentAuthSessionId()
    }
    async initialize(): Promise<void> {
        await getAuthToken()
        if (this.clientId) return
        const saved = getState().get('listening.clientId')
        this.clientId = listeningUuid(saved) ? saved : randomUUID()
        getState().set('listening.clientId', this.clientId)
    }
    async configuration(): Promise<Record<string, unknown>> {
        const token = await getAuthToken()
        const response = await mainHttpClient.get<unknown>('/auth/listening/config', { authToken: token, timeoutMs: 5000 })
        if (!response.ok || !isCurrentAuthToken(token)) throw new Error('ACCESS_UNAVAILABLE')
        return record(response.data)
    }
    async ticket(sessionId: string) {
        const token = await getAuthToken()
        if (!token || sessionId !== this.sessionId()) throw new Error('AUTH_CHANGED')
        const requestedAt = performance.now()
        const response = await mainHttpClient.post<unknown>('/auth/listening/ticket', {
            authToken: token,
            body: { clientId: this.clientId },
            timeoutMs: 5000,
        })

        const ticket = record(response.data)
        const expiresAt = ticket.expiresAt
        let issuedAt = NaN
        try {
            const payload = record(JSON.parse(Buffer.from(String(ticket.ticket).split('.')[1] ?? '', 'base64url').toString('utf8')))
            issuedAt = Number(payload.iat) * 1000
        } catch {
            /* The service verifies the signature; the client only schedules renewal. */
        }
        const serverDate = Date.parse(response.headers.date ?? '')
        const serverNow = Number.isFinite(serverDate) ? Math.max(serverDate, issuedAt) : issuedAt
        const lifetimeMs = Number(expiresAt) - issuedAt
        const remainingMs = Number(expiresAt) - serverNow - (performance.now() - requestedAt) - 1000
        const checks = {
            authTokenValid: isCurrentAuthToken(token),
            sessionIdMatches: sessionId === this.sessionId(),
            responseOk: response.ok,
            ticketIsString: typeof ticket.ticket === 'string' && ticket.ticket.length > 0 && ticket.ticket.length <= 4096,
            expiresAtIsInteger: Number.isSafeInteger(expiresAt),
            ticketExpirationValid: Number.isSafeInteger(issuedAt) && lifetimeMs > 0 && lifetimeMs <= 300000,
            ticketNotExpired: remainingMs > 0,
        }

        if (Object.values(checks).some(passed => !passed)) throw new Error('ACCESS_UNAVAILABLE')
        return {
            ticket: ticket.ticket as string,
            expiresAt: Number(expiresAt),
            renewAtMonotonicMs: performance.now() + Math.max(1000, remainingMs - 60000),
        }
    }
}
