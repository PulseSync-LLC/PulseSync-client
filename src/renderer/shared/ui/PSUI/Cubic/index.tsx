import React, { useState } from 'react'

export const Cubic: React.FC<{ width?: string | number; height?: string | number; color: string }> = ({ width = 12, height = 12, color }) => {
    const [hovered, setHovered] = useState(false)

    const style: React.CSSProperties = {
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: color,
        borderRadius: '3px',
        display: 'inline-block',
        verticalAlign: 'middle',
        transition: 'var(--transition)',
        transform: hovered ? 'rotateX(40deg)' : 'rotateX(0deg)',
    }

    return <div style={style} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} />
}
