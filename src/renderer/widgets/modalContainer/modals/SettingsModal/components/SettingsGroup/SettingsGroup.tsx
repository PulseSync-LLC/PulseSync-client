import React from 'react'

import SettingsControl from '@widgets/modalContainer/modals/SettingsModal/components/SettingsControl'

import * as styles from '@widgets/modalContainer/modals/SettingsModal/components/SettingsGroup/SettingsGroup.module.scss'

import type { SettingsGroupSchema } from '@widgets/modalContainer/modals/SettingsModal/model/types'

interface SettingsGroupProps {
    group: SettingsGroupSchema
}

const SettingsGroup: React.FC<SettingsGroupProps> = ({ group }) => (
    <section className={styles.group}>
        <div className={styles.header}>
            <div className={styles.title}>{group.title}</div>
            {group.meta && <div className={styles.meta}>{group.meta}</div>}
        </div>
        <div className={styles.items}>
            {group.items.map(item => (
                <SettingsControl key={item.id} item={item} />
            ))}
        </div>
    </section>
)

export default SettingsGroup
