import React, { useCallback, useContext, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import LevelProgress from '../../../LevelProgress'
import AchievementList from './AchievementList'
import * as styles from '../../userProfileModal.module.scss'
import userContext from '../../../../api/context/user'

interface AchievementsSectionProps {
    userProfile: any
    username: string
}

type Difficulty = 'EASY' | 'NORMAL' | 'HARD' | 'EXTREME'

const difficultyPriority: Record<Difficulty, number> = {
    EASY: 1,
    NORMAL: 2,
    HARD: 3,
    EXTREME: 4,
}

const AchievementsSection: React.FC<AchievementsSectionProps> = ({ userProfile, username }) => {
    const [expandedIndexes, setExpandedIndexes] = useState<number[]>([])
    const { user, features } = useContext(userContext)
    const canViewDetails = useMemo(() => user.username === username, [user.username, username])
    const { t } = useTranslation()

    const toggleExpand = useCallback((id: number) => {
        setExpandedIndexes(prev => (prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]))
    }, [])

    const completedAchievements = useMemo(
        () =>
            userProfile.allAchievements.filter((ach: any) => {
                const userAch = userProfile.userAchievements?.find((ua: any) => ua.achievement.id === ach.id)
                return userAch?.status?.toLowerCase() === 'completed'
            }),
        [userProfile.allAchievements, userProfile.userAchievements],
    )

    const notReceivedAchievements = useMemo(
        () =>
            userProfile.allAchievements.filter((ach: any) => {
                const userAch = userProfile.userAchievements?.find((ua: any) => ua.achievement.id === ach.id)
                return !userAch || userAch?.status?.toLowerCase() === 'not_started' || userAch?.status?.toLowerCase() === 'in_progress'
            }),
        [userProfile.allAchievements, userProfile.userAchievements],
    )

    const sortedCompletedAchievements = useMemo(
        () =>
            [...completedAchievements].sort((a: any, b: any) => {
                const keyA = (a.difficulty as string).toUpperCase() as Difficulty
                const keyB = (b.difficulty as string).toUpperCase() as Difficulty
                return difficultyPriority[keyA] - difficultyPriority[keyB]
            }),
        [completedAchievements],
    )

    const sortedNotReceivedAchievements = useMemo(
        () =>
            [...notReceivedAchievements].sort((a: any, b: any) => {
                const userAchA = userProfile.userAchievements?.find((ua: any) => ua.achievement.id === a.id)
                const userAchB = userProfile.userAchievements?.find((ua: any) => ua.achievement.id === b.id)
                const keyA = (a.difficulty as string).toUpperCase() as Difficulty
                const keyB = (b.difficulty as string).toUpperCase() as Difficulty
                if (userAchA?.status?.toLowerCase() === 'in_progress' && userAchB?.status?.toLowerCase() !== 'in_progress') {
                    return -1
                }
                if (userAchB?.status?.toLowerCase() === 'in_progress' && userAchA?.status?.toLowerCase() !== 'in_progress') {
                    return 1
                }
                return difficultyPriority[keyA] - difficultyPriority[keyB]
            }),
        [notReceivedAchievements, userProfile.userAchievements],
    )

    return (
        <div className={styles.userPageDown}>
            {!features?.achievements && (
                <div className={styles.warning}>
                    <span className={styles.title}>
                        <span className={styles.warnDot}></span>
                        <span className={styles.pulsingDot}></span>
                        {t('profile.achievements.warningTitle')}
                    </span>
                    <span className={styles.description}>{t('profile.achievements.warningDescription')}</span>
                </div>
            )}
            <div className={styles.achievementsSection}>
                <div>
                    <div className={styles.titleHeader}>{t('profile.achievements.title')}</div>
                    <div className={styles.descriptionHeader}>{t('profile.achievements.subtitle')}</div>
                </div>
                <LevelProgress
                    totalPoints={userProfile.levelInfo.totalPoints}
                    currentLevel={userProfile.levelInfo.currentLevel}
                    progressInCurrentLevel={userProfile.levelInfo.progressInCurrentLevel}
                    currentLevelThreshold={userProfile.levelInfo.currentLevelThreshold}
                />
                {userProfile.allAchievements && userProfile.allAchievements.length > 0 ? (
                    <>
                        <div className={styles.achievementsListContainer}>
                            <div className={styles.achievementsListTitle}>{t('profile.achievements.completed')}</div>
                            <AchievementList
                                achievements={sortedCompletedAchievements}
                                userAchievements={userProfile.userAchievements}
                                toggleExpand={toggleExpand}
                                expandedIndexes={expandedIndexes}
                                canViewDetails={canViewDetails}
                            />
                            {completedAchievements.length === 0 && (
                                <div className={styles.noAchievementsMessage}>{t('profile.achievements.noCompleted')}</div>
                            )}
                        </div>
                        <div className={styles.achievementsListContainer}>
                            <div className={styles.achievementsListTitle}>{t('profile.achievements.notReceived')}</div>
                            <AchievementList
                                achievements={sortedNotReceivedAchievements}
                                userAchievements={userProfile.userAchievements}
                                toggleExpand={toggleExpand}
                                expandedIndexes={expandedIndexes}
                                canViewDetails={canViewDetails}
                            />
                        </div>
                    </>
                ) : (
                    <p>{t('profile.achievements.none')}</p>
                )}
            </div>
        </div>
    )
}

export default AchievementsSection

