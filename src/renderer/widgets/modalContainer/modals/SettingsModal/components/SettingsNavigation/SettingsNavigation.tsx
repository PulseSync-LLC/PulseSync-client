import React from 'react'

import * as styles from '@widgets/modalContainer/modals/SettingsModal/components/SettingsNavigation/SettingsNavigation.module.scss'

import type { SettingsCategorySchema, SettingsSectionId } from '@widgets/modalContainer/modals/SettingsModal/model/types'

interface SettingsNavigationProps {
    activeSection: SettingsSectionId
    categories: SettingsCategorySchema[]
    onSelect: (section: SettingsSectionId) => void
}

const SettingsNavigation: React.FC<SettingsNavigationProps> = ({ activeSection, categories, onSelect }) => (
    <aside className={styles.sidebar}>
        {categories.map((category, categoryIndex) => (
            <React.Fragment key={category.id}>
                <div className={`${styles.title} ${categoryIndex > 0 ? styles.titleSpaced : ''}`}>{category.label}</div>
                {category.sections.map(section => {
                    const Icon = section.icon
                    const isActive = activeSection === section.id

                    return (
                        <button
                            key={section.id}
                            type="button"
                            className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => onSelect(section.id)}
                        >
                            <Icon size={18} aria-hidden="true" />
                            <span>{section.label}</span>
                        </button>
                    )
                })}
            </React.Fragment>
        ))}
    </aside>
)

export default SettingsNavigation
