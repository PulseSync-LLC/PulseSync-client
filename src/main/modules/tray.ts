import { app, Menu, MenuItem, shell, Tray } from 'electron'
import { getNativeImg } from '../utils/electronNative'
import { checkOrFindUpdate } from '../events'
import { isMac, isWindows } from '../utils/appUtils'
import path from 'path'
import { setRpcStatus } from './discordRpc'
import { mainWindow } from './createWindow'
import { getState } from './state'
import RendererEvents from '../../common/types/rendererEvents'
import { t } from '../i18n'

let tray: Tray
let menu: Menu
const State = getState()

function createTray() {
    const iconExt = isWindows() ? '.ico' : '.png'
    const icon = getNativeImg('App', iconExt, 'icon').resize({
        width: 16,
        height: 16,
    })
    const dsIcon = getNativeImg('discord', '.png', 'icon').resize({
        width: 16,
        height: 12,
    })
    if (isMac()) {
        icon.setTemplateImage(true)
        dsIcon.setTemplateImage(true)
    }

    tray = new Tray(icon)
    menu = new Menu()

    menu.append(
        new MenuItem({
            label: t('main.tray.openDiscord'),
            icon: dsIcon,
            click: async () => {
                await shell.openExternal('https://discord.gg/qy42uGTzRy')
            },
        }),
    )
    menu.append(
        new MenuItem({
            label: t('main.tray.addonsDirectory'),
            click: async () => {
                const themesFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
                await shell.openPath(themesFolderPath)
            },
        }),
    )
    const menuItem = new MenuItem({
        type: 'checkbox',
        label: t('main.tray.discordRpc'),
        checked: State.get('discordRpc.status'),
        id: 'rpc-status',
        click: async () => {
            setRpcStatus(!State.get('discordRpc.status'))
        },
    })
    menu.append(menuItem)
    menu.append(
        new MenuItem({
            label: t('main.tray.checkUpdates'),
            click: async () => {
                await checkOrFindUpdate()
                mainWindow.webContents.send(RendererEvents.CHECK_MOD_UPDATE)
            },
        }),
    )
    menu.append(
        new MenuItem({
            type: 'separator',
        }),
    )
    menu.append(
        new MenuItem({
            label: t('main.tray.close'),
            accelerator: isMac() ? 'Cmd+Q' : isWindows() ? 'Alt+F4' : 'Ctrl+Q',
            click: app.quit,
        }),
    )
    tray.setToolTip('PulseSync')
    tray.setContextMenu(menu)
    tray.on('click', event => {
        mainWindow.show()
    })
}
export const updateTray = () => {
    menu.getMenuItemById('rpc-status').checked = State.get('discordRpc.status')
    tray.setContextMenu(menu)
}

export default createTray
