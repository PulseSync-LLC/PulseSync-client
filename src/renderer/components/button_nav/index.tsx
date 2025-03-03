import React, { ButtonHTMLAttributes, CSSProperties } from 'react'
import * as styles from './button_nav.module.scss'

interface p extends ButtonHTMLAttributes<HTMLButtonElement> {
    onClick?: () => void
    style?: CSSProperties
    children: any
    disabled?: boolean
}

const Button: React.FC<p> = ({ onClick, style, children, disabled }) => {
    return (
        <button className={styles.button} onClick={onClick} style={style} disabled={disabled}>
            {children}
        </button>
    )
}

export default Button
