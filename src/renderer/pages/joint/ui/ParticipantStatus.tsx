import { useTranslation } from 'react-i18next'

import TooltipButton from '@shared/ui/tooltip_button'

import * as styles from '../joint.module.scss'

import type { ListeningParticipant } from '@common/listening/types'

interface Props {
    participant: ListeningParticipant
    connected: boolean
    playbackStatus: string
}

export default function ParticipantStatus({ participant, connected, playbackStatus }: Props) {
    const { t } = useTranslation()
    const status = t(
        !connected || participant.connection === 'reconnecting'
            ? 'pages.joint.participantConnection.reconnecting'
            : participant.following === 'following' && playbackStatus !== 'playing'
              ? 'pages.joint.ui.playback.' + playbackStatus
              : 'pages.joint.following.' + participant.following,
    )

    return (
        <TooltipButton as="span" side="top" tooltipText={status} className={styles.participantStatusTarget}>
            <span
                className={styles.participantStatus}
                data-warning={!connected || participant.connection === 'reconnecting' || participant.following === 'unavailable'}
                data-following={connected && participant.connection === 'online' && participant.following === 'following'}
                role="img"
                aria-label={status}
                tabIndex={0}
            />
        </TooltipButton>
    )
}
