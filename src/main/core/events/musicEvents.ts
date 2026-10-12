import { ipcMain } from 'electron'

import fs from 'original-fs'

import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

import { t } from '../../shared/i18n'
import logger from '../../shared/logger'
import { musicPath } from '../startup/runtimeState'
import { getFfmpegMeta, getYtDlpMeta } from '../submodulesChecker'
import { checkMusic, findAppByName, getInstalledYmMetadata, isLinux, isYandexMusicRunning, uninstallApp } from '../utils/appUtils'

import type { SubcomponentsMeta } from '@common/types/subcomponentsMeta'
import type { BrowserWindow } from 'electron'

export const registerMusicStatusEvents = (): void => {
    ipcMain.handle(MainEvents.GET_MUSIC_STATUS, async () => {
        if (isLinux()) return true
        else return fs.existsSync(musicPath)
    })

    ipcMain.handle(MainEvents.GET_MUSIC_RUNNING_STATUS, async () => {
        return await isYandexMusicRunning()
    })

    ipcMain.handle(MainEvents.GET_MUSIC_VERSION, async () => {
        const metadata = await getInstalledYmMetadata()
        return metadata?.version
    })

    ipcMain.on(MainEvents.CHECK_MUSIC_INSTALL, () => {
        checkMusic()
    })
}

export const registerYandexMusicEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.DELETE_YANDEX_MUSIC_APP, async _event => {
        try {
            logger.main.info(t('main.events.yandexUninstallStart'))

            const namePart = 'Yandex.Music'
            const pkg = await findAppByName(namePart)

            if (!pkg) {
                logger.main.warn(t('main.events.yandexNotFound'))
                window.webContents.send(RendererEvents.DELETE_YANDEX_MUSIC_RESULT, {
                    success: false,
                    message: t('main.events.yandexNotFoundMessage'),
                })
                return
            }

            try {
                logger.main.info(`Uninstalling Yandex Music: ${pkg.PackageFullName}`)
                await uninstallApp(pkg.PackageFullName)

                logger.main.info(t('main.events.yandexUninstallSuccess'))
                window.webContents.send(RendererEvents.DELETE_YANDEX_MUSIC_RESULT, {
                    success: true,
                    message: t('main.events.yandexUninstallSuccessMessage'),
                })
            } catch (uninstallErr) {
                logger.main.error(`Uninstall error: ${(uninstallErr as Error).message}`)
                window.webContents.send(RendererEvents.DELETE_YANDEX_MUSIC_RESULT, {
                    success: false,
                    message: t('main.events.yandexUninstallFailedWithReason', { message: (uninstallErr as Error).message }),
                })
            }
        } catch (error: any) {
            logger.main.error(`Uninstall exception: ${error.message}`)
            window.webContents.send(RendererEvents.DELETE_YANDEX_MUSIC_RESULT, {
                success: false,
                message: t('main.events.yandexUninstallError'),
            })
        }
    })
    ipcMain.handle(MainEvents.GET_SUBCOMPONENTS_META, async () => {
        const meta: SubcomponentsMeta = {
            ffmpeg: await getFfmpegMeta(),
            ytdlp: await getYtDlpMeta(),
        }

        return meta
    })
}
