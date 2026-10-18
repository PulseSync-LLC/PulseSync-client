import { Menu, type MenuItemConstructorOptions, shell } from 'electron'

import { isDevmark } from '@common/appConfig'

import { t } from '../shared/i18n'
import isAppDev from '../shared/utils/isAppDev'
import { showMainWindow } from './createWindow'
import { checkForUpdates, openAddonsDirectory, openDiscord, openSettings } from './menuActions'
import { isMac } from './utils/appUtils'

export function createApplicationMenu(): void {
    if (!isMac()) return

    const developerMenu: MenuItemConstructorOptions[] =
        isAppDev || isDevmark
            ? [
                  {
                      label: t('main.menu.developer'),
                      submenu: [
                          { label: t('main.menu.reload'), role: 'reload' },
                          { label: t('main.menu.forceReload'), role: 'forceReload' },
                          { type: 'separator' },
                          { label: t('main.menu.devTools'), role: 'toggleDevTools' },
                      ],
                  },
              ]
            : []

    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: 'PulseSync',
                submenu: [
                    { label: t('main.menu.about'), role: 'about' },
                    { type: 'separator' },
                    {
                        label: t('main.menu.settings'),
                        accelerator: 'Command+,',
                        click: openSettings,
                    },
                    { label: t('main.tray.addonsDirectory'), click: openAddonsDirectory },
                    {
                        label: t('main.tray.checkUpdates'),
                        click: async () => {
                            if (!showMainWindow()) return
                            await checkForUpdates()
                        },
                    },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            },
            { label: t('main.menu.edit'), role: 'editMenu' },
            {
                label: t('main.menu.window'),
                role: 'windowMenu',
                submenu: [
                    { role: 'minimize' },
                    { role: 'zoom' },
                    { role: 'close' },
                    { role: 'togglefullscreen' },
                    { type: 'separator' },
                    { label: t('main.menu.showWindow'), click: showMainWindow },
                    { role: 'front' },
                ],
            },
            ...developerMenu,
            {
                label: t('main.menu.help'),
                role: 'help',
                submenu: [
                    {
                        label: t('main.menu.website'),
                        click: async () => {
                            await shell.openExternal('https://pulsesync.dev')
                        },
                    },
                    { label: t('main.tray.openDiscord'), click: openDiscord },
                ],
            },
        ]),
    )
}
