import React from 'react'
import AchievementItem from './AchievementItem'
import * as styles from '../../userProfileModal.module.scss'

interface AchievementListProps {
    achievements: any[]
    userAchievements: any[]
    toggleExpand: (id: number) => void
    expandedIndexes: number[]
    canViewDetails: boolean
}

const AchievementList: React.FC<AchievementListProps> = ({ achievements, userAchievements, toggleExpand, expandedIndexes, canViewDetails }) => (
    <div className={styles.achievementsList}>
        {achievements.map(ach => {
            const userAch = userAchievements?.find((ua: any) => ua.achievement.id === ach.id)
            const expanded = expandedIndexes.includes(ach.id)
            return (
                <AchievementItem
                    key={ach.id}
                    ach={ach}
                    userAch={userAch}
                    expanded={expanded}
                    toggleExpand={canViewDetails ? toggleExpand : undefined}
                    canViewDetails={canViewDetails}
                />
            )
        })}
    </div>
)

export default AchievementList
