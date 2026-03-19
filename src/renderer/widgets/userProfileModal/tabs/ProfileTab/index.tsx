import React, { useContext } from 'react'
import LoadingIndicator from '@widgets/userProfileModal/tabs/ProfileTab/LoadingIndicator'
import ErrorMessage from '@widgets/userProfileModal/tabs/ProfileTab/ErrorMessage'
import UserStatus from '@widgets/userProfileModal/tabs/ProfileTab/UserStatus'
import ProfileHeader from '@widgets/userProfileModal/tabs/ProfileTab/ProfileHeader'
import FriendButton from '@widgets/userProfileModal/tabs/ProfileTab/FriendButton'
import AchievementsSection from '@widgets/userProfileModal/tabs/ProfileTab/AchievementsSection'
import userContext from '@entities/user/model/context'
import { useTranslation } from 'react-i18next'

interface ProfileTabProps {
    userProfile: any
    loading: boolean
    error: any
    username: string
}

const ProfileTab: React.FC<ProfileTabProps> = ({ userProfile, loading, error, username }) => {
    const { user } = useContext(userContext)
    const { t } = useTranslation()

    if (loading) {
        return <LoadingIndicator />
    }
    if (!userProfile || !userProfile.id || userProfile.id === '-1') {
        return <ErrorMessage message={t('profile.errors.userNotFound')} />
    }
    if (error) {
        return <ErrorMessage message={t('profile.errors.withMessage', { message: String(error) })} />
    }

    return (
        <>
            <UserStatus userProfile={userProfile} />
            <ProfileHeader userProfile={userProfile} user={user}>
                <FriendButton userProfile={userProfile} user={user} username={username} />
            </ProfileHeader>
            <AchievementsSection userProfile={userProfile} username={username} />
        </>
    )
}

export default ProfileTab
