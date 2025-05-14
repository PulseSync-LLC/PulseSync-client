import React from 'react'
import { MdSettings, MdStickyNote2 } from 'react-icons/md'
import { ActiveTab, DocTab } from './types'
import * as s from '../extensionview.module.scss'

interface Props {
    active: ActiveTab
    onChange: (t: ActiveTab) => void
    docs: DocTab[]
}

const TabNavigation: React.FC<Props> = ({ active, onChange, docs }) => (
    <div className={s.extensionNav}>
        <div className={s.extensionNavContainer}>
            {docs.map(d => (
                <button
                    key={d.title}
                    className={`${s.extensionNavButton} ${active === d.title ? s.activeTabButton : ''}`}
                    onClick={() => onChange(d.title)}
                >
                    <MdStickyNote2 /> {d.title}
                </button>
            ))}

            <button className={`${s.extensionNavButton} ${active === 'Settings' ? s.activeTabButton : ''}`} onClick={() => onChange('Settings')}>
                <MdSettings /> Настройки
            </button>
            <button className={`${s.extensionNavButton} ${active === 'Metadata' ? s.activeTabButton : ''}`} onClick={() => onChange('Metadata')}>
                <MdStickyNote2 /> Редактирование
            </button>
        </div>
    </div>
)

export default TabNavigation
