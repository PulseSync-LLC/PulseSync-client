import React, { forwardRef } from 'react'

import cn from 'clsx'

import * as styles from '@shared/ui/buttonV2/button.module.scss'

import type { ButtonHTMLAttributes, CSSProperties } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
    style?: CSSProperties
    children: React.ReactNode
    disableOnClickSound?: boolean
    className?: string
}

const ButtonV2 = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ onClick, style, children, disableOnClickSound: _disableOnClickSound = true, className, ...rest }, ref) => {
        const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
            if (onClick) {
                onClick(event)
            }
        }

        return (
            <button ref={ref} style={style} className={cn(styles.button, className)} onClick={handleClick} {...rest}>
                {children}
            </button>
        )
    },
)

export default ButtonV2
