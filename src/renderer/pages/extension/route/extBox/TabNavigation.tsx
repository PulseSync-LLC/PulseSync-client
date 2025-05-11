import React from 'react'
import { MdExplore, MdSettings, MdStickyNote2 } from 'react-icons/md'
import { ActiveTab } from './types'
import * as s from '../extensionview.module.scss'

interface Props {
  active: ActiveTab
  onChange: (t: ActiveTab) => void
}

const TabNavigation: React.FC<Props> = ({ active, onChange }) => (
  <div className={s.extensionNav}>
    <div className={s.extensionNavContainer}>
      <button
        className={`${s.extensionNavButton} ${active==='Overview' ? s.activeTabButton : ''}`}
        onClick={() => onChange('Overview')}
      >
        <MdExplore /> Документация
      </button>
      <button
        className={`${s.extensionNavButton} ${active==='Settings' ? s.activeTabButton : ''}`}
        onClick={() => onChange('Settings')}
      >
        <MdSettings /> Настройки
      </button>
      <button
        className={`${s.extensionNavButton} ${active==='Metadata' ? s.activeTabButton : ''}`}
        onClick={() => onChange('Metadata')}
      >
        <MdStickyNote2 /> Редактирование
      </button>
    </div>
  </div>
)

export default TabNavigation
