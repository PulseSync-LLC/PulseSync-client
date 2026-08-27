import React, { useContext } from 'react'

import { useTranslation } from 'react-i18next'

import AchievementsSection from '@widgets/userProfileModal/tabs/ProfileTab/AchievementsSection'
import ErrorMessage from '@widgets/userProfileModal/tabs/ProfileTab/ErrorMessage'
import FriendButton from '@widgets/userProfileModal/tabs/ProfileTab/FriendButton'
import LoadingIndicator from '@widgets/userProfileModal/tabs/ProfileTab/LoadingIndicator'
import ProfileHeader from '@widgets/userProfileModal/tabs/ProfileTab/ProfileHeader'
import UserStatus from '@widgets/userProfileModal/tabs/ProfileTab/UserStatus'
import userContext from '@entities/user/model/context'

interface ProfileTabProps {
    userProfile: any
    loading: boolean
    error: any
    profileName: string
}

const ProfileTab: React.FC<ProfileTabProps> = ({ userProfile, loading, error, profileName }) => {
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
            <ProfileHeader userProfile={userProfile}>
                <FriendButton userProfile={userProfile} user={user} profileName={profileName} />
            </ProfileHeader>
            <AchievementsSection userProfile={userProfile} profileName={profileName} />
        </>
    )
}

export default ProfileTab
