import React from 'react'

import SettingsGroup from '@widgets/modalContainer/modals/SettingsModal/components/SettingsGroup'

import * as styles from '@widgets/modalContainer/modals/SettingsModal/components/SettingsSection/SettingsSection.module.scss'

import type { SettingsSectionSchema } from '@widgets/modalContainer/modals/SettingsModal/model/types'

interface SettingsSectionProps {
    section: SettingsSectionSchema
}

const SettingsSection: React.FC<SettingsSectionProps> = ({ section }) => {
    if (section.content.kind === 'custom') {
        return section.content.node
    }

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.title}>{section.title}</h2>
            </div>
            {section.content.groups.map(group => (
                <SettingsGroup key={group.id} group={group} />
            ))}
        </>
    )
}

export default SettingsSection
