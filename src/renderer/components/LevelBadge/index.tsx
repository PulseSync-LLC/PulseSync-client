import React from 'react'
import * as styleBadge from './levelBadge.module.scss'

interface LevelBadgeProps {
    level: number
}

const getLevelBadgeStyle = (level: number) => {
    if (level >= 100)
        return { background: 'linear-gradient(270deg, #FF6B00, #FF0000)' }
    if (level >= 90)
        return { background: 'linear-gradient(270deg, #4D4AD3, #423EB0)' }
    if (level >= 80)
        return { background: 'linear-gradient(270deg, #8B42B0, #D34AD3)' }
    if (level >= 70)
        return { background: 'linear-gradient(270deg, #D34AD3, #B0426B)' }
    if (level >= 60)
        return { background: 'linear-gradient(270deg, #FF6B6B, #B04242)' }
    if (level >= 50)
        return { background: 'linear-gradient(270deg, #FF9242, #B07A42)' }
    if (level >= 40)
        return { background: 'linear-gradient(270deg, #FFCC42, #B0A242)' }
    if (level >= 30)
        return { background: 'linear-gradient(270deg, #B0FF42, #42B042)' }
    if (level >= 20)
        return { background: 'linear-gradient(270deg, #42FF92, #42B0A2)' }
    if (level >= 10)
        return { background: 'linear-gradient(270deg, #4D4AD3, #423EB0)' }
    return { background: 'linear-gradient(270deg, #757575, #353535)' }
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
