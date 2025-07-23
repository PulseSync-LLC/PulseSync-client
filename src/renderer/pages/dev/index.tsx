import React, { useEffect, useState } from 'react'
import Layout from '../../components/layout'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import * as styles from './dev.module.scss'
import toast from '../../components/toast'
import { motion } from 'framer-motion'
import CustomModalPS from '../../components/PSUI/CustomModalPS'
import CustomFormikModalPS from '../../components/PSUI/CustomFormikModalPS'
import ButtonV2 from '../../components/buttonV2'
import { Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler, Legend, InteractionMode } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler, Legend)

function Dev() {
    const [stats, setStats] = useState([])
    const [count, setCount] = useState<{ users: number; online: number } | null>(null)
    const [loading, setLoading] = useState(true)
    const [modalOpen, setModalOpen] = useState(false)
    const [formikModalOpen, setFormikModalOpen] = useState(false)
    const [isHovered, setIsHovered] = useState(false)

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
    const avgOnline = stats.length > 0 ? stats.reduce((sum, s) => sum + s.online, 0) / stats.length : 0

    const chartData = {
        labels: formattedData.map(d => d.timeFormatted),
        datasets: [
            {
                label: 'Online Users',
                data: formattedData.map(d => d.online),
                borderColor: '#8888ff',
                backgroundColor: 'transparent',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 0,
                borderWidth: 2,
            },
        ],
    }

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                enabled: true,
                mode: 'index' as InteractionMode,
                intersect: false,
                backgroundColor: '#2c303f',
                titleFont: {
                    size: 11,
                    family: 'Inter, sans-serif',
                    weight: 400,
                },
                bodyFont: {
                    size: 11,
                    family: 'Inter, sans-serif',
                    weight: 400,
                },
                padding: 8,
                cornerRadius: 4,
                displayColors: false,
                callbacks: {
                    label: (context: { parsed: { y: any } }) => `${context.parsed.y} users online`,
                    title: (context: { label: any }[]) => `Time: ${context[0].label}`,
                },
            },
        },
        scales: {
            x: {
                ticks: { color: '#b0b0b0', font: { size: 10, family: 'Inter, sans-serif' } },
                grid: { display: false, drawBorder: false },
            },
            y: {
                ticks: { color: '#b0b0b0', font: { size: 10, family: 'Inter, sans-serif' }, padding: 10 },
                grid: { color: 'rgba(255, 255, 255, 0.02)', drawBorder: false },
                min: 0,
                max: maxOnline * 1.2,
            },
        },
        interaction: {
            mode: 'index' as InteractionMode,
            intersect: false,
        },
    }

    return (
        <Layout title="Dev">
            <div className={`${globalStyles.page} ${styles.devPage}`}>
                <motion.div
                    className={styles.glassPanel}
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                >
                    <h1 className={styles.header}>Developer Dashboard</h1>

                    <div className={styles.statsGrid}>
                        <div className={styles.statCard}>
                            <div className={styles.statIcon}>👥</div>
                            <div className={styles.statContent}>
                                <div className={styles.statLabel}>Total Users</div>
                                <div className={styles.statValue}>{count?.users?.toLocaleString('ru-RU') ?? '—'}</div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statIcon}>📈</div>
                            <div className={styles.statContent}>
                                <div className={styles.statLabel}>Peak Online (48h)</div>
                                <div className={styles.statValue}>{maxOnline?.toLocaleString('ru-RU') ?? '—'}</div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statIcon}>🟢</div>
                            <div className={styles.statContent}>
                                <div className={styles.statLabel}>Online Now</div>
                                <div className={styles.statValue}>{count?.online?.toLocaleString('ru-RU') ?? '—'}</div>
                            </div>
                        </div>

                        <div className={styles.statCard}>
                            <div className={styles.statIcon}>⏱️</div>
                            <div className={styles.statContent}>
                                <div className={styles.statLabel}>Average Online</div>
                                <div className={styles.statValue}>{Math.round(avgOnline)?.toLocaleString('ru-RU') ?? '—'}</div>
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div className={styles.loadingContainer}>
                            <div className={styles.loadingSpinner} />
                            <p>Loading analytics data...</p>
                        </div>
                    ) : (
                        <div className={styles.chartContainer} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
                            <div className={styles.chartHeader}>
                                <h3>User Activity</h3>
                                <div className={styles.timeRange}>Last 48 hours</div>
                            </div>
                            <div className={styles.chartWrapper}>
                                <Line data={chartData} options={chartOptions} />
                            </div>
                        </div>
                    )}

                    <div className={styles.actionsSection}>
                        <h3 className={styles.sectionTitle}>UI Components</h3>
                        <div className={styles.actionButtons}>
                            <ButtonV2 className={styles.devButton} onClick={() => setModalOpen(true)}>
                                Show Modal
                            </ButtonV2>
                            <ButtonV2 className={styles.devButton} onClick={() => setFormikModalOpen(true)}>
                                Show Formik Modal
                            </ButtonV2>
                        </div>
                    </div>

                    <div className={styles.toastSection}>
                        <h3 className={styles.sectionTitle}>Toast Notifications</h3>
                        <div className={styles.toastGrid}>
                            {[
                                { type: 'success', title: 'Success', message: 'Operation completed', icon: '✅' },
                                { type: 'error', title: 'Error', message: 'Something went wrong', icon: '❌' },
                                { type: 'warning', title: 'Warning', message: 'Be careful', icon: '⚠️' },
                                { type: 'info', title: 'Info', message: 'Helpful information', icon: 'ℹ️' },
                                { type: 'loading', title: 'Loading', message: 'Processing...', icon: '⏳' },
                                { type: 'download', title: 'Download', message: 'Fetching data...', icon: '⬇️' },
                                { type: 'import', title: 'Import', message: 'Importing files', icon: '📤' },
                                { type: 'export', title: 'Export', message: 'Export complete', icon: '📥' },
                            ].map(({ type, title, message }) => (
                                <ButtonV2 key={type} className={styles.devButton} onClick={() => toast.custom(type as any, title, message)}>
                                    {title}
                                </ButtonV2>
                            ))}
                        </div>
                    </div>
                </motion.div>

                <CustomModalPS
                    isOpen={modalOpen}
                    onClose={() => setModalOpen(false)}
                    title="Sample Modal"
                    text="This is a demonstration of our custom modal component."
                    buttons={[
                        { text: 'Cancel', onClick: () => setModalOpen(false), variant: 'secondary' },
                        { text: 'Confirm', onClick: () => setModalOpen(false), variant: 'primary' },
                    ]}
                />

                <CustomFormikModalPS
                    isOpen={formikModalOpen}
                    onClose={() => setFormikModalOpen(false)}
                    title="Form Example"
                    text="Please enter your information below:"
                    initialInputValue=""
                    inputPlaceholder="Type something..."
                    onSubmit={values => {
                        toast.custom('success', 'Submitted', `You entered: ${values.input}`)
                        setFormikModalOpen(false)
                    }}
                    buttons={[
                        { text: 'Cancel', onClick: () => setFormikModalOpen(false), variant: 'secondary' },
                        {
                            text: 'Submit',
                            onClick: values => {
                                toast.custom('success', 'Submitted', `You entered: ${values?.input}`)
                                setFormikModalOpen(false)
                            },
                            variant: 'primary',
                        },
                    ]}
                />
            </div>
        </Layout>
    )
}

export default Dev
