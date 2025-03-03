import React from 'react'
import * as style from './levelProgress.module.scss'

interface LevelProgressProps {
    totalPoints: number
    currentLevel: number
    progressInCurrentLevel: number
    currentLevelThreshold: number
}

const LevelProgress: React.FC<LevelProgressProps> = ({
    totalPoints,
    currentLevel,
    progressInCurrentLevel,
    currentLevelThreshold,
}) => {
    const progressPercentage = (progressInCurrentLevel / currentLevelThreshold) * 100

    return (
        <div className={style.level_progress}>
            <div className={style.level_header}>
                <span>Уровень {currentLevel}</span>
                <span>Всего очков за все уровни: {totalPoints}</span>
            </div>
            <div className={style.progress_bar}>
                <div className={style.progress_fill} style={{ width: `${progressPercentage}%` }}></div>
                <div className={style.progress_content}>
                    <div className={style.level_box}>{currentLevel}</div>
                    <div className={style.points}>
                        ⭐ {progressInCurrentLevel}/{currentLevelThreshold}
                    </div>
                    <div className={style.level_box}>{currentLevel + 1}</div>
                </div>
            </div>
        </div>
    )
}

export default LevelProgress
