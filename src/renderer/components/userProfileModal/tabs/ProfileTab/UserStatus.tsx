import React from 'react';
import { MdOpenInNew } from 'react-icons/md';
import { getStatus, getStatusColor } from '../../../../utils/userStatus';
import * as styles from '../../userProfileModal.module.scss';

interface UserStatusProps {
    userProfile: any;
}

const UserStatus: React.FC<UserStatusProps> = ({ userProfile }) => {
    const statusColor = getStatusColor(userProfile);
    const statusColorDark = getStatusColor(userProfile, true);
    const statusUser = getStatus(userProfile, true);

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (
            userProfile.currentTrack &&
            userProfile.currentTrack.status === 'playing'
        ) {
            e.stopPropagation();
            const albumId = userProfile.currentTrack.albums[0].id;
            window.desktopEvents?.send(
                'open-external',
                `yandexmusic://album/${encodeURIComponent(albumId)}/track/${userProfile.currentTrack.realId}`
            );
        }
    };

    return (
        <div
            onClick={handleClick}
            style={
                {
                    '--statusColorProfile': statusColor,
                    '--statusColorDark': statusColorDark,
                    cursor:
                        userProfile.currentTrack &&
                        userProfile.currentTrack.status === 'playing'
                            ? 'pointer'
                            : 'default',
                } as React.CSSProperties
            }
            className={`${styles.userStatusInfo} ${
                userProfile.currentTrack &&
                userProfile.currentTrack.status === 'playing'
                    ? styles.hoverEffect
                    : ''
            }`}
        >
            {userProfile.currentTrack &&
            userProfile.currentTrack.status === 'playing'
                ? `Слушает: ${statusUser}`
                : statusUser}
            {userProfile.currentTrack &&
                userProfile.currentTrack.status === 'playing' && (
                    <MdOpenInNew size={20} />
                )}
        </div>
    );
};

export default UserStatus;
