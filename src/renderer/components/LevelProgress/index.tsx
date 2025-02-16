import React from 'react'
import * as style from './levelProgress.module.scss'

interface LevelProgressProps {
    totalPoints: number
    currentLevel: number
    nextLevelThreshold: number
    pointsToNextLevel: number
}

const LevelProgress: React.FC<LevelProgressProps> = ({
    totalPoints,
    currentLevel,
    nextLevelThreshold,
    pointsToNextLevel,
}) => {
    const progressPercentage =
        ((nextLevelThreshold - pointsToNextLevel) / nextLevelThreshold) * 100

    return (
        <div className={style.level_progress}>
            <div className={style.level_header}>
                <span>Уровень {currentLevel}</span>
                <span>Всего очков: {totalPoints}</span>
            </div>
            <div className={style.progress_bar}>
                <div
                    className={style.progress_fill}
                    style={{ width: `${progressPercentage}%` }}
                ></div>
                <div className={style.progress_content}>
                    <div className={style.level_box}>{currentLevel}</div>
                    <div className={style.points}>
                        ⭐ {nextLevelThreshold - pointsToNextLevel}/
                        {nextLevelThreshold}
                    </div>
                    <div className={style.level_box}>{currentLevel + 1}</div>
                </div>
            </div>
        </div>
    )
}

export default LevelProgress
