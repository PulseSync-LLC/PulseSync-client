import React, { useCallback, useMemo } from 'react'
import { MdOpenInNew } from 'react-icons/md'
import { getStatus, getStatusColor } from '../../../../utils/userStatus'
import * as styles from '../../userProfileModal.module.scss'
import MainEvents from '../../../../../common/types/mainEvents'

interface UserStatusProps {
    userProfile: any
}

const UserStatus: React.FC<UserStatusProps> = ({ userProfile }) => {
    const statusColor = useMemo(() => getStatusColor(userProfile), [userProfile])
    const statusColorDark = useMemo(() => getStatusColor(userProfile, true), [userProfile])
    const statusUser = useMemo(() => getStatus(userProfile), [userProfile])
    const canOpenTrack = useMemo(
        () => Boolean(userProfile.currentTrack && userProfile.currentTrack.status === 'playing' && userProfile.currentTrack.trackSource !== 'UGC'),
        [userProfile.currentTrack],
    )

    const handleClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!canOpenTrack) return
            e.stopPropagation()
            const albumId = userProfile.currentTrack.albums[0].id
            window.desktopEvents?.send(
                MainEvents.OPEN_EXTERNAL,
                `yandexmusic://album/${encodeURIComponent(albumId)}/track/${userProfile.currentTrack.realId}`,
            )
        },
        [canOpenTrack, userProfile.currentTrack],
    )

    const statusText = useMemo(() => {
        if (userProfile.currentTrack && userProfile.currentTrack.status === 'playing') {
            if (typeof statusUser === 'string') {
                return `Слушает: ${statusUser}`
            }
            if (statusUser && typeof statusUser === 'object' && 'text' in statusUser && 'detail' in statusUser) {
                return (
                    <>
                        {statusUser.text}: {statusUser.detail}
                    </>
                )
            }
            return null
        }
        if (typeof statusUser === 'string') {
            return statusUser
        }
        if (statusUser && typeof statusUser === 'object' && 'text' in statusUser && 'detail' in statusUser) {
            return (
                <>
                    {statusUser.text} {statusUser.detail}
                </>
            )
        }
        return null
    }, [statusUser, userProfile.currentTrack])

    return (
        <div
            onClick={handleClick}
            style={
                {
                    '--statusColorProfile': statusColor,
                    '--statusColorDark': statusColorDark,
                    cursor: canOpenTrack ? 'pointer' : 'default',
                } as React.CSSProperties
            }
            className={`${styles.userStatusInfo} ${
                userProfile.currentTrack && userProfile.currentTrack.status === 'playing' ? styles.hoverEffect : ''
            }`}
        >
            {statusText}
            {userProfile.currentTrack && userProfile.currentTrack.status === 'playing' && <MdOpenInNew size={20} />}
        </div>
    )
}

export default UserStatus
