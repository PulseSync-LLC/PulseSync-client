import React from 'react'
import { MdCheckCircle, MdHistoryEdu, MdKeyboardArrowDown, MdStar } from 'react-icons/md'
import TooltipButton from '../../../tooltip_button'
import * as achv from '../../achievements.module.scss'
import { staticAsset } from '../../../../utils/staticAssets'

const fallbackAchievement = staticAsset('assets/images/O^O.png')

interface AchievementItemProps {
    ach: any
    userAch: any
    expanded: boolean
    toggleExpand?: (id: number) => void
    canViewDetails: boolean
}

const AchievementItem: React.FC<AchievementItemProps> = ({ ach, userAch, expanded, toggleExpand, canViewDetails }) => {
    const statusLower = userAch?.status?.toLowerCase() || 'not_started'
    const progressCurrent = userAch?.progressCurrent ?? 0
    const progressTotal = userAch?.progressTotal ?? ach.progressTotal ?? 0
    const isCompleted = statusLower === 'completed'
    const isInProgress = statusLower === 'in_progress'

    type Difficulty = 'EASY' | 'NORMAL' | 'HARD' | 'EXTREME'
    const difficultyMap: Record<Difficulty, string> = {
        EASY: 'Легко',
        NORMAL: 'Нормально',
        HARD: 'Сложно',
        EXTREME: 'Экстремально',
    }
    const difficultyColors: Record<Difficulty, string> = {
        EASY: '#92FFB2',
        NORMAL: '#E9CA75',
        HARD: '#FF9292',
        EXTREME: '#BA82FF',
    }

    const diffKey = ((ach.difficulty as string).toUpperCase() as Difficulty) || 'EASY'
    const difficultyLabel = difficultyMap[diffKey] ?? 'Неизвестно'
    const difficultyColor = difficultyColors[diffKey] || '#000'

    const itemClassNames = [achv.achievementCard, isCompleted && achv.completed, isInProgress && achv.inProgress].filter(Boolean).join(' ')

    return (
        <div key={ach.id} className={itemClassNames}>
            <div className={achv.achievementHeader}>
                {!isCompleted ? (
                    <div className={achv.image}>?</div>
                ) : (
                    <div className={achv.image}>
                        <div className={achv.imageSolid}>
                            <MdCheckCircle size={24} />
                        </div>
                        <img
                            className={achv.image}
                            src={ach.imageUrl || fallbackAchievement}
                            onError={e => {
                                ;(e.currentTarget as HTMLImageElement).src = fallbackAchievement
                            }}
                            alt={ach.title}
                        />
                    </div>
                )}
                <div className={achv.achievementInfo}>
                    {isCompleted && (
                        <div className={achv.achievementCompletedAt}>
                            {userAch?.completedAt
                                ? new Date(Number(userAch.completedAt)).toLocaleString('ru-RU', {
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                  })
                                : 'Неизвестно'}
                        </div>
                    )}
                    <div className={achv.achievementTitle}>{ach.title}</div>
                    <div className={achv.contentWrapper}>
                        <div className={achv.achievementDescription}>{ach.description}</div>
                    </div>
                </div>
                <div className={achv.buttonsItem}>
                    {ach.hint && (
                        <TooltipButton styleComponent={{ maxWidth: 300 }} className={achv.expandButton} tooltipText={ach.hint} side="left">
                            <MdHistoryEdu size={24} />
                        </TooltipButton>
                    )}
                    {(isInProgress || isCompleted) && canViewDetails && toggleExpand && (
                        <button className={achv.expandButton} onClick={() => toggleExpand(ach.id)}>
                            <MdKeyboardArrowDown size={24} className={expanded ? achv.rotatedArrow : ''} />
                        </button>
                    )}
                </div>
            </div>
            {expanded &&
                canViewDetails &&
                userAch?.criteriaProgress &&
                Array.isArray(userAch.criteriaProgress) &&
                userAch.criteriaProgress.length > 0 && (
                    <div className={achv.trackList}>
                        {userAch.criteriaProgress.map((crit: any) => (
                            <div key={crit.id} className={`${achv.trackItem} ${crit.isCompleted ? achv.criteriaDone : ''}`}>
                                {crit.isCompleted ? crit.name : 'Неизвестно'}
                            </div>
                        ))}
                    </div>
                )}
            <div className={achv.achievementFooter}>
                {!isCompleted && (
                    <div className={achv.goal} style={{ color: difficultyColor }}>
                        Прогресс: {progressCurrent} / {progressTotal}
                    </div>
                )}
                <div className={achv.points} style={{ color: difficultyColor }}>
                    <MdStar /> {ach.points} очков
                </div>
                <div className={achv.difficulty} style={{ color: difficultyColor }}>
                    {difficultyLabel}
                </div>
            </div>
        </div>
    )
}

export default AchievementItem
