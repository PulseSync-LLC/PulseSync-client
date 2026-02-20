import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import cn from 'clsx'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/layout'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import * as styles from './dev.module.scss'
import toast from '../../components/toast'
import { motion } from 'framer-motion'
import CustomModalPS from '../../components/PSUI/CustomModalPS'
import CustomFormikModalPS from '../../components/PSUI/CustomFormikModalPS'
import ButtonV2 from '../../components/buttonV2'
import AddonUploadModal, { UploadStep } from '../../components/PSUI/AddonUploadModal'
import { Line } from 'react-chartjs-2'
import { useTranslation } from 'react-i18next'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Filler,
    Legend,
    InteractionMode,
    ScriptableContext,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler, Legend)

type StatPoint = { time: string | number | Date; online: number }

const API = {
    stats: 'https://ru-node-1.pulsesync.dev/api/v1/users/stats',
    count: 'https://ru-node-1.pulsesync.dev/api/v1/users/count',
}

const RANGES = [12, 24, 48, 0] as const

function Dev() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [stats, setStats] = useState<StatPoint[]>([])
    const [count, setCount] = useState<{ users: number; online: number } | null>(null)
    const [loading, setLoading] = useState(true)
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

    const [rangeHours, setRangeHours] = useState<(typeof RANGES)[number]>(48)

    const [uploadOpen, setUploadOpen] = useState(false)
    const [modal2Open, setModal2Open] = useState(false)
    const [modal3Open, setModal3Open] = useState(false)
    const [formikModalOpen, setFormikModalOpen] = useState(false)

    const loadAll = useCallback(async () => {
        setLoading(true)
        try {
            const [sRes, cRes] = await Promise.all([fetch(API.stats), fetch(API.count)])
            const sJson = await sRes.json()
            const cJson = await cRes.json()

            if (sJson?.ok) setStats(sJson.data as StatPoint[])
            else toast.custom('error', t('common.errorTitle'), t('dev.errors.statsLoad'))

            if (cJson?.ok) setCount({ users: cJson.users, online: cJson.online })
            else toast.custom('error', t('common.errorTitle'), t('dev.errors.onlineLoad'))

            setLastUpdated(new Date())
        } catch {
            toast.custom('error', t('common.networkTitle'), t('common.fetchFailed'))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadAll()
    }, [loadAll])

    const now = Date.now()
    const filtered = useMemo(() => {
        if (!stats?.length) return []
        if (rangeHours === 0) return stats
        const from = now - rangeHours * 3600 * 1000
        return stats.filter(s => new Date(s.time).getTime() >= from)
    }, [stats, rangeHours, now])

    const formatted = useMemo(
        () =>
            filtered.map(d => ({
                ...d,
                timeFormatted: new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })),
        [filtered],
    )

    const maxOnline = useMemo(() => (filtered.length ? Math.max(...filtered.map(s => s.online)) : 0), [filtered])
    const avgOnline = useMemo(() => (filtered.length ? Math.round(filtered.reduce((acc, s) => acc + s.online, 0) / filtered.length) : 0), [filtered])

    const datasetBg = (ctx: ScriptableContext<'line'>) => {
        const { chart } = ctx
        const { ctx: c, chartArea } = chart
        if (!chartArea) return 'rgba(143, 164, 255, 0.15)'
        const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
        g.addColorStop(0, 'rgba(143,164,255,0.25)')
        g.addColorStop(1, 'rgba(143,164,255,0.00)')
        return g
    }

    const chartData = useMemo(
        () => ({
            labels: formatted.map(d => d.timeFormatted),
            datasets: [
                {
                    label: t('dev.chart.datasetLabel'),
                    data: formatted.map(d => d.online),
                    borderColor: '#8fa4ff',
                    backgroundColor: datasetBg,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    borderWidth: 2,
                },
            ],
        }),
        [formatted, t],
    )

    const chartOptions = useMemo(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    mode: 'index' as InteractionMode,
                    intersect: false,
                    backgroundColor: '#2c303f',
                    titleFont: { size: 11, family: 'Inter, sans-serif', weight: '400' as const },
                    bodyFont: { size: 11, family: 'Inter, sans-serif', weight: '400' as const },
                    padding: 8,
                    cornerRadius: 6,
                    displayColors: false,
                    callbacks: {
                        label: (context: any) => t('dev.chart.usersOnline', { count: context.parsed.y }),
                        title: (context: any[]) => t('dev.chart.timeLabel', { time: context[0].label }),
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: '#b9c2e0', font: { size: 10, family: 'Inter, sans-serif' } },
                    grid: { display: false, drawBorder: false },
                },
                y: {
                    ticks: { color: '#b9c2e0', font: { size: 10, family: 'Inter, sans-serif' }, padding: 10 },
                    grid: { color: 'rgba(255, 255, 255, 0.06)', drawBorder: false },
                    min: 0,
                    max: maxOnline ? Math.ceil(maxOnline * 1.2) : undefined,
                },
            },
            interaction: { mode: 'index' as InteractionMode, intersect: false },
        }),
        [maxOnline, t],
    )

    const statsCards = [
        { icon: '👥', label: t('dev.metrics.totalUsers'), value: count?.users ?? null },
        { icon: '🟢', label: t('dev.metrics.onlineNow'), value: count?.online ?? null },
        { icon: '⏱️', label: t('dev.metrics.averageOnline'), value: avgOnline ?? null },
        { icon: '🚀', label: t('dev.metrics.peak'), value: maxOnline ?? null },
    ]

    const simulate = (ms: number, report: (p: number, note?: string) => void, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
            const start = Date.now()
            const id = window.setInterval(() => {
                if (signal.aborted) {
                    clearInterval(id)
                    reject(new Error(t('common.cancelled')))
                    return
                }
                const p = Math.min(100, Math.round(((Date.now() - start) / ms) * 100))
                report(p)
                if (p >= 100) {
                    clearInterval(id)
                    resolve()
                }
            }, 120)
        })

    const uploadSteps: UploadStep[] = [
        {
            key: 'manifests',
            label: t('dev.upload.steps.manifests'),
            run: async ({ report, signal }) => {
                await simulate(900, report, signal)
            },
        },
        {
            key: 'validate',
            label: t('dev.upload.steps.validate'),
            run: async ({ report, signal }) => {
                report(10, t('dev.upload.scanning'))
                await simulate(1200, report, signal)
            },
        },
        {
            key: 'upload',
            label: t('dev.upload.steps.upload'),
            run: async ({ report, signal }) => {
                await simulate(2000, report, signal)
            },
        },
        {
            key: 'review',
            label: t('dev.upload.steps.review'),
            run: async ({ report, signal }) => {
                await simulate(600, report, signal)
            },
        },
    ]

    return (
        <Layout title={t('dev.pageTitle')}>
            <div className={cn(globalStyles.page, styles.page)}>
                <motion.section
                    className={styles.hero}
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                >
                    <div className={styles.heroLeft}>
                        <span className={styles.badge}>{t('dev.badge')}</span>
                        <h1 className={styles.title}>{t('dev.title')}</h1>
                        <p className={styles.subtitle}>{t('dev.subtitle')}</p>
                    </div>
                    <div className={styles.heroRight}>
                        <div className={styles.updated}>
                            {t('dev.updatedLabel')}: {lastUpdated ? lastUpdated.toLocaleTimeString() : t('common.emDash')}
                        </div>
                        <ButtonV2 className={styles.primaryBtn} onClick={() => loadAll()}>
                            {t('common.refresh')}
                        </ButtonV2>
                    </div>
                </motion.section>

                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('dev.sections.metrics')}</h2>
                    <div className={styles.statsGrid}>
                        {statsCards.map(({ icon, label, value }) => (
                            <div key={label} className={styles.statCard}>
                                <div className={styles.statIcon}>{icon}</div>
                                <div className={styles.statContent}>
                                    <div className={styles.statLabel}>{label}</div>
                                    <div className={styles.statValue}>{value !== null ? value.toLocaleString('ru-RU') : t('common.emDash')}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className={styles.section}>
                    <div className={styles.blockHeader}>
                        <h2 className={styles.sectionTitle}>{t('dev.sections.analytics')}</h2>
                        <div className={styles.segmented} role="tablist" aria-label={t('dev.rangeLabel')}>
                            {RANGES.map(r => (
                                <button
                                    key={r}
                                    role="tab"
                                    aria-selected={rangeHours === r}
                                    className={cn(styles.segBtn, rangeHours === r && styles.segActive)}
                                    onClick={() => setRangeHours(r)}
                                    title={r === 0 ? t('common.all') : t('dev.rangeHours', { hours: r })}
                                >
                                    {r === 0 ? t('common.all') : t('dev.rangeHours', { hours: r })}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={styles.chartCard}>
                        {loading ? (
                            <div className={styles.loadingState}>
                                <div className={styles.loadingSpinner} />
                                <p>{t('dev.loadingAnalytics')}</p>
                            </div>
                        ) : formatted.length ? (
                            <div className={styles.chartWrapper}>
                                <Line data={chartData as any} options={chartOptions as any} />
                            </div>
                        ) : (
                            <div className={styles.emptyState}>{t('dev.noData')}</div>
                        )}
                    </div>
                </section>

                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('dev.sections.components')}</h2>

                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h3>{t('dev.cards.modals.title')}</h3>
                            <p className={styles.cardHint}>{t('dev.cards.modals.subtitle')}</p>
                        </div>
                        <div className={styles.actionsRow}>
                            <ButtonV2 className={styles.actionBtn} onClick={() => setModal2Open(true)}>
                                {t('dev.cards.modals.twoButtons')}
                            </ButtonV2>
                            <ButtonV2 className={styles.actionBtn} onClick={() => setModal3Open(true)}>
                                {t('dev.cards.modals.threeButtons')}
                            </ButtonV2>
                        </div>
                    </div>

                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h3>{t('dev.cards.form.title')}</h3>
                            <p className={styles.cardHint}>{t('dev.cards.form.subtitle')}</p>
                        </div>
                        <div className={styles.actionsRow}>
                            <ButtonV2 className={styles.actionBtn} onClick={() => setFormikModalOpen(true)}>
                                {t('dev.cards.form.open')}
                            </ButtonV2>
                        </div>
                    </div>

                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h3>{t('dev.cards.upload.title')}</h3>
                            <p className={styles.cardHint}>{t('dev.cards.upload.subtitle')}</p>
                        </div>
                        <div className={styles.actionsRow}>
                            <ButtonV2 className={styles.actionBtn} onClick={() => setUploadOpen(true)}>
                                {t('dev.cards.upload.open')}
                            </ButtonV2>
                        </div>
                    </div>

                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h3>{t('dev.cards.toasts.title')}</h3>
                            <p className={styles.cardHint}>{t('dev.cards.toasts.subtitle')}</p>
                        </div>
                        <div className={styles.toastGrid}>
                            {[
                                { type: 'success', title: t('common.successTitle'), message: t('common.done'), text: t('common.successTitle') },
                                { type: 'error', title: t('common.errorTitle'), message: t('common.errorTitle'), text: t('common.errorTitle') },
                                {
                                    type: 'warning',
                                    title: t('common.warningTitleShort'),
                                    message: t('common.caution'),
                                    text: t('common.warningTitleShort'),
                                },
                                {
                                    type: 'info',
                                    title: t('common.infoTitleShort'),
                                    message: t('common.infoTitleShort'),
                                    text: t('common.infoTitleShort'),
                                },
                                { type: 'loading', title: t('common.loadingTitle'), message: t('common.loading'), text: t('common.loadingTitle') },
                                {
                                    type: 'download',
                                    title: t('common.downloadTitle'),
                                    message: t('common.downloading'),
                                    text: t('common.downloadTitle'),
                                },
                                { type: 'import', title: t('common.importTitle'), message: t('common.importing'), text: t('common.importTitle') },
                                { type: 'export', title: t('common.exportTitle'), message: t('common.exportDone'), text: t('common.exportTitle') },
                            ].map(({ type, title, message, text }) => (
                                <ButtonV2 key={type} className={styles.toastBtn} onClick={() => toast.custom(type as any, title, message)}>
                                    {text}
                                </ButtonV2>
                            ))}
                        </div>
                    </div>
                </section>

                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('dev.sections.navigation')}</h2>
                    <p className={styles.cardHint} style={{ marginBottom: '16px' }}>
                        {t('dev.navigationHint')}
                    </p>
                    <div className={styles.navigationGrid}>
                        <ButtonV2 className={styles.navBtn} onClick={() => navigate('/users')}>
                            {t('dev.navigation.users')}
                        </ButtonV2>
                        <ButtonV2 className={styles.navBtn} onClick={() => navigate('/')}>
                            {t('dev.navigation.extension')}
                        </ButtonV2>
                        <ButtonV2 className={styles.navBtn} onClick={() => navigate('/joint')}>
                            {t('dev.navigation.joint')}
                        </ButtonV2>
                        <ButtonV2 className={styles.navBtn} onClick={() => navigate('/auth?dev=true')}>
                            {t('dev.navigation.auth')}
                        </ButtonV2>
                    </div>
                </section>

                <AddonUploadModal
                    isOpen={uploadOpen}
                    onClose={() => setUploadOpen(false)}
                    addonName={t('dev.addonPlaceholder')}
                    steps={uploadSteps}
                    rulesHref="https://example.com/rules"
                />

                <CustomModalPS
                    isOpen={modal2Open}
                    onClose={() => setModal2Open(false)}
                    title={t('dev.modalTwo.title')}
                    text={t('dev.modalTwo.text')}
                    subText={t('dev.updatedLabelWithTime', { time: lastUpdated ? lastUpdated.toLocaleTimeString() : t('common.emDash') })}
                    buttons={[
                        { text: t('common.continue'), onClick: () => setModal2Open(false), variant: 'primary' },
                        { text: t('common.cancel'), onClick: () => setModal2Open(false), variant: 'danger' },
                    ]}
                />

                <CustomModalPS
                    isOpen={modal3Open}
                    onClose={() => setModal3Open(false)}
                    title={t('dev.modalThree.title')}
                    text={t('dev.modalThree.text')}
                    subText={t('dev.modalThree.subText')}
                    buttons={[
                        { text: t('common.do'), onClick: () => setModal3Open(false), variant: 'primary' },
                        { text: t('common.thinkLater'), onClick: () => setModal3Open(false), variant: 'secondary' },
                        { text: t('common.cancel'), onClick: () => setModal3Open(false), variant: 'danger' },
                    ]}
                />

                <CustomFormikModalPS
                    isOpen={formikModalOpen}
                    onClose={() => setFormikModalOpen(false)}
                    title={t('dev.formik.title')}
                    text={t('dev.formik.text')}
                    initialInputValue=""
                    inputPlaceholder={t('dev.formik.placeholder')}
                    onSubmit={values => {
                        toast.custom('success', t('dev.formik.submittedTitle'), t('dev.formik.submittedMessage', { value: values.input }))
                        setFormikModalOpen(false)
                    }}
                    buttons={[
                        { text: t('common.cancel'), onClick: () => setFormikModalOpen(false), variant: 'secondary', type: 'button' },
                        {
                            text: t('common.submit'),
                            onClick: values => {
                                toast.custom(
                                    'success',
                                    t('dev.formik.submittedTitle'),
                                    t('dev.formik.submittedMessage', { value: values?.input ?? '' }),
                                )
                                setFormikModalOpen(false)
                            },
                            variant: 'primary',
                            type: 'submit',
                        },
                    ]}
                />
            </div>
        </Layout>
    )
}

export default Dev
