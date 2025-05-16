import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { app, dialog, ipcMain } from 'electron'
import { mainWindow, selectedAddon } from '../../index'
import { authorized } from '../events'
import isAppDev from 'electron-is-dev'
import logger from './logger'
import { WebSocketServer, WebSocket } from 'ws'
import { EventEmitter } from 'events'
import trackInitials from '../../renderer/api/initials/track.initials'
import { isFirstInstance } from './singleInstance'
import config from '../../config.json'
import { store } from './storage'
import { parse } from 'url'
import { Track } from '../../renderer/api/interfaces/track.interface'

const eventEmitter = new EventEmitter()
let data: any = {}
let server: http.Server | null = null
export let ws: WebSocketServer | null = null
let attempt = 0

const startWebSocketServer = () => {
    if (!isFirstInstance) return

    if (ws) {
        ws.clients.forEach(client => client.close())
        ws.close(() => {
            ws = null
            logger.http.log('Existing WebSocket server closed.')
        })
    }

    if (server) {
        server.close(() => {
            logger.http.log('HTTP server closed for WebSocket restart.')
            initializeServer()
        })
    } else {
        initializeServer()
    }
}

const stopWebSocketServer = () => {
    try {
        if (ws) {
            ws.clients.forEach(client => client.close())
            ws.close()
            logger.http.log('WebSocket server stopped.')
            ws = null
        }

        if (server) {
            server.close(() => {
                logger.http.log('HTTP server closed.')
                server = null
            })
        }
    } catch (error) {
        logger.http.error('Error while stopping WebSocket server:', error)
    }
}

const initializeServer = () => {
    server = http.createServer()
    ws = new WebSocketServer({ server })

    ws.on('connection', (socket: WebSocket, request) => {
        const parsedUrl = parse(request.url || '', true)
        const version = parsedUrl.query.v || store.get('mod.version')
        const clientType = parsedUrl.query.type || 'yaMusic'
        logger.http.log(`New client connected with version: ${version} and cmd: ${clientType}`)
        ;(socket as any).clientType = clientType

        socket.send(JSON.stringify({ cmd: 'WELCOME', message: 'Connected to server' }))

        if (clientType !== 'web' && authorized) {
            sendDataToMusic()
        }

        socket.on('message', (message: any) => {
            try {
                const dataReceived = JSON.parse(message)
                if (dataReceived.cmd) {
                    switch (dataReceived.cmd) {
                        case 'BROWSER_AUTH':
                            logger.http.log('Received BROWSER_AUTH event:', dataReceived)
                            const userId = dataReceived.args.userId
                            fetch(`${config.SERVER_URL}/api/v1/user/${userId}/access`)
                                .then(async res => {
                                    const j = await res.json()
                                    if (j.ok) {
                                        if (!j.access) {
                                            logger.deeplinkManager.error(`Access denied for user with id: ${userId}. Quitting app.`)
                                            return app.quit()
                                        } else {
                                            logger.deeplinkManager.info(`Access granted for user with id: ${userId}.`)
                                        }
                                    } else {
                                        logger.deeplinkManager.error(
                                            `Server returned an unsuccessful response for user with id: ${userId}. Quitting app.`,
                                        )
                                        return app.quit()
                                    }
                                })
                                .catch(error => {
                                    logger.deeplinkManager.error(`Error during request for user with id: ${userId}: ${error}`)
                                    return app.quit()
                                })

                            store.set('tokens.token', dataReceived.args.token)
                            mainWindow.webContents.send('authSuccess')
                            break
                        case 'BROWSER_BAN':
                            logger.http.log('Received BROWSER_BAN event:', dataReceived)
                            mainWindow.webContents.send('authBanned', { reason: dataReceived.args.reason })
                            break
                        case 'UPDATE_DATE':
                            if (!authorized) break
                            logger.http.log('Received UPDATE_DATA event')
                            updateData(dataReceived.data)
                            break
                        case 'SEND_TRACK':
                            if (!authorized) break
                            logger.http.log('Received SEND_TRACK event:', dataReceived)
                            mainWindow.webContents.send('SEND_TRACK', { data: dataReceived.data })
                            break
                        default:
                            logger.http.warn('Unknown command received:', dataReceived)
                    }
                    return
                }
            } catch (err) {
                logger.http.error('Error processing WebSocket message:', err)
            }
        })

        socket.on('close', () => {
            logger.http.log('Client disconnected')

            mainWindow.webContents.send('trackinfo', {
                data: {
                    trackInitials,
                },
            })
        })

        socket.on('error', (error: any) => {
            if (error.code === 'EPIPE') {
                logger.http.warn('Attempted to write to closed WebSocket')
            } else {
                logger.http.error('WebSocket error:', error)
            }
        })
    })

    ws.on('error', error => {
        if (error.message.includes('unexpected response')) {
            logger.http.error('Unexpected WebSocket server response:', error)
        }
    })

    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
        if (req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': 'music-application://desktop',
                'Access-Control-Allow-Methods': 'POST',
                'Access-Control-Allow-Headers': 'Content-Type',
            })
            res.end()
            return
        }

        const parsedUrl = parse(req.url!, true)

        if (req.method === 'GET' && parsedUrl.pathname === '/get_handle') {
            handleGetHandleRequest(req, res)
            return
        }

        if (req.method === 'GET' && parsedUrl.pathname === '/assets') {
            handleGetAssetsRequest(req, res)
            return
        }

        if (req.method === 'GET' && parsedUrl.pathname?.startsWith('/assets/')) {
            handleGetAssetFileRequest(req, res)
            return
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
    })

    server.listen(config.PORT, () => {
        logger.http.log(`WebSocket server started on port ${config.PORT}`)
        attempt = 0
    })

    server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
            logger.http.error(`Port ${config.PORT} is already in use.`)
            if (attempt > 5) {
                dialog.showErrorBox('Ошибка', `Не удалось запустить вебсокет сервер. Порт ${config.PORT} занят.`)
                return app.quit()
            }
            attempt++
            setTimeout(() => {
                server.close()
                server.listen(config.PORT, () => {
                    attempt = 0
                    logger.http.log(`WebSocket server restarted on port ${config.PORT}`)
                })
            }, 1000)
        } else {
            logger.http.error('HTTP server error:', error)
        }
    })
}

