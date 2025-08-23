import React, { useState, useContext } from 'react'
import LevelProgress from '../../../LevelProgress'
import AchievementList from './AchievementList'
import * as styles from '../../userProfileModal.module.scss'
import userContext from '../../../../api/context/user.context'

interface AchievementsSectionProps {
    userProfile: any
    username: string
}

const AchievementsSection: React.FC<AchievementsSectionProps> = ({ userProfile, username }) => {
    const [expandedIndexes, setExpandedIndexes] = useState<number[]>([])
    const { user, features } = useContext(userContext)
    const canViewDetails = user.username === username

    const toggleExpand = (id: number) => {
        setExpandedIndexes(prev => (prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]))
    }

    const completedAchievements = userProfile.allAchievements.filter((ach: any) => {
        const userAch = userProfile.userAchievements?.find((ua: any) => ua.achievement.id === ach.id)
        return userAch?.status?.toLowerCase() === 'completed'
    })

    const notReceivedAchievements = userProfile.allAchievements.filter((ach: any) => {
        const userAch = userProfile.userAchievements?.find((ua: any) => ua.achievement.id === ach.id)
        return !userAch || userAch?.status?.toLowerCase() === 'not_started' || userAch?.status?.toLowerCase() === 'in_progress'
    })

    type Difficulty = 'EASY' | 'NORMAL' | 'HARD' | 'EXTREME'
    const difficultyPriority: Record<Difficulty, number> = {
        EASY: 1,
        NORMAL: 2,
        HARD: 3,
        EXTREME: 4,
    }

    return (
        <div className={styles.userPageDown}>
            {!features?.achievements && (
                <div className={styles.warning}>
                    <span className={styles.title}>
                        <span className={styles.warnDot}></span>
                        <span className={styles.pulsingDot}></span>
                        Внимание! Система достижений временно не работает
                    </span>
                    <span className={styles.description}>
                        Мы перерабатываем систему достижений, чтобы сделать её лучше! Сейчас достижения не засчитываются при прослушивании, но мы
                        скоро всё исправим. Спасибо за ваше терпение! 😊
                    </span>
                </div>
            )}
            <div className={styles.achievementsSection}>
                <div>
                    <div className={styles.titleHeader}>Достижения</div>
                    <div className={styles.descriptionHeader}>Достигайте самого высокого уровня.</div>
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
                            <div className={styles.achievementsListTitle}>Выполненные</div>
                            <AchievementList
                                achievements={completedAchievements.sort((a: any, b: any) => {
                                    const keyA = (a.difficulty as string).toUpperCase() as Difficulty
                                    const keyB = (b.difficulty as string).toUpperCase() as Difficulty
                                    return difficultyPriority[keyA] - difficultyPriority[keyB]
                                })}
                                userAchievements={userProfile.userAchievements}
                                toggleExpand={toggleExpand}
                                expandedIndexes={expandedIndexes}
                                canViewDetails={canViewDetails}
                            />
                            {completedAchievements.length === 0 && (
                                <div className={styles.noAchievementsMessage}>🎯 Пока нет выполненных достижений</div>
                            )}
                        </div>
                        <div className={styles.achievementsListContainer}>
                            <div className={styles.achievementsListTitle}>Неполученные достижения</div>
                            <AchievementList
                                achievements={notReceivedAchievements.sort((a: any, b: any) => {
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
                                })}
                                userAchievements={userProfile.userAchievements}
                                toggleExpand={toggleExpand}
                                expandedIndexes={expandedIndexes}
                                canViewDetails={canViewDetails}
                            />
                        </div>
                    </>
                ) : (
                    <p>Нет достижений</p>
                )}
            </div>
        </div>
    )
}

export default AchievementsSection
