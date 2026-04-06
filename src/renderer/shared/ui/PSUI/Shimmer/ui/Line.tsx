import React from 'react'
import cn from 'clsx'
import * as styles from '@shared/ui/PSUI/Shimmer/ui/Line.module.scss'

type LineProps = {
    short?: boolean
    wide?: boolean
}

export default function Line({ short = false, wide = false }: LineProps) {
    return <div className={cn(styles.line, short && styles.short, wide && styles.wide)} />
}
