import { DropdownMenu, type DropdownMenuItem } from '@pulsesync/uikit/navigation'
import { useTranslation } from 'react-i18next'
import { MdMoreHoriz, MdPersonRemove, MdSwapHoriz } from 'react-icons/md'

import * as styles from '../joint.module.scss'

import type { ListeningOperation, ListeningParticipant, ListeningRoom } from '@common/listening/types'

interface Props {
    participant: ListeningParticipant
    room: ListeningRoom
    userId: string | null
    connected: boolean
    busy: boolean
    moderationAvailable: boolean
    playbackStatus: string
    run: (operation: ListeningOperation) => Promise<void>
}

export default function ParticipantActions({ participant, room, userId, connected, busy, moderationAvailable, playbackStatus, run }: Props) {
    const { t } = useTranslation()
    const status = t(
        !connected || participant.connection === 'reconnecting'
            ? 'pages.joint.participantConnection.reconnecting'
            : participant.following === 'following' && playbackStatus !== 'playing'
              ? 'pages.joint.ui.playback.' + playbackStatus
              : 'pages.joint.following.' + participant.following,
    )
    const items: DropdownMenuItem[] = []
    const canModerate = moderationAvailable && (room.ownerUserId === userId || room.hostUserId === userId)
    if (canModerate && participant.userId !== room.hostUserId)
        items.push({
            key: 'transfer',
            label: t(participant.userId === userId ? 'pages.joint.accept' : 'pages.joint.offer'),
            icon: <MdSwapHoriz />,
            disabled: busy || !connected || participant.connection !== 'online',
            onClick: () => void run({ type: 'transfer', userId: participant.userId }),
        })
    if (canModerate && participant.userId !== userId && participant.userId !== room.ownerUserId)
        items.push({
            key: 'kick',
            label: t('pages.joint.ui.kickParticipant'),
            icon: <MdPersonRemove />,
            disabled: busy || !connected,
            onClick: () => void run({ type: 'kick', userId: participant.userId }),
        })

    return (
        <div className={styles.participantActions}>
            <span
                className={styles.participantStatus}
                data-warning={!connected || participant.connection === 'reconnecting' || participant.following === 'unavailable'}
                data-following={connected && participant.connection === 'online' && participant.following === 'following'}
                title={status}
                role="img"
                aria-label={status}
            />
            {items.length > 0 && (
                <DropdownMenu items={items} placement="bottom-end">
                    <button type="button" className={styles.participantMenu} aria-label={t('pages.joint.ui.participantActions')}>
                        <MdMoreHoriz size={22} aria-hidden="true" />
                    </button>
                </DropdownMenu>
            )}
        </div>
    )
}
