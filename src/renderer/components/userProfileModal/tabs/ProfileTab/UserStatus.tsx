import React from 'react'
import { MdOpenInNew } from 'react-icons/md'
import { getStatus, getStatusColor } from '../../../../utils/userStatus'
import * as styles from '../../userProfileModal.module.scss'
import MainEvents from '../../../../../common/types/mainEvents'

interface UserStatusProps {
    userProfile: any
}

const UserStatus: React.FC<UserStatusProps> = ({ userProfile }) => {
    const statusColor = getStatusColor(userProfile)
    const statusColorDark = getStatusColor(userProfile, true)
    const statusUser = getStatus(userProfile)

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (userProfile.currentTrack && userProfile.currentTrack.status === 'playing' && userProfile.currentTrack.trackSource !== 'UGC') {
            e.stopPropagation()
            const albumId = userProfile.currentTrack.albums[0].id
            window.desktopEvents?.send(
                MainEvents.OPEN_EXTERNAL,
                `yandexmusic://album/${encodeURIComponent(albumId)}/track/${userProfile.currentTrack.realId}`,
            )
        }
    }

    return (
        <div
            onClick={handleClick}
            style={
                {
                    '--statusColorProfile': statusColor,
                    '--statusColorDark': statusColorDark,
                    cursor:
                        userProfile.currentTrack && userProfile.currentTrack.status === 'playing' && userProfile.currentTrack.trackSource !== 'UGC'
                            ? 'pointer'
                            : 'default',
                } as React.CSSProperties
            }
            className={`${styles.userStatusInfo} ${
                userProfile.currentTrack && userProfile.currentTrack.status === 'playing' ? styles.hoverEffect : ''
            }`}
        >
            {(() => {
                if (userProfile.currentTrack && userProfile.currentTrack.status === 'playing') {
                    if (typeof statusUser === 'string') {
                        return `Слушает: ${statusUser}`
                    } else if (statusUser && typeof statusUser === 'object' && 'text' in statusUser && 'detail' in statusUser) {
                        return (
                            <>
                                {statusUser.text}: {statusUser.detail}
                            </>
                        )
                    }
                } else {
                    if (typeof statusUser === 'string') {
                        return statusUser
                    } else if (statusUser && typeof statusUser === 'object' && 'text' in statusUser && 'detail' in statusUser) {
                        return (
                            <>
                                {statusUser.text} {statusUser.detail}
                            </>
                        )
                    }
                }
                return null
            })()}
            {userProfile.currentTrack && userProfile.currentTrack.status === 'playing' && <MdOpenInNew size={20} />}
        </div>
    )
}

export default UserStatus