export const setAddon = (theme: string) => {
    if (!authorized) return
    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    const themePath = path.join(themesPath, selectedAddon)
    const metadataPath = path.join(themePath, 'metadata.json')

    if (!fs.existsSync(metadataPath)) {
        return
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    let scriptJS = null
    let cssContent = ''
    let jsContent = ''
    const styleCSS = path.join(themePath, metadata.css)
    if (metadata.script) {
        scriptJS = path.join(themePath, metadata.script)
        if (fs.existsSync(scriptJS)) {
            jsContent = fs.readFileSync(scriptJS, 'utf8')
        }
    }

    if (fs.existsSync(styleCSS)) {
        cssContent = fs.readFileSync(styleCSS, 'utf8')
    }

    const themeData = {
        name: selectedAddon,
        css: cssContent || '{}',
        script: jsContent || '',
    }
    if ((!metadata.type || (metadata.type !== 'theme' && metadata.type !== 'script')) && metadata.name !== 'Default') {
        return
    }
    const waitForSocket = new Promise<void>(resolve => {
        const interval = setInterval(() => {
            if (ws && ws.clients && ws.clients.size > 0) {
                clearInterval(interval)
                resolve()
            }
        }, 100)
    })

    waitForSocket.then(() => {
        ws.clients.forEach(x => {
            if ((x as any).clientType === 'yaMusic' && authorized) {
                x.send(
                    JSON.stringify({
                        ok: true,
                        theme: themeData,
                        cmd: 'THEME',
                    }),
                )
            }
        })
    })
}

export const sendAddon = (withJs: boolean, themeDef?: boolean) => {
    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    const themePath = path.join(themesPath, themeDef ? 'Default' : store.get('addons.theme') || 'Default')
    const metadataPath = path.join(themePath, 'metadata.json')

    if (!fs.existsSync(metadataPath)) {
        return
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    let scriptJS = null
    let cssContent = ''
    let jsContent = ''
    const styleCSS = path.join(themePath, metadata.css)
    if (metadata.script) {
        scriptJS = path.join(themePath, metadata.script)
        if (fs.existsSync(scriptJS)) {
            jsContent = fs.readFileSync(scriptJS, 'utf8')
        }
    }

    if (fs.existsSync(styleCSS)) {
        cssContent = fs.readFileSync(styleCSS, 'utf8')
    }

    const themeData = {
        name: store.get('addons.theme') || 'Default',
        css: cssContent || '{}',
        script: jsContent || '',
    }
    if ((!metadata.type || (metadata.type !== 'theme' && metadata.type !== 'script')) && !themeDef) {
        return
    }
    if (!ws) return
    if (!withJs) {
        ws.clients.forEach(x => {
            if ((x as any).clientType === 'yaMusic' && authorized) {
                x.send(
                    JSON.stringify({
                        ok: true,
                        theme: themeData,
                        cmd: 'UPDATE_CSS',
                    }),
                )
            }
        })
    } else {
        ws.clients.forEach(x => {
            if ((x as any).clientType === 'yaMusic' && authorized) {
                x.send(
                    JSON.stringify({
                        ok: true,
                        theme: themeData,
                        cmd: 'THEME',
                    }),
                )
            }
        })
    }
}

const sendExtensions = async () => {
    if (!ws) return
    const scripts = store.get('addons.scripts')
    if (!scripts) return
    logger.http.log('Refreshing extensions')

    const addonsFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    const addonsRead = fs.readdirSync(addonsFolderPath)

    const filteredAddons = addonsRead.filter(addon => scripts.includes(addon))

    const extensionsData = await Promise.all(
        filteredAddons.map(async addon => {
            const addonPath = path.join(addonsFolderPath, addon)
            const metadataPath = path.join(addonPath, 'metadata.json')

            if (fs.existsSync(metadataPath)) {
                try {
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))

                    if ((!metadata.type || (metadata.type !== 'theme' && metadata.type !== 'script')) && addon !== 'Default') {
                        return null
                    }

                    const cssContent = metadata.css ? fs.readFileSync(path.join(addonPath, metadata.css), 'utf-8') : null
                    const scriptContent = metadata.script ? fs.readFileSync(path.join(addonPath, metadata.script), 'utf-8') : null

                    return {
                        addon,
                        css: cssContent,
                        script: scriptContent,
                    }
                } catch (err) {
                    logger.http.log(`Error reading metadata.json for ${addon}: ${err.message}`)
                    return null
                }
            }
            return null
        }),
    )

    const validExtensions = extensionsData.filter(item => item !== null)

    ws.clients.forEach(x => {
        if ((x as any).clientType === 'web') return
        x.send(
            JSON.stringify({
                ok: true,
                cmd: 'REFRESH_EXTENSIONS',
                addons: validExtensions,
            }),
        )
    })
}

