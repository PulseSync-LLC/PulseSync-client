import React, { useState } from 'react'
import Layout from '../../components/layout'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import * as styles from './dev.module.scss'
import toast from '../../components/toast'

function Dev() {
    const [downloadProgress, setDownloadProgress] = useState(0)

    const handleSuccess = () => {
        toast.custom('success', 'Отлично', 'Операция выполнена успешно!')
    }

    const handleError = () => {
        toast.custom('error', 'Ошибка', 'Произошла ошибка во время выполнения!')
    }

    const handleWarning = () => {
        toast.custom('warning', 'Предупреждение', 'Будьте осторожны!')
    }

    const handleInfo = () => {
        toast.custom('info', 'Информация', 'Обновление данных завершено.')
    }

    const handleExport = () => {
        toast.custom('export', 'Экспорт', 'Экспорт данных завершён успешно!')
    }

    const handleImport = () => {
        toast.custom('import', 'Импорт', 'Импорт данных завершён успешно!')
    }

    const handleDownload = () => {
        const duration = 6000
        const intervalTime = 100
        const steps = duration / intervalTime
        const step = 100 / steps

        let progress = 0

        toast.custom(
            'loading',
            'Скачивание',
            <>
                <span>Загрузка обновления</span>
                <b style={{ marginLeft: '.5em' }}>{Math.floor(progress)}%</b>
            </>,
            { id: 'download-toast' },
            progress,
        )

        const interval = setInterval(() => {
            progress += step

            if (progress >= 100) {
                clearInterval(interval)
                progress = 100
                toast.custom('success', 'Готово', 'Скачивание завершено!', {
                    id: 'download-toast',
                })
            } else {
                toast.custom(
                    'loading',
                    'Скачивание',
                    <>
                        <span>Загрузка обновления</span>
                        <b style={{ marginLeft: '.5em' }}>{Math.floor(progress)}%</b>
                    </>,
                    { id: 'download-toast' },
                    progress,
                )
            }
        }, intervalTime)
    }

    return (
        <Layout title="Dev">
            <div className={`${globalStyles.page} ${styles.devPage}`}>
                <h1 className={styles.header}>Тестирование Уведомлений</h1>
                <div className={styles.buttonContainer}>
                    <button className={`${styles.button} ${styles.success}`} onClick={handleSuccess}>
                        Показать "Успех"
                    </button>
                    <button className={`${styles.button} ${styles.error}`} onClick={handleError}>
                        Показать "Ошибка"
                    </button>
                    <button className={`${styles.button} ${styles.warning}`} onClick={handleWarning}>
                        Показать "Предупреждение"
                    </button>
                    <button className={`${styles.button} ${styles.info}`} onClick={handleInfo}>
                        Показать "Информация"
                    </button>
                    <button className={`${styles.button} ${styles.export}`} onClick={handleExport}>
                        Показать "Экспорт"
                    </button>
                    <button className={`${styles.button} ${styles.import}`} onClick={handleImport}>
                        Показать "Импорт"
                    </button>
                    <button className={`${styles.button} ${styles.loading}`} onClick={handleDownload}>
                        Начать загрузку
                    </button>
                </div>
            </div>
        </Layout>
    )
}

export default Dev
