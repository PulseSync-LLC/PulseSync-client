import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Line } from 'react-chartjs-2'
import {
    CategoryScale,
    Chart as ChartJS,
    Filler,
    InteractionMode,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    ScriptableContext,
    Title,
    Tooltip,
} from 'chart.js'
import { MdAccessTime, MdGroups, MdOnlinePrediction, MdTrendingUp } from 'react-icons/md'

import rendererHttpClient from '@shared/api/http/client'
import AddonUploadModal, { type UploadStep } from '@shared/ui/PSUI/AddonUploadModal'
import CustomFormikModalPS from '@shared/ui/PSUI/CustomFormikModalPS'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import toast from '@shared/ui/toast'
import * as styles from '@features/developerTools/DeveloperToolsPanel.module.scss'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler, Legend)

export type DeveloperToolsSection = 'metrics' | 'components' | 'navigation'

interface DeveloperToolsPanelProps {
    section: DeveloperToolsSection
    onNavigate: (path: string) => void
}

type StatPoint = { time: string | number | Date; online: number }

type StatsResponse = {
    data?: StatPoint[]
    ok?: boolean
}

type CountResponse = {
    ok?: boolean
    online?: number
    users?: number
}

const API = {
    stats: '/api/v1/users/stats',
    count: '/api/v1/users/count',
}

const RANGES = [12, 24, 48, 0] as const

