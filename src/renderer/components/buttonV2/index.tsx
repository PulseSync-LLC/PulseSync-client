import React, { ButtonHTMLAttributes, CSSProperties, forwardRef } from 'react'
import * as styles from './button.module.scss'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
    style?: CSSProperties
    children: React.ReactNode
    disableOnClickSound?: boolean
    className?: string
}

const ButtonV2 = forwardRef<HTMLButtonElement, ButtonProps>(({ onClick, style, children, disableOnClickSound = true, className, ...rest }, ref) => {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (onClick) {
            onClick(event)
        }
    }

    return (
        <button ref={ref} style={style} className={`${styles.button} ${className ? className : ''}`} onClick={handleClick} {...rest}>
            {children}
        </button>
    )
})

export default ButtonV2
