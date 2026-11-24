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
        const response = await mainHttpClient.post<unknown>('/auth/listening/ticket', {
            authToken: token,
            body: { clientId: this.clientId },
            timeoutMs: 5000,
        })
        const ticket = record(response.data)
        if (
            !isCurrentAuthToken(token) ||
            sessionId !== this.sessionId() ||
            !response.ok ||
            typeof ticket.ticket !== 'string' ||
            !ticket.ticket ||
            ticket.ticket.length > 4096 ||
            !Number.isSafeInteger(ticket.expiresAt) ||
            Number(ticket.expiresAt) <= Date.now() ||
            Number(ticket.expiresAt) > Date.now() + 300000
        )
            throw new Error('ACCESS_UNAVAILABLE')
        return { ticket: ticket.ticket, expiresAt: Number(ticket.expiresAt) }
    }
}
