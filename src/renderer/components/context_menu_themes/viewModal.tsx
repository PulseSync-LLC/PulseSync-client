import * as cm from './viewModal.module.scss'
import { MenuItem } from './sectionConfig'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'clsx'

interface ContextMenuProps {
    items: MenuItem[]
}

interface ContextMenuProps {
    items: MenuItem[]
}

const viewModal: React.FC<ContextMenuProps> = ({ items }) => {
    const { t } = useTranslation()
    return (
        <div className={cn(cm.contextMenu)}>
            <div className={cm.title}>{t('contextMenuThemes.title')}</div>
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
