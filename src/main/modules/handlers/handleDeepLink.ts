import { app, BrowserWindow } from 'electron'
import { state } from './state'
import config from '../../../renderer/api/config'
import isAppDev from 'electron-is-dev'
import logger from '../logger'

let deeplinkUrl: string | null = null

const transformUrlToInternal = (url: string): string => {
    return url.replace(`pulsesync://`, '/')
}

export const checkIsDeeplink = (value: string): boolean => {
    const deeplinkRegexp = /^pulsesync:\/\/.*/
    return deeplinkRegexp.test(value)
}

export const navigateToDeeplink = (window: BrowserWindow, url: string | null): void => {
    if (!url) {
        logger.deeplinkManager.error('Received an empty or null URL for deeplink.')
        return
    }
    logger.deeplinkManager.info(`Received deeplink: ${url}`)

    const regex = /^pulsesync:\/\/([^\/\?]+)\/?(\?.*)?$/
    const match = url.match(regex)

    if (!match) {
        logger.deeplinkManager.error(`URL does not match the expected format: ${url}`)
        return
    }

    const mainPath = match[1]
    logger.deeplinkManager.info(`Extracted main path: ${mainPath}`)

    switch (mainPath) {
        case 'joinRoom': {
            break
        }
        default:
            logger.deeplinkManager.warn(`Unhandled deeplink type: ${mainPath}`)
            break
    }

    window.focus()
    state.deeplink = null
}

export const handleDeeplinkOnApplicationStartup = (): void => {
    if (process.platform !== 'darwin') {
        const lastArgFromProcessArgs = process.argv.pop()
        if (lastArgFromProcessArgs && checkIsDeeplink(lastArgFromProcessArgs)) {
            state.deeplink = lastArgFromProcessArgs
        }
    }
    if (isAppDev) {
        app.setAsDefaultProtocolClient('pulsesync', process.execPath)
    } else {
        app.setAsDefaultProtocolClient('pulsesync')
    }
    app.on('open-url', (event, url) => {
        event.preventDefault()
        state.deeplink = url
        logger.deeplinkManager.info('Open on startup', url)
    })
}

export const handleDeeplink = (window: BrowserWindow): void => {
    app.on('open-url', (event, url) => {
        event.preventDefault()
        navigateToDeeplink(window, url)
    })
    if (state.deeplink) {
        navigateToDeeplink(window, state.deeplink)
    }
}
