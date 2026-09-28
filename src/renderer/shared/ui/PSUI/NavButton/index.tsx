import React from 'react'

import { NavLink } from 'react-router'

import TooltipButton from '@shared/ui/tooltip_button'

import * as styles from '@shared/ui/PSUI/NavButton/nav_button_pulse.module.scss'

interface NavButtonPulseProps {
    to?: string
    text: string
    children: React.ReactNode
    disabled?: boolean
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
    tipEnabled?: boolean
    end?: boolean
}

const NavButtonPulse: React.FC<NavButtonPulseProps> = ({ to, text, children, disabled = false, onClick, tipEnabled, end = false }) => {
    return (
        <NavLink
            onClick={onClick}
            end={end}
            to={disabled ? '#' : (to ?? '#')}
            className={({ isActive, isPending }) => (disabled ? 'disabled' : !to ? '' : isPending ? 'pending' : isActive ? 'active' : '')}
        >
            <TooltipButton
                tooltipText={text}
                side="right"
                sideOffset={10}
                as="button"
                className={styles.button}
                disabled={disabled}
                tipEnabled={tipEnabled}
            >
                {children}
            </TooltipButton>
        </NavLink>
    )
}

export default NavButtonPulse
