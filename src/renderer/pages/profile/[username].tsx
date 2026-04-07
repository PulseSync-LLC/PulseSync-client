import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@apollo/client/react'

import getUserProfileQuery from '@entities/user/api/getUserProfile.query'
import getMeProfileQuery from '@entities/user/api/getMeProfile.query'
import userInitials from '@entities/user/model/user.initials'

import PageLayout from '@widgets/layout/PageLayout'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'

import ProfileTab from '@widgets/userProfileModal/tabs/ProfileTab'
import FriendsTab from '@widgets/userProfileModal/tabs/FriendsTab'
import SettingsTab from '@widgets/userProfileModal/tabs/SettingsTab'

import * as styles from '@pages/profile/profilePage.module.scss'
import { MdPeopleOutline, MdPersonOutline, MdSettings } from 'react-icons/md'
import { ExtendedUser } from '@entities/user/model/extendUser.interface'
import userContext from '@entities/user/model/context'
import { useTranslation } from 'react-i18next'

const ProfilePage: React.FC = () => {
    const { username: raw } = useParams()
    const navigate = useNavigate()
    const username = decodeURIComponent(raw || '')
    const { user, allAchievements } = useContext(userContext)
    const { t } = useTranslation()

    const [activeTab, setActiveTab] = useState<'profile' | 'friends' | 'settings'>('profile')

    const isSelf = useMemo(() => {
        if (!username) return false
        const u = user?.username || ''
        return u.toLowerCase() === username.toLowerCase()
    }, [user?.username, username])

    const queryDoc = useMemo(() => (isSelf ? getMeProfileQuery : getUserProfileQuery), [isSelf])

    const variables = useMemo(() => (isSelf ? undefined : { name: username }), [isSelf, username])

    const { data, loading, error, refetch } = useQuery<any>(queryDoc, {
        variables,
        fetchPolicy: 'no-cache',
        skip: !username,
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
        if (!payload || !isSelf || user.id === '-1' || payload.id !== user.id) {
            return payload
        }

        return {
            ...payload,
            username: user.username || payload.username,
            nickname: user.nickname || payload.nickname,
            avatarHash: user.avatarHash || payload.avatarHash,
            avatarType: user.avatarType || payload.avatarType,
            bannerHash: user.bannerHash || payload.bannerHash,
            bannerType: user.bannerType || payload.bannerType,
            badges: Array.isArray(user.badges) ? user.badges : payload.badges,
            status: user.status ?? payload.status,
            lastOnline: user.lastOnline ?? payload.lastOnline,
            currentTrack: user.currentTrack ?? payload.currentTrack,
            subscription: user.subscription ?? payload.subscription ?? null,
            hasSupporterBadge: user.hasSupporterBadge,
            active: user.active,
        }
    }, [isSelf, payload, user])

    const userProfile: ExtendedUser = useMemo<ExtendedUser>(() => {
        if (!livePayload) return userInitials
        return {
            ...livePayload,
            allAchievements: allAchievements || [],
        }
    }, [allAchievements, livePayload])

    const normalizedError: string | null = useMemo(() => {
        if (error) return error.message || t('profile.errors.loadFailed')
        if (!loading && username && !payload) return t('profile.errors.userNotFound')
        return null
    }, [error, loading, payload, t, username])

    const onEscPress = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape') navigate(-1)
        },
        [navigate],
    )

    useEffect(() => {
        document.addEventListener('keydown', onEscPress, true)
        return () => document.removeEventListener('keydown', onEscPress, true)
    }, [onEscPress])

    const renderTabTitle = useCallback(() => {
        if (activeTab === 'profile')
            return (
                <>
                    <MdPersonOutline size={34} />
                    <span>{t('profile.tabs.profileWithName', { username })}</span>
                </>
            )
        if (activeTab === 'friends')
            return (
                <>
                    <MdPeopleOutline size={34} />
                    <span>{t('profile.tabs.friendsWithName', { username })}</span>
                </>
            )
        if (activeTab === 'settings')
            return (
                <>
                    <MdSettings size={34} />
                    <span>{t('profile.tabs.settings')}</span>
                </>
            )
        return null
    }, [activeTab, username])

    return (
        <PageLayout title={t('profile.pageTitle')}>
            <Scrollbar className={styles.scrollArea} classNameInner={styles.scrollAreaInner}>
                {/*<div className={styles.tabs}>{renderTabTitle()}</div>*/}
                {/* <div className={styles.tabs}>
                <button onClick={() => setActiveTab('profile')}  className={activeTab === 'profile'  ? styles.activeTab : ''}>Профиль</button>
                <button onClick={() => setActiveTab('friends')}  className={activeTab === 'friends'  ? styles.activeTab : ''}>Друзья</button>
                <button onClick={() => setActiveTab('settings')} className={activeTab === 'settings' ? styles.activeTab : ''}>Настройки</button>
              </div> */}

                <div className={styles.content}>
                    {activeTab === 'profile' && (
                        <ProfileTab userProfile={userProfile} loading={loading} error={normalizedError} username={username} />
                    )}
                    {activeTab === 'friends' && <FriendsTab userProfile={userProfile} loading={loading} error={normalizedError} />}
                    {activeTab === 'settings' && <SettingsTab userProfile={userProfile} loading={loading} error={normalizedError} />}
                </div>
            </Scrollbar>
        </PageLayout>
    )
}

export default ProfilePage
