import React, { ButtonHTMLAttributes, CSSProperties } from 'react'
import * as styles from './button.module.scss'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
    style?: CSSProperties
    children: React.ReactNode
    disableOnClickSound?: boolean
    className?: string
}

const Button: React.FC<ButtonProps> = ({
    onClick,
    style,
    children,
    disableOnClickSound = true,
    className,
    ...rest
}) => {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (onClick) {
            onClick(event)
        }
    }

    return (
        <button style={style} className={`${className ? className : styles.button}`} onClick={handleClick} {...rest}>
            {children}
        </button>
    )
}

export default Button
