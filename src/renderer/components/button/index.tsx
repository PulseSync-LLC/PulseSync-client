import React, { ButtonHTMLAttributes, CSSProperties } from 'react'
import * as styles from './button.module.scss'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    onClick?: () => void
    style?: CSSProperties
    children: any
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
            onClick()
        }
    }

    return (
        <button
            style={style}
            className={`${className ? className : styles.button}`}
            onClick={handleClick}
            {...rest}
        >
            {children}
        </button>
    )
}

export default Button
