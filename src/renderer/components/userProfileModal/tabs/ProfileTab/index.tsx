import React, { useState, useContext } from 'react';
import LoadingIndicator from './LoadingIndicator';
import ErrorMessage from './ErrorMessage';
import UserStatus from './UserStatus';
import ProfileHeader from './ProfileHeader';
import FriendButton from './FriendButton';
import AchievementsSection from './AchievementsSection';
import userContext from '../../../../api/context/user.context';

interface ProfileTabProps {
    userProfile: any;
    loading: boolean;
    error: any;
    username: string;
}

const ProfileTab: React.FC<ProfileTabProps> = ({
    userProfile,
    loading,
    error,
    username,
}) => {
    const { user } = useContext(userContext);

    if (loading) {
        return <LoadingIndicator />;
    }
    if (!userProfile || !userProfile.id || userProfile.id === '-1') {
        return <ErrorMessage message="Пользователь не найден" />;
    }
    if (error) {
        return <ErrorMessage message={`Ошибка: ${String(error)}`} />;
    }

    return (
        <>
            <UserStatus userProfile={userProfile} />
            <ProfileHeader userProfile={userProfile} user={user}>
                <FriendButton
                    userProfile={userProfile}
                    user={user}
                    username={username}
                />
            </ProfileHeader>
            <AchievementsSection
                userProfile={userProfile}
                username={username}
            />
        </>
    );
};

export default ProfileTab;