ipcMain.on('WEBSOCKET_START', async (event, _) => {
    if (isAppDev && !store.get('settings.devSocket')) return
    logger.http.log('Received WEBSOCKET_START event. Starting WebSocket server...')
    startWebSocketServer()
})

ipcMain.on('WEBSOCKET_STOP', async (event, _) => {
    logger.http.log('Received WEBSOCKET_STOP event. Stopping WebSocket server...')
    stopWebSocketServer()
})

ipcMain.on('WEBSOCKET_RESTART', async (event, _) => {
    logger.http.log('Received WEBSOCKET_RESTART event. Restarting WebSocket server...')
    stopWebSocketServer()
    setTimeout(() => {
        startWebSocketServer()
    }, 1500)
})

ipcMain.on('REFRESH_MOD_INFO', async (event, _) => {
    sendDataToMusic()
    logger.http.log('Received REFRESH_MOD_INFO event. Send info to Yandex Music...')
})
ipcMain.on('REFRESH_EXTENSIONS', async (event, _) => {
    await sendExtensions()
})

ipcMain.on('GET_TRACK_INFO', async (event, _) => {
    logger.http.log('Returning current track data')
    if (!ws) return
    ws.clients.forEach(x =>
        x.send(
            JSON.stringify({
                ok: true,
                cmd: 'GET_TRACK_INFO',
            }),
        ),
    )
})

