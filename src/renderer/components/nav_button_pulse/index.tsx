import React from 'react'
import { NavLink } from 'react-router'
import * as styles from './nav_button_pulse.module.scss'
import TooltipButton from '../tooltip_button'

interface NavButtonPulseProps {
    to?: string
    text: string
    children: React.ReactNode
    disabled?: boolean
    onClick?: () => void
    tipEnabled?: boolean
}

const NavButtonPulse: React.FC<NavButtonPulseProps> = ({ to, text, children, disabled = false, onClick, tipEnabled }) => {
    return (
        <NavLink
            onClick={onClick}
            to={disabled ? null : to}
            className={({ isActive, isPending }) => (disabled ? 'disabled' : isPending ? 'pending' : isActive ? 'active' : '')}
        >
            <TooltipButton tooltipText={text} as={'button'} className={styles.button} disabled={disabled} tipEnabled={tipEnabled}>
                {children}
            </TooltipButton>
        </NavLink>
    )
}

export default NavButtonPulse
