import { DropdownMenu, type DropdownMenuItem } from '@pulsesync/uikit/navigation'
import { useTranslation } from 'react-i18next'
import { MdMoreHoriz, MdPersonRemove, MdSwapHoriz } from 'react-icons/md'

import TooltipButton from '@shared/ui/tooltip_button'

import * as styles from '../joint.module.scss'

import type { ListeningOperation, ListeningParticipant, ListeningRoom } from '@common/listening/types'

interface Props {
    participant: ListeningParticipant
    room: ListeningRoom
    userId: string | null
    connected: boolean
    busy: boolean
    moderationAvailable: boolean
    rttMs: number | null
    run: (operation: ListeningOperation) => Promise<void>
}

export default function ParticipantActions({ participant, room, userId, connected, busy, moderationAvailable, rttMs, run }: Props) {
    const { t } = useTranslation()
    const ping = connected && participant.connection === 'online' ? rttMs : null
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
            <TooltipButton
                as="span"
                side="top"
                tooltipText={`${t('pages.joint.diagnostics.rtt')}: ${ping === null ? t('pages.joint.diagnostics.unknown') : `${ping} ${t('pages.joint.diagnostics.ms')}`}`}
                className={styles.participantPing}
            >
                <span tabIndex={0}>{ping === null ? '−' : `${ping} ${t('pages.joint.diagnostics.ms')}`}</span>
            </TooltipButton>
            {items.length > 0 && (
                <TooltipButton as="span" side="top" tooltipText={t('pages.joint.ui.participantActions')}>
                    <DropdownMenu items={items} placement="bottom-end">
                        <button type="button" className={styles.participantMenu} aria-label={t('pages.joint.ui.participantActions')}>
                            <MdMoreHoriz size={22} aria-hidden="true" />
                        </button>
                    </DropdownMenu>
                </TooltipButton>
            )}
        </div>
    )
}
