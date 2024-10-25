import React from 'react';
import { NavLink } from 'react-router-dom';
import * as styles from './nav_button_pulse.module.scss';

interface NavButtonPulseProps {
    to: string;
    children: React.ReactNode;
    disabled?: boolean;
}

const NavButtonPulse: React.FC<NavButtonPulseProps> = ({ to, children, disabled = false }) => {

    return (
        <NavLink
            to={to}
            className={({ isActive, isPending }) =>
                isPending
                    ? 'pending'
                    : isActive
                        ? 'active'
                        : ''
            }
        >
            <button
                className={styles.button}
                disabled={disabled}
            >
                {children}
            </button>
        </NavLink>
    );
};

export default NavButtonPulse;
