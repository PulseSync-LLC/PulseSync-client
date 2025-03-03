import React, { useEffect, useRef, useState } from 'react'
import * as cm from './contextMenu.module.scss'
import { MenuItem } from './sectionConfig'
import TooltipButton from '../tooltip_button'

interface ContextMenuProps {
    items: MenuItem[]
    position: { x: number; y: number }
    onClose: () => void
    isFadingOut: boolean
    setIsFadingOut: React.Dispatch<React.SetStateAction<boolean>>
}

interface ContextMenuProps {
    items: MenuItem[]
    position: { x: number; y: number }
    onClose: () => void
    isFadingOut: boolean
    setIsFadingOut: React.Dispatch<React.SetStateAction<boolean>>
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose, isFadingOut, setIsFadingOut }) => {
    const menuRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose()
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [onClose])

    return (
        <div
            ref={menuRef}
            className={`${cm.contextMenu} ${isFadingOut ? cm.contextMenuOut : ''}`}
            style={{ top: position.y, left: position.x }}
        >
            {items
                .filter(item => item.show)
                .map((item, index) => (
                    <TooltipButton
                        tooltipText={item.label}
                        side="top"
                        key={index}
                        className={cm.contextMenuItem}
                        onClick={item.onClick}
                    >
                        {item.icon && <span className={cm.icon}>{item.icon}</span>}
                    </TooltipButton>
                ))}
        </div>
    )
}

export default ContextMenu
