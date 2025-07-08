import React, { ButtonHTMLAttributes, CSSProperties } from 'react'
import * as styles from './button.module.scss'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
    style?: CSSProperties
    children: React.ReactNode
    disableOnClickSound?: boolean
    className?: string
}

const ButtonV2: React.FC<ButtonProps> = ({ onClick, style, children, disableOnClickSound = true, className, ...rest }) => {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (onClick) {
            onClick(event)
        }
    }

    return (
        <button style={style} className={`${styles.button} ${className ? className : undefined}`} onClick={handleClick} {...rest}>
            {children}
        </button>
    )
}

export default ButtonV2
