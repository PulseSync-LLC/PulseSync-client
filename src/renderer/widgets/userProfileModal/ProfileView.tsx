import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useQuery } from '@apollo/client/react'
import { useTranslation } from 'react-i18next'

import FriendsTab from '@widgets/userProfileModal/tabs/FriendsTab'
import ProfileTab from '@widgets/userProfileModal/tabs/ProfileTab'
import SettingsTab from '@widgets/userProfileModal/tabs/SettingsTab'
import getMeProfileQuery from '@entities/user/api/getMeProfile.query'
import getUserProfileQuery from '@entities/user/api/getUserProfile.query'
import userContext from '@entities/user/model/context'
import userInitials from '@entities/user/model/user.initials'
import { isProfileSlugForUser } from '@shared/lib/profileSlug'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'

import * as styles from '@widgets/userProfileModal/profileView.module.scss'

import type { ExtendedUser } from '@entities/user/model/extendUser.interface'

type ProfileViewProps = {
    profileName: string
}

export default function ProfileView({ profileName }: ProfileViewProps) {
    const { user, allAchievements, socketConnected } = useContext(userContext)
    const { t } = useTranslation()
    const [activeTab] = useState<'profile' | 'friends' | 'settings'>('profile')

    const isSelf = useMemo(() => isProfileSlugForUser(profileName, user), [profileName, user])
    const queryDoc = useMemo(() => (isSelf ? getMeProfileQuery : getUserProfileQuery), [isSelf])
    const variables = useMemo(() => (isSelf ? undefined : { name: profileName }), [isSelf, profileName])

    const { data, loading, error, refetch } = useQuery<any>(queryDoc, {
        variables,
        fetchPolicy: 'no-cache',
        skip: !profileName,
    })

    const payload: ExtendedUser | null = useMemo(() => {
        if (!data) return null
        return (isSelf ? data.getMeProfile : data.findUserByName) || null
    }, [data, isSelf])

    const liveAchievementsSignature = useMemo(() => {
        if (!isSelf || user.id === '-1') return null

        return JSON.stringify({
            levelInfoV2: user.levelInfoV2 ?? null,
            userAchievements: Array.isArray(user.userAchievements) ? user.userAchievements : [],
        })
    }, [isSelf, user.id, user.levelInfoV2, user.userAchievements])

    const liveAchievementsSignatureRef = useRef<string | null>(null)

    useEffect(() => {
        if (!isSelf || !payload?.id || loading || !liveAchievementsSignature) {
            liveAchievementsSignatureRef.current = liveAchievementsSignature
            return
        }

        if (liveAchievementsSignatureRef.current === null) {
            liveAchievementsSignatureRef.current = liveAchievementsSignature
            return
        }

        if (liveAchievementsSignatureRef.current === liveAchievementsSignature) return

        liveAchievementsSignatureRef.current = liveAchievementsSignature
        void refetch(variables)
    }, [isSelf, liveAchievementsSignature, loading, payload?.id, refetch, variables])

    const livePayload: ExtendedUser | null = useMemo(() => {
        if (!payload || !isSelf || user.id === '-1' || payload.id !== user.id) return payload

        const hasLiveAchievementData =
            (Array.isArray(user.userAchievements) && user.userAchievements.length > 0) || Number(user.levelInfoV2?.totalPoints || 0) > 0
        const liveStatus = socketConnected ? 'online' : user.status || payload.status
        const liveLastOnline = user.lastOnline || payload.lastOnline

        return {
            ...payload,
            username: user.username || payload.username,
            nickname: user.nickname || payload.nickname,
            avatarHash: user.avatarHash || payload.avatarHash,
            avatarType: user.avatarType || payload.avatarType,
            bannerHash: user.bannerHash || payload.bannerHash,
            bannerType: user.bannerType || payload.bannerType,
            badges: Array.isArray(user.badges) ? user.badges : payload.badges,
            userAchievements: hasLiveAchievementData && Array.isArray(user.userAchievements) ? user.userAchievements : payload.userAchievements,
            levelInfoV2: hasLiveAchievementData && user.levelInfoV2 && typeof user.levelInfoV2 === 'object' ? user.levelInfoV2 : payload.levelInfoV2,
            status: liveStatus,
            lastOnline: liveLastOnline,
            currentTrack: user.currentTrack ?? payload.currentTrack,
            subscription: user.subscription ?? payload.subscription ?? null,
            hasSupporterBadge: user.hasSupporterBadge,
            active: user.active,
        }
    }, [isSelf, payload, socketConnected, user])

    const userProfile = useMemo<ExtendedUser>(() => {
        if (!livePayload) return userInitials
        return {
            ...livePayload,
            allAchievements: allAchievements || [],
        }
    }, [allAchievements, livePayload])

    const profileLoading = loading && (!livePayload || !livePayload.id || livePayload.id === '-1')

    const normalizedError: string | null = useMemo(() => {
        if (error) return error.message || t('profile.errors.loadFailed')
        if (!loading && profileName && !payload) return t('profile.errors.userNotFound')
        return null
    }, [error, loading, payload, profileName, t])

    return (
        <Scrollbar className={styles.scrollArea} classNameInner={styles.scrollAreaInner}>
            <div className={styles.content}>
                {activeTab === 'profile' && (
                    <ProfileTab userProfile={userProfile} loading={profileLoading} error={normalizedError} profileName={profileName} />
                )}
                {activeTab === 'friends' && <FriendsTab userProfile={userProfile} loading={profileLoading} error={normalizedError} />}
                {activeTab === 'settings' && <SettingsTab userProfile={userProfile} loading={profileLoading} error={normalizedError} />}
            </div>
        </Scrollbar>
    )
}