const sendDataToMusic = () => {
    if (!ws?.clients) return
    sendAddon(true, true)
    const waitSockets = new Promise<void>(resolve => {
        const interval = setInterval(() => {
            if (ws && ws.clients && ws.clients.size > 0) {
                clearInterval(interval)
                resolve()
            }
        }, 100)
    })

    waitSockets.then(() => {
        ws.clients.forEach(x => {
            if ((x as any).clientType === 'yaMusic' && authorized) {
                x.send(
                    JSON.stringify({
                        ok: true,
                        cmd: 'REFRESH_EXTENSIONS',
                        addons: [],
                    }),
                )
                logger.http.log('Data sent to Yandex Music')
            }
        })
    })
    setTimeout(async () => {
        sendAddon(true)
        await sendExtensions()
    }, 1000)
}
const handleGetHandleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const urlObj = parse(req.url!, true)
        const name = urlObj.query.name as string
        if (!name) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Handle events data not found' }))
            return
        }
        const handleEventsPath = path.join(app.getPath('appData'), 'PulseSync', 'addons', name, 'handleEvents.json')

        if (fs.existsSync(handleEventsPath)) {
            const handleEventsData = JSON.parse(fs.readFileSync(handleEventsPath, 'utf8'))

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, data: handleEventsData }))
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Handle events data not found' }))
        }
    } catch (error) {
        logger.http.error('Error reading handle events:', error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Error reading handle events' }))
    }
}

const handleGetAssetsRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const themePath = path.join(themesPath, selectedAddon)
        const assetsPath = path.join(themePath, 'Assets')

        if (fs.existsSync(assetsPath)) {
            const files = getFilesInDirectory(assetsPath)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
                JSON.stringify({
                    ok: true,
                    themePath: themePath,
                    assetsPath: assetsPath,
                    files: files,
                }),
            )
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Assets folder not found' }))
        }
    } catch (error) {
        logger.http.error('Error reading theme files:', error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Error reading theme files' }))
    }
}

const handleGetAssetFileRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const themePath = path.join(themesPath, selectedAddon)
        const assetsPath = path.join(themePath, 'Assets')
        const fileName = req.url!.substring('/assets/'.length)
        const filePath = getFilePathInAssets(fileName, assetsPath)

        if (filePath) {
            const ext = path.extname(filePath).substring(1)
            const mimeTypes: { [key: string]: string } = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                ico: 'image/x-icon',
            }

            res.writeHead(200, {
                'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            })
            fs.createReadStream(filePath).pipe(res)
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'File not found' }))
        }
    } catch (error) {
        logger.http.error('Error serving static file:', error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Error serving static file' }))
    }
}

const getFilesInDirectory = (dirPath: string): { [key: string]: string } => {
    let results: { [key: string]: string } = {}
    const list = fs.readdirSync(dirPath)

    list.forEach(file => {
        const filePath = path.join(dirPath, file)
        const stat = fs.statSync(filePath)

        if (stat && stat.isDirectory()) {
            results = { ...results, ...getFilesInDirectory(filePath) }
        } else {
            const fileName = path.basename(file)
            results[fileName] = filePath
        }
    })

    return results
}

const getFilePathInAssets = (filename: string, assetsPath: string): string | null => {
    const filePath = findFileInDirectory(filename, assetsPath)
    logger.http.log('File Path:', filePath)
    return filePath
}

const findFileInDirectory = (filename: string, dirPath: string): string | null => {
    const list = fs.readdirSync(dirPath)
    for (const file of list) {
        const filePath = path.join(dirPath, file)
        const stat = fs.statSync(filePath)

        if (stat.isDirectory()) {
            const result = findFileInDirectory(filename, filePath)
            if (result) return result
        } else if (path.basename(file) === filename) {
            return filePath
        }
    }
    return null
}

export const getTrackInfo = () => {
    return data
}

export const updateData = (newData: Track) => {
    data = newData
    eventEmitter.emit('DATA_UPDATED', newData)
}

export { eventEmitter }

export default server
