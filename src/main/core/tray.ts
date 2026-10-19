import { app, Menu, MenuItem, Tray } from 'electron'

import { t } from '../shared/i18n'
import { showMainWindow } from './createWindow'
import { checkForUpdates, openAddonsDirectory, openDiscord, openSettings } from './menuActions'
import { isMac, isWindows } from './utils/appUtils'
import { getNativeImg } from './utils/electronNative'

let tray: Tray
let menu: Menu

function createTray() {
    const iconExt = isMac() ? '.png' : isWindows() ? '.ico' : '.png'
    const icon = getNativeImg('App', iconExt, 'icon').resize({
        width: 16,
        height: 16,
    })

    const dsIcon = getNativeImg('discord', '.png', 'icon').resize({
        width: 16,
        height: 12,
    })

    tray = tray || new Tray(icon)

    menu = new Menu()

    if (isMac() || isWindows()) {
        menu.append(new MenuItem({ label: t('main.tray.open'), click: showMainWindow }))
        menu.append(new MenuItem({ type: 'separator' }))
    }

    const discordItem = new MenuItem({
        label: t('main.tray.openDiscord'),
        icon: dsIcon,
        click: openDiscord,
    })

    if (isWindows()) {
        menu.append(new MenuItem({ label: t('main.menu.settings'), click: openSettings }))
    } else {
        menu.append(discordItem)
    }

    menu.append(
        new MenuItem({
            label: t('main.tray.addonsDirectory'),
            click: openAddonsDirectory,
        }),
    )

    menu.append(
        new MenuItem({
            label: t('main.tray.checkUpdates'),
            click: isWindows()
                ? async () => {
                      if (!showMainWindow()) return
                      await checkForUpdates()
                  }
                : checkForUpdates,
        }),
    )

    if (isWindows()) {
        menu.append(new MenuItem({ type: 'separator' }))
        menu.append(discordItem)
    }

    menu.append(new MenuItem({ type: 'separator' }))

    menu.append(
        new MenuItem({
            label: t('main.tray.close'),
            accelerator: isMac() ? 'Cmd+Q' : isWindows() ? 'Alt+F4' : 'Ctrl+Q',
            click: () => app.quit(),
        }),
    )

    tray.setToolTip('PulseSync')
    tray.setContextMenu(menu)
    tray.on('click', showMainWindow)
}

export default createTray
