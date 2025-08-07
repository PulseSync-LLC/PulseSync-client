import React from 'react'
import * as styles from './Loader.module.scss'

export default function Loader({ text = 'Анализирую темы…' }: { text?: string }) {
  return (
    <div className={styles.loaderContainer}>
      <div className={styles.spinner}>
        <div />
        <div />
        <div />
        <div />
      </div>
      <span className={styles.loaderText}>{text}</span>
    </div>
  )
}
