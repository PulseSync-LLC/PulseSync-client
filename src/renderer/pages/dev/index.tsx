import React, { useEffect, useState } from 'react'
import Layout from '../../components/layout'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import * as styles from './dev.module.scss'
import toast from '../../components/toast'
import { motion } from 'framer-motion'
import CustomModalPS from '../../components/PSUI/CustomModalPS'
import ButtonV2 from '../../components/buttonV2'

import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer, ReferenceLine, Label, Area, AreaChart } from 'recharts'

function Dev() {
    const [stats, setStats] = useState([])
    const [count, setCount] = useState<{ users: number; online: number } | null>(null)
    const [loading, setLoading] = useState(true)
    const [modalOpen, setModalOpen] = useState(false)

    useEffect(() => {
        const loadStats = fetch('https://ru-node-1.pulsesync.dev/api/v1/users/stats')
            .then(res => res.json())
            .then(json => {
                if (json.ok) {
                    setStats(json.data)
                } else {
                    toast.custom('error', 'Ошибка', 'Ошибка загрузки статистики')
                }
            })

        const loadCount = fetch('https://ru-node-1.pulsesync.dev/api/v1/users/count')
            .then(res => res.json())
            .then(json => {
                if (json.ok) {
                    setCount({ users: json.users, online: json.online })
                } else {
                    toast.custom('error', 'Ошибка', 'Ошибка загрузки онлайна')
                }
            })

        Promise.all([loadStats, loadCount]).finally(() => setLoading(false))
    }, [])

    const formattedData = stats.map(d => ({
        ...d,
        timeRaw: new Date(d.time).toISOString(),
        timeFormatted: new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }))

    const maxOnline = Math.max(...stats.map(s => s.online), 0)

    return (
        <Layout title="Dev">
            <div className={`${globalStyles.page} ${styles.devPage}`}>
                <div className={styles.stats}>
                    <div className={styles.statBlock}>
                        <div className={styles.label}>Users</div>
                        <div className={styles.value}>{count?.users?.toLocaleString('ru-RU') ?? '—'}</div>
                    </div>
                    <div className={styles.statBlock}>
                        <div className={styles.label}>Peak Online 48h</div>
                        <div className={styles.value}>{maxOnline?.toLocaleString('ru-RU') ?? '—'}</div>
                    </div>
                    <div className={styles.statBlock}>
                        <div className={styles.label}>Online Now</div>
                        <div className={styles.value}>{count?.online?.toLocaleString('ru-RU') ?? '—'}</div>
                    </div>
                </div>

                {loading ? (
                    <p>Загрузка...</p>
                ) : (
                    <motion.div
                        className={styles.chartWrapper}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={formattedData}>
                                <defs>
                                    <linearGradient id="gradientOnline" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#a276ff" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#a276ff" stopOpacity={0} />
                                    </linearGradient>
                                </defs>

                                <Tooltip contentStyle={{ backgroundColor: '#2e2e3d', border: 'none' }} isAnimationActive={false} formatter={v => v} />
                                <XAxis dataKey="timeRaw" hide />
                                <Area
                                    type="monotone"
                                    dataKey="online"
                                    stroke="#a276ff"
                                    fill="url(#gradientOnline)"
                                    strokeWidth={2}
                                    isAnimationActive={false}
                                    dot={({ index, cx, cy }) =>
                                        index === formattedData.length - 1 ? <circle cx={cx} cy={cy} r={6} className={styles.pulseDot} /> : null
                                    }
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </motion.div>
                )}
                <ButtonV2 style={{ marginTop: 32 }} onClick={() => setModalOpen(true)}>
                    Показать модалку
                </ButtonV2>
                <CustomModalPS
                    isOpen={modalOpen}
                    onClose={() => setModalOpen(false)}
                    title="Про рыбу"
                    text="Это тестовый вызов нашей кастомной модалки. Можно закрыть кликом по backdrop либо кнопкой."
                    buttons={[
                        {
                            text: 'Отмена',
                            onClick: () => setModalOpen(false),
                            variant: 'secondary',
                        },
                        {
                            text: 'Ok',
                            onClick: () => setModalOpen(false),
                            variant: 'primary',
                        },
                    ]}
                />
            </div>
        </Layout>
    )
}

export default Dev