const DeveloperToolsPanel: React.FC<DeveloperToolsPanelProps> = ({ section, onNavigate }) => {
    const { t } = useTranslation()
    const [stats, setStats] = useState<StatPoint[]>([])
    const [count, setCount] = useState<{ users: number; online: number } | null>(null)
    const [loading, setLoading] = useState(false)
    const [metricsLoaded, setMetricsLoaded] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
    const [rangeHours, setRangeHours] = useState<(typeof RANGES)[number]>(48)
    const [uploadOpen, setUploadOpen] = useState(false)
    const [modal2Open, setModal2Open] = useState(false)
    const [modal3Open, setModal3Open] = useState(false)
    const [formikModalOpen, setFormikModalOpen] = useState(false)

    const loadAll = useCallback(async () => {
        setLoading(true)
        try {
            const [statsResponse, countResponse] = await Promise.all([
                rendererHttpClient.get<StatsResponse>(API.stats, { auth: true }),
                rendererHttpClient.get<CountResponse>(API.count, { auth: true }),
            ])

            if (statsResponse.ok && statsResponse.data?.ok) {
                setStats(statsResponse.data.data || [])
            } else {
                toast.custom('error', t('common.errorTitle'), t('dev.errors.statsLoad'))
            }

            if (countResponse.ok && countResponse.data?.ok) {
                setCount({ users: countResponse.data.users || 0, online: countResponse.data.online || 0 })
            } else {
                toast.custom('error', t('common.errorTitle'), t('dev.errors.onlineLoad'))
            }

            setLastUpdated(new Date())
        } catch {
            toast.custom('error', t('common.networkTitle'), t('common.fetchFailed'))
        } finally {
            setLoading(false)
        }
    }, [t])

    useEffect(() => {
        if (section !== 'metrics' || metricsLoaded) return
        setMetricsLoaded(true)
        void loadAll()
    }, [loadAll, metricsLoaded, section])

    const filteredStats = useMemo(() => {
        if (!stats.length || rangeHours === 0) return stats
        const from = Date.now() - rangeHours * 3600 * 1000
        return stats.filter(point => new Date(point.time).getTime() >= from)
    }, [rangeHours, stats])

    const formattedStats = useMemo(
        () =>
            filteredStats.map(point => ({
                ...point,
                timeFormatted: new Date(point.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })),
        [filteredStats],
    )

    const maxOnline = useMemo(() => (filteredStats.length ? Math.max(...filteredStats.map(point => point.online)) : 0), [filteredStats])
    const averageOnline = useMemo(
        () => (filteredStats.length ? Math.round(filteredStats.reduce((total, point) => total + point.online, 0) / filteredStats.length) : 0),
        [filteredStats],
    )

    const chartData = useMemo(
        () => ({
            labels: formattedStats.map(point => point.timeFormatted),
            datasets: [
                {
                    label: t('dev.chart.datasetLabel'),
                    data: formattedStats.map(point => point.online),
                    borderColor: '#ffffff',
                    backgroundColor: (context: ScriptableContext<'line'>) => {
                        const { chart } = context
                        const { ctx, chartArea } = chart
                        if (!chartArea) return 'rgba(255, 255, 255, 0.08)'
                        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
                        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
                        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
                        return gradient
                    },
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    borderWidth: 2,
                },
            ],
        }),
        [formattedStats, t],
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
                    backgroundColor: '#2a2a2a',
                    titleFont: { size: 11, family: 'Nunito, sans-serif', weight: '400' as const },
                    bodyFont: { size: 11, family: 'Nunito, sans-serif', weight: '400' as const },
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
                    ticks: { color: '#a0a0a0', font: { size: 10, family: 'Nunito, sans-serif' } },
                    grid: { display: false, drawBorder: false },
                },
                y: {
                    ticks: { color: '#a0a0a0', font: { size: 10, family: 'Nunito, sans-serif' }, padding: 10 },
                    grid: { color: 'rgba(255, 255, 255, 0.06)', drawBorder: false },
                    min: 0,
                    max: maxOnline ? Math.ceil(maxOnline * 1.2) : undefined,
                },
            },
            interaction: { mode: 'index' as InteractionMode, intersect: false },
        }),
        [maxOnline, t],
    )

    const simulate = (ms: number, report: (progress: number, note?: string) => void, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
            const start = Date.now()
            const interval = window.setInterval(() => {
                if (signal.aborted) {
                    clearInterval(interval)
                    reject(new Error(t('common.cancelled')))
                    return
                }
                const progress = Math.min(100, Math.round(((Date.now() - start) / ms) * 100))
                report(progress)
                if (progress >= 100) {
                    clearInterval(interval)
                    resolve()
                }
            }, 120)
        })

    const uploadSteps: UploadStep[] = [
        {
            key: 'manifests',
            label: t('dev.upload.steps.manifests'),
            run: async ({ report, signal }) => simulate(900, report, signal),
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
            run: async ({ report, signal }) => simulate(2000, report, signal),
        },
        {
            key: 'review',
            label: t('dev.upload.steps.review'),
            run: async ({ report, signal }) => simulate(600, report, signal),
        },
    ]

    const toastPreviews = [
        { type: 'success', title: t('common.successTitle'), message: t('common.done'), text: t('common.successTitle') },
        { type: 'error', title: t('common.errorTitle'), message: t('common.errorTitle'), text: t('common.errorTitle') },
        { type: 'warning', title: t('common.warningTitleShort'), message: t('common.caution'), text: t('common.warningTitleShort') },
        { type: 'info', title: t('common.infoTitleShort'), message: t('common.infoTitleShort'), text: t('common.infoTitleShort') },
        { type: 'loading', title: t('common.loadingTitle'), message: t('common.loading'), text: t('common.loadingTitle') },
        { type: 'download', title: t('common.downloadTitle'), message: t('common.downloading'), text: t('common.downloadTitle') },
        { type: 'import', title: t('common.importTitle'), message: t('common.importing'), text: t('common.importTitle') },
        { type: 'export', title: t('common.exportTitle'), message: t('common.exportDone'), text: t('common.exportTitle') },
    ]

    const navigateTo = (path: string) => {
        onNavigate(path)
    }

    const renderMetrics = () => {
        const metricCards = [
            { icon: <MdGroups />, label: t('dev.metrics.totalUsers'), value: count?.users ?? null },
            { icon: <MdOnlinePrediction />, label: t('dev.metrics.onlineNow'), value: count?.online ?? null },
            { icon: <MdAccessTime />, label: t('dev.metrics.averageOnline'), value: averageOnline },
            { icon: <MdTrendingUp />, label: t('dev.metrics.peak'), value: maxOnline },
        ]

        return (
            <div className={styles.panel}>
                <div className={styles.panelHeader}>
                    <div>
                        <h2 className={styles.panelTitle}>{t('dev.sections.metrics')}</h2>
                        <div className={styles.updated}>
                            {t('dev.updatedLabel')}: {lastUpdated ? lastUpdated.toLocaleTimeString() : t('common.emDash')}
                        </div>
                    </div>
                    <button type="button" className={styles.primaryButton} onClick={() => void loadAll()} disabled={loading}>
                        {t('common.refresh')}
                    </button>
                </div>

                <div className={styles.statsGrid}>
                    {metricCards.map(({ icon, label, value }) => (
                        <div key={label} className={styles.statCard}>
                            <div className={styles.statIcon}>{icon}</div>
                            <div>
                                <div className={styles.statLabel}>{label}</div>
                                <div className={styles.statValue}>{value !== null ? value.toLocaleString('ru-RU') : t('common.emDash')}</div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className={styles.chartHeader}>
                    <div className={styles.sectionLabel}>{t('dev.sections.analytics')}</div>
                    <div className={styles.segmented} role="tablist" aria-label={t('dev.rangeLabel')}>
                        {RANGES.map(range => (
                            <button
                                key={range}
                                type="button"
                                role="tab"
                                aria-selected={rangeHours === range}
                                className={`${styles.segmentButton} ${rangeHours === range ? styles.segmentButtonActive : ''}`}
                                onClick={() => setRangeHours(range)}
                            >
                                {range === 0 ? t('common.all') : t('dev.rangeHours', { hours: range })}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.chartCard}>
                    {loading ? (
                        <div className={styles.chartState}>
                            <div className={styles.chartShimmer} aria-hidden="true">
                                <div className={styles.chartShimmerGrid} />
                                <div className={styles.chartShimmerArea} />
                                <div className={styles.chartShimmerLabels}>
                                    {Array.from({ length: 6 }, (_, index) => (
                                        <span key={index} />
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : formattedStats.length ? (
                        <div className={styles.chartWrapper}>
                            <Line data={chartData as any} options={chartOptions as any} />
                        </div>
                    ) : (
                        <div className={styles.chartState}>{t('dev.noData')}</div>
                    )}
                </div>
            </div>
        )
    }

    const renderComponents = () => (
        <div className={styles.panel}>
            <h2 className={styles.panelTitle}>{t('settingsModal.developer.componentsTitle')}</h2>
            <div className={styles.toolList}>
                <div className={styles.toolCard}>
                    <div className={styles.toolHeader}>
                        <div className={styles.toolTitle}>{t('dev.cards.modals.title')}</div>
                        <div className={styles.toolDescription}>{t('dev.cards.modals.subtitle')}</div>
                    </div>
                    <div className={styles.actionGrid}>
                        <button type="button" className={styles.actionButton} onClick={() => setModal2Open(true)}>
                            {t('dev.cards.modals.twoButtons')}
                        </button>
                        <button type="button" className={styles.actionButton} onClick={() => setModal3Open(true)}>
                            {t('dev.cards.modals.threeButtons')}
                        </button>
                    </div>
                </div>

                <div className={styles.toolCard}>
                    <div className={styles.toolHeader}>
                        <div className={styles.toolTitle}>{t('dev.cards.form.title')}</div>
                        <div className={styles.toolDescription}>{t('dev.cards.form.subtitle')}</div>
                    </div>
                    <button type="button" className={styles.actionButton} onClick={() => setFormikModalOpen(true)}>
                        {t('dev.cards.form.open')}
                    </button>
                </div>

                <div className={styles.toolCard}>
                    <div className={styles.toolHeader}>
                        <div className={styles.toolTitle}>{t('dev.cards.upload.title')}</div>
                        <div className={styles.toolDescription}>{t('dev.cards.upload.subtitle')}</div>
                    </div>
                    <button type="button" className={styles.actionButton} onClick={() => setUploadOpen(true)}>
                        {t('dev.cards.upload.open')}
                    </button>
                </div>

                <div className={styles.toolCard}>
                    <div className={styles.toolHeader}>
                        <div className={styles.toolTitle}>{t('dev.cards.toasts.title')}</div>
                        <div className={styles.toolDescription}>{t('dev.cards.toasts.subtitle')}</div>
                    </div>
                    <div className={styles.actionGrid}>
                        {toastPreviews.map(({ type, title, message, text }) => (
                            <button
                                key={type}
                                type="button"
                                className={styles.actionButton}
                                onClick={() => toast.custom(type as any, title, message)}
                            >
                                {text}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )

    const renderNavigation = () => (
        <div className={styles.panel}>
            <h2 className={styles.panelTitle}>{t('dev.sections.navigation')}</h2>
            <p className={styles.panelDescription}>{t('dev.navigationHint')}</p>
            <div className={styles.navigationGrid}>
                <button type="button" className={styles.navigationButton} onClick={() => navigateTo('/users')}>
                    {t('dev.navigation.users')}
                </button>
                <button type="button" className={styles.navigationButton} onClick={() => navigateTo('/extensions')}>
                    {t('dev.navigation.extension')}
                </button>
                <button type="button" className={styles.navigationButton} onClick={() => navigateTo('/joint')}>
                    {t('dev.navigation.joint')}
                </button>
                <button type="button" className={styles.navigationButton} onClick={() => navigateTo('/store')}>
                    {t('dev.navigation.store')}
                </button>
                <button type="button" className={styles.navigationButton} onClick={() => navigateTo('/auth?dev=true')}>
                    {t('dev.navigation.auth')}
                </button>
            </div>
        </div>
    )

    return (
        <>
            {section === 'metrics' ? renderMetrics() : section === 'components' ? renderComponents() : renderNavigation()}

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
                            toast.custom('success', t('dev.formik.submittedTitle'), t('dev.formik.submittedMessage', { value: values?.input ?? '' }))
                            setFormikModalOpen(false)
                        },
                        variant: 'primary',
                        type: 'submit',
                    },
                ]}
            />
        </>
    )
}

export default DeveloperToolsPanel
