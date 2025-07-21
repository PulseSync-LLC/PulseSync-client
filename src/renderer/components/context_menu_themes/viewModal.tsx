import * as cm from './viewModal.module.scss'
import { MenuItem } from './sectionConfig'
import React from 'react'

interface ContextMenuProps {
    items: MenuItem[]
}

interface ContextMenuProps {
    items: MenuItem[]
}

const viewModal: React.FC<ContextMenuProps> = ({ items }) => {
    return (
        <div className={`${cm.contextMenu}`}>
            <div className={cm.title}>Управление</div>
            {items
                .filter(item => item.show)
                .map((item, index) => (
                    <div key={index} className={cm.contextMenuItem} onClick={item.onClick}>
                        {item.icon && (
                            <>
                                <span className={cm.icon}>{item.icon}</span>
                                <span className={cm.label}>{item.label}</span>
                            </>
                        )}
                    </div>
                ))}
        </div>
    )
}

export default viewModal
