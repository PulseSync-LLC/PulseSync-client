import { randomUUID } from 'node:crypto'

import { listeningUuid, record } from '@common/listening/validation'

import type { ListeningConnection } from './connection'
import type { HostSource } from './hostSource'
import type { ListeningOperation } from '@common/listening/types'

export async function performRoomOperation(
    connection: ListeningConnection,
    host: HostSource,
    operation: ListeningOperation,
    leave: () => void,
): Promise<{ ok: true; invitation?: string }> {
    const room = connection.room
    const commandId = randomUUID()
    if (operation.type === 'create' || operation.type === 'join') {
        if (room) throw new Error('ALREADY_IN_ROOM')
        let payload: unknown = { commandId }
        if (operation.type === 'join') {
            const code = operation.invitation.trim().toUpperCase().replace(/[\s-]/gu, '')
            if (/^[2-9A-HJ-NP-Z]{12}$/u.test(code)) {
                payload = { commandId, code }
            } else {
                let invite: URL
                try {
                    invite = new URL(operation.invitation.trim())
                } catch {
                    throw new Error('INVITE_INVALID')
                }
                const roomId = invite.pathname.slice(1),
                    inviteToken = invite.hash.slice(1)
                if (
                    invite.protocol !== 'pulsesync:' ||
                    invite.hostname !== 'listen' ||
                    !listeningUuid(roomId) ||
                    !/^[\w-]{43}$/u.test(inviteToken) ||
                    invite.search
                )
                    throw new Error('INVITE_INVALID')
                payload = { roomId, commandId, inviteToken }
            }
        }
        const result = record(await connection.request(operation.type === 'create' ? 'room:create' : 'room:join', payload, true))
        connection.accept(result.snapshot, true)
        host.reset()
    } else {
        if (!room) throw new Error('NOT_IN_ROOM')
        if (operation.type === 'invite') {
            const invite = record(
                await connection.request(
                    'room:invite:create',
                    { roomId: room.roomId, commandId, expectedRevision: room.revision, ttlSeconds: 600 },
                    true,
                ),
            )
            if (typeof invite.code !== 'string' || !/^[2-9A-HJ-NP-Z]{12}$/u.test(invite.code)) throw new Error('CAPABILITY_UNAVAILABLE')
            return { ok: true, invitation: invite.code.match(/.{4}/gu)!.join('-') }
        }
        if (operation.type === 'leave' || operation.type === 'close') {
            await connection.request(
                operation.type === 'leave' ? 'room:leave' : 'room:close',
                { roomId: room.roomId, commandId, ...(operation.type === 'close' ? { expectedRevision: room.revision } : {}) },
                true,
            )
            leave()
        } else if (operation.type === 'offer') {
            await connection.request(
                'room:host:offer',
                { roomId: room.roomId, commandId, expectedRevision: room.revision, epoch: room.epoch, targetUserId: operation.userId },
                true,
            )
        } else if (operation.type === 'accept' || operation.type === 'decline') {
            if (!room.hostOffer) throw new Error('TRANSFER_INVALID')
            const result = record(
                await connection.request(
                    operation.type === 'accept' ? 'room:host:accept' : 'room:host:decline',
                    { roomId: room.roomId, commandId, epoch: room.epoch, offerId: room.hostOffer.offerId },
                    true,
                ),
            )
            if (operation.type === 'accept') connection.accept(result.snapshot, true)
        } else if (operation.type === 'control') {
            await connection.request(
                'room:playback:command',
                {
                    roomId: room.roomId,
                    commandId,
                    expectedRevision: room.revision,
                    epoch: room.epoch,
                    controllerId: room.controller?.controllerId,
                    action: operation.action,
                },
                true,
            )
        }
    }
    return { ok: true }
}
