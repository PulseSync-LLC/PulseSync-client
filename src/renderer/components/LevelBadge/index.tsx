import React from 'react'
import * as styleBadge from './levelBadge.module.scss'

interface LevelBadgeProps {
    level: number
}

const getLevelBadgeStyle = (level: number) => {
    if (level >= 100) return { background: 'linear-gradient(270deg, #FF8C00, #FF0000)' } // Огненный

    if (level >= 95) return { background: 'linear-gradient(270deg, #705DFF, #433DE3)' } // Индиго пламя
    if (level >= 90) return { background: 'linear-gradient(270deg, #5A5DF0, #2B2ED0)' } // Глубокий синий

    if (level >= 85) return { background: 'linear-gradient(270deg, #B968E8, #E69BFF)' } // Сиреневый
    if (level >= 80) return { background: 'linear-gradient(270deg, #A348D6, #D66DFF)' } // Фиолетовый закат

    if (level >= 75) return { background: 'linear-gradient(270deg, #FF9AD1, #E648A0)' } // Розовый взрыв
    if (level >= 70) return { background: 'linear-gradient(270deg, #FF6FB3, #C03A9D)' } // Малиновый

    if (level >= 65) return { background: 'linear-gradient(270deg, #FF9696, #C54646)' } // Клубничный
    if (level >= 60) return { background: 'linear-gradient(270deg, #FF7B7B, #B03A3A)' } // Ярко-красный

    if (level >= 55) return { background: 'linear-gradient(270deg, #FFB26E, #E07E2A)' } // Янтарный
    if (level >= 50) return { background: 'linear-gradient(270deg, #FF9B4D, #D6752B)' } // Апельсиновый

    if (level >= 45) return { background: 'linear-gradient(270deg, #FFE67A, #CBAE29)' } // Тёплое золото
    if (level >= 40) return { background: 'linear-gradient(270deg, #FFD966, #C1A400)' } // Золотой

    if (level >= 35) return { background: 'linear-gradient(270deg, #D2FA6F, #9CC733)' } // Салатовый
    if (level >= 30) return { background: 'linear-gradient(270deg, #B9F64D, #78C42B)' } // Ярко-зелёный

    if (level >= 25) return { background: 'linear-gradient(270deg, #6FFFD7, #34BFA1)' } // Аквамарин
    if (level >= 20) return { background: 'linear-gradient(270deg, #4DF6C7, #2BB08E)' } // Мятный

    if (level >= 15) return { background: 'linear-gradient(270deg, #8BB8FF, #4A7FD9)' } // Голубой лёд
    if (level >= 10) return { background: 'linear-gradient(270deg, #6A9EFF, #3A68B0)' } // Светло-синий

    if (level >= 5) return { background: 'linear-gradient(270deg, #3f4453, #2c303f)' } // Темный гранит
    return { background: 'linear-gradient(270deg, #3a3e4d, #2c303f)' } // Стартовая тень
}

const LevelBadge: React.FC<LevelBadgeProps> = ({ level }) => {
    const style = getLevelBadgeStyle(level)

    return (
        <div style={style} className={styleBadge.background}>
            Lv{level}
        </div>
    )
}

export default LevelBadge
