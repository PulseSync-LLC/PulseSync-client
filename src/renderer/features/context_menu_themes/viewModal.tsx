import * as cm from '@features/context_menu_themes/viewModal.module.scss'
import { MenuItem } from '@features/context_menu_themes/sectionConfig'
import React from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import cn from 'clsx'

interface ContextMenuProps {
    items: MenuItem[]
}

const viewModal: React.FC<ContextMenuProps> = ({ items }) => {
    const { t } = useTranslation()
    return (
        <motion.div
            className={cn(cm.contextMenu)}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
        >
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
        </motion.div>
    )
}

export default viewModal
