import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
            else toast.custom('error', 'Ошибка', 'Ошибка загрузки статистики')

            if (cJson?.ok) setCount({ users: cJson.users, online: cJson.online })
            else toast.custom('error', 'Ошибка', 'Ошибка загрузки онлайна')

            setLastUpdated(new Date())
        } catch {
            toast.custom('error', 'Сеть', 'Не удалось получить данные')
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
                    label: 'Online Users',
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
        [formatted],
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
                        label: (context: any) => `${context.parsed.y} users online`,
                        title: (context: any[]) => `Time: ${context[0].label}`,
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
        [maxOnline],
    )

    const statsCards = [
        { icon: '👥', label: 'Всего пользователей', value: count?.users ?? null },
        { icon: '🟢', label: 'Сейчас онлайн', value: count?.online ?? null },
        { icon: '⏱️', label: 'Средний онлайн', value: avgOnline ?? null },
        { icon: '🚀', label: 'Пик за период', value: maxOnline ?? null },
    ]

    const simulate = (ms: number, report: (p: number, note?: string) => void, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
            const start = Date.now()
            const id = window.setInterval(() => {
                if (signal.aborted) {
                    clearInterval(id)
                    reject(new Error('Отменено'))
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
            label: 'Создание .manifests',
            run: async ({ report, signal }) => {
                await simulate(900, report, signal)
            },
        },
        {
            key: 'validate',
            label: 'Проверка файлов',
            run: async ({ report, signal }) => {
                report(10, 'Сканирование…')
                await simulate(1200, report, signal)
            },
        },
        {
            key: 'upload',
            label: 'Отправка на сервер',
            run: async ({ report, signal }) => {
                await simulate(2000, report, signal)
            },
        },
        {
            key: 'review',
            label: 'Отправлено на рассмотрение',
            run: async ({ report, signal }) => {
                await simulate(600, report, signal)
            },
        },
    ]

    return (
        <Layout title="Dev Gallery">
            <div className={`${globalStyles.page} ${styles.page}`}>
                <motion.section
                    className={styles.hero}
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                >
                    <div className={styles.heroLeft}>
                        <span className={styles.badge}>DEV</span>
                        <h1 className={styles.title}>Developer Gallery</h1>
                        <p className={styles.subtitle}>Прокручивай вниз и пробуй компоненты вживую.</p>
                    </div>
                    <div className={styles.heroRight}>
                        <div className={styles.updated}>Обновлено: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</div>
                        <ButtonV2 className={styles.primaryBtn} onClick={() => loadAll()}>
                            Обновить
                        </ButtonV2>
                    </div>
                </motion.section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Метрики</h2>
                <div className={styles.statsGrid}>
                    {statsCards.map(({ icon, label, value }) => (
                        <div key={label} className={styles.statCard}>
                            <div className={styles.statIcon}>{icon}</div>
                            <div className={styles.statContent}>
                                <div className={styles.statLabel}>{label}</div>
                                <div className={styles.statValue}>{value !== null ? value.toLocaleString('ru-RU') : '—'}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.blockHeader}>
                    <h2 className={styles.sectionTitle}>Аналитика</h2>
                    <div className={styles.segmented} role="tablist" aria-label="Диапазон">
                        {RANGES.map(r => (
                            <button
                                key={r}
                                role="tab"
                                aria-selected={rangeHours === r}
                                className={`${styles.segBtn} ${rangeHours === r ? styles.segActive : ''}`}
                                onClick={() => setRangeHours(r)}
                                title={r === 0 ? 'Все' : `${r}ч`}
                            >
                                {r === 0 ? 'Все' : `${r}ч`}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.chartCard}>
                    {loading ? (
                        <div className={styles.loadingState}>
                            <div className={styles.loadingSpinner} />
                            <p>Загружаем аналитику…</p>
                        </div>
                    ) : formatted.length ? (
                        <div className={styles.chartWrapper}>
                            <Line data={chartData as any} options={chartOptions as any} />
                        </div>
                    ) : (
                        <div className={styles.emptyState}>Нет данных за выбранный период</div>
                    )}
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Компоненты</h2>

                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h3>Модальные окна</h3>
                        <p className={styles.cardHint}>Проверь горизонтальную и вертикальную раскладки кнопок</p>
                    </div>
                    <div className={styles.actionsRow}>
                        <ButtonV2 className={styles.actionBtn} onClick={() => setModal2Open(true)}>
                            Открыть модалку (2 кнопки)
                        </ButtonV2>
                        <ButtonV2 className={styles.actionBtn} onClick={() => setModal3Open(true)}>
                            Открыть модалку (3 кнопки)
                        </ButtonV2>
                    </div>
                </div>

                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h3>Форма (Formik)</h3>
                        <p className={styles.cardHint}>Интерактивный ввод с подтверждением</p>
                    </div>
                    <div className={styles.actionsRow}>
                        <ButtonV2 className={styles.actionBtn} onClick={() => setFormikModalOpen(true)}>
                            Открыть форму
                        </ButtonV2>
                    </div>
                </div>

                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h3>Выгрузка аддона</h3>
                        <p className={styles.cardHint}>Интерактивная выгрузка аддона</p>
                    </div>
                    <div className={styles.actionsRow}>
                        <ButtonV2 className={styles.actionBtn} onClick={() => setUploadOpen(true)}>
                            Выгрузка аддона (модалка)
                        </ButtonV2>
                    </div>
                </div>

                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <h3>Toast-уведомления</h3>
                        <p className={styles.cardHint}>Быстрые проверки разных типов</p>
                    </div>
                    <div className={styles.toastGrid}>
                        {[
                            { type: 'success', title: 'Success', message: 'Готово', text: 'Success' },
                            { type: 'error', title: 'Error', message: 'Ошибка', text: 'Error' },
                            { type: 'warning', title: 'Warning', message: 'Осторожно', text: 'Warning' },
                            { type: 'info', title: 'Info', message: 'Инфо', text: 'Info' },
                            { type: 'loading', title: 'Loading', message: 'Загрузка…', text: 'Loading' },
                            { type: 'download', title: 'Download', message: 'Скачиваем…', text: 'Download' },
                            { type: 'import', title: 'Import', message: 'Импорт…', text: 'Import' },
                            { type: 'export', title: 'Export', message: 'Экспорт готов', text: 'Export' },
                        ].map(({ type, title, message, text }) => (
                            <ButtonV2 key={type} className={styles.toastBtn} onClick={() => toast.custom(type as any, title, message)}>
                                {text}
                            </ButtonV2>
                        ))}
                    </div>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Навигация</h2>
                <p className={styles.cardHint} style={{ marginBottom: '16px' }}>
                    Быстрая навигация на все роуты приложения
                </p>
                <div className={styles.navigationGrid}>
                    <ButtonV2 className={styles.navBtn} onClick={() => navigate('/')}>
                        TrackInfo
                    </ButtonV2>
                    <ButtonV2 className={styles.navBtn} onClick={() => navigate('/users')}>
                        Users
                    </ButtonV2>
                    <ButtonV2 className={styles.navBtn} onClick={() => navigate('/extension')}>
                        Extension
                    </ButtonV2>
                    <ButtonV2 className={styles.navBtn} onClick={() => navigate('/joint')}>
                        Joint
                    </ButtonV2>
                    <ButtonV2 className={styles.navBtn} onClick={() => navigate('/auth?dev=true')}>
                        Auth
                    </ButtonV2>
                </div>
            </section>

            <AddonUploadModal
                isOpen={uploadOpen}
                onClose={() => setUploadOpen(false)}
                addonName="НАЗВАНИЕ"
                steps={uploadSteps}
                rulesHref="https://example.com/rules"
            />

            <CustomModalPS
                isOpen={modal2Open}
                onClose={() => setModal2Open(false)}
                title="Подтверждение действия"
                text="Это модалка с двумя кнопками. Кнопки расположены горизонтально."
                subText={`Обновлено: ${lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}`}
                buttons={[
                    { text: 'Продолжить', onClick: () => setModal2Open(false), variant: 'primary' },
                    { text: 'Отмена', onClick: () => setModal2Open(false), variant: 'danger' },
                ]}
            />

            <CustomModalPS
                isOpen={modal3Open}
                onClose={() => setModal3Open(false)}
                title="Несколько вариантов"
                text="Три кнопки — раскладка по вертикали, как в дизайне."
                subText="Проверь поведение по Tab/ESC и клику на фон."
                buttons={[
                    { text: 'Сделать', onClick: () => setModal3Open(false), variant: 'primary' },
                    { text: 'Подумать позже', onClick: () => setModal3Open(false), variant: 'secondary' },
                    { text: 'Отмена', onClick: () => setModal3Open(false), variant: 'danger' },
                ]}
            />

                <CustomFormikModalPS
                    isOpen={formikModalOpen}
                    onClose={() => setFormikModalOpen(false)}
                    title="Форма примера"
                    text="Введите произвольный текст и подтвердите:"
                    initialInputValue=""
                    inputPlaceholder="Type anything…"
                    onSubmit={values => {
                        toast.custom('success', 'Submitted', `You entered: ${values.input}`)
                        setFormikModalOpen(false)
                    }}
                    buttons={[
                        { text: 'Cancel', onClick: () => setFormikModalOpen(false), variant: 'secondary', type: 'button' },
                        {
                            text: 'Submit',
                            onClick: values => {
                                toast.custom('success', 'Submitted', `You entered: ${values?.input ?? ''}`)
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
