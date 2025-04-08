import { app, Menu, MenuItem, shell, Tray } from 'electron'
import { getNativeImg } from '../utils'
import { mainWindow } from '../../index'
import { checkOrFindUpdate } from '../events'
import path from 'path'
import { store } from './storage'
import { setRpcStatus } from './discordRpc'

let tray: Tray
let menu: Menu

function createTray() {
    const icon = getNativeImg('App', '.ico', 'icon').resize({
        width: 16,
        height: 16,
    })
    const dsIcon = getNativeImg('discord', '.png', 'icon').resize({
        width: 16,
        height: 12,
    })

    tray = new Tray(icon)
    menu = new Menu()

    menu.append(
        new MenuItem({
            label: 'Перейти в дискорд PulseSync',
            icon: dsIcon,
            click: async () => {
                await shell.openExternal('https://discord.gg/pulsesync')
            },
        }),
    )
    menu.append(
        new MenuItem({
            label: 'Директория аддонов',
            click: async () => {
                const themesFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
                await shell.openPath(themesFolderPath)
            },
        }),
    )
    const menuItem = new MenuItem({
        type: 'checkbox',
        label: 'Discord RPC',
        checked: store.get('discordRpc.status'),
        id: 'rpc-status',
        click: async () => {
            await setRpcStatus(!store.get('discordRpc.status'))
        },
    })
    menu.append(menuItem)
    menu.append(
        new MenuItem({
            label: 'Проверить обновления',
            click: async () => {
                await checkOrFindUpdate()
                mainWindow.webContents.send('check-mod-update')
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
            label: 'Закрыть',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
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
    menu.getMenuItemById('rpc-status').checked = store.get('discordRpc.status')
    tray.setContextMenu(menu)
}

export default createTray
