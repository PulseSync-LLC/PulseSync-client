import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { mainWindow } from '../../index'
import { authorized } from '../events'
import isAppDev from 'electron-is-dev'
import logger from './logger'
import { WebSocketServer } from 'ws'
let data: any = {}
let selectedTheme: string = 'Default'
import { EventEmitter } from 'events'
const eventEmitter = new EventEmitter()

const server = http.createServer()
const ws = new WebSocketServer({ server })
ws.on('connection', socket => {
    socket.on('message', (message: any) => {
        console.log(`Received message => ${message}`)
        let data = JSON.parse(message)
        if (data.type === 'update_data') {
            updateData(data.data)
        }
    })
    socket.send(JSON.stringify({ message: 'Hello from server!' }))
})

const getFilePathInAssets = (
    filename: string,
    assetsPath: string,
): string | null => {
    const filePath = findFileInDirectory(filename, assetsPath)
    console.log('File Path:', filePath)
    return filePath
}

const findFileInDirectory = (
    filename: string,
    dirPath: string,
): string | null => {
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

    if (req.method === 'GET' && req.url === '/get_theme') {
        try {
            if (authorized || isAppDev) {
                const themesPath = path.join(
                    app.getPath('appData'),
                    'PulseSync',
                    'themes',
                )
                const themePath = path.join(themesPath, selectedTheme)
                const metadataPath = path.join(themePath, 'metadata.json')

                if (fs.existsSync(metadataPath)) {
                    const metadata = JSON.parse(
                        fs.readFileSync(metadataPath, 'utf8'),
                    )
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

                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    res.end(
                        JSON.stringify({
                            ok: true,
                            css: cssContent ? cssContent : '{}',
                            script: jsContent ? jsContent : '',
                        }),
                    )
                    return
                }

                res.writeHead(404, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Metadata not found' }))
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(
                    JSON.stringify({
                        ok: true,
                        css: '{}',
                        script: '',
                    }),
                )
                return
            }
        } catch (error) {
            logger.http.error('Error reading theme files:', error)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Error reading theme files' }))
        }
        return
    }

    if (req.method === 'GET' && req.url === '/get_handle') {
        try {
            const handleEventsPath = path.join(
                app.getPath('appData'),
                'PulseSync',
                'themes',
                selectedTheme,
                'handleEvents.json',
            )

            if (fs.existsSync(handleEventsPath)) {
                const handleEventsData = JSON.parse(
                    fs.readFileSync(handleEventsPath, 'utf8'),
                )

                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, data: handleEventsData }))
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' })
                res.end(
                    JSON.stringify({ error: 'Handle events data not found' }),
                )
            }
        } catch (error) {
            console.error('Error reading handle events:', error)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Error reading handle events' }))
        }
        return
    }

    if (req.method === 'GET' && req.url === '/assets') {
        try {
            const themesPath = path.join(
                app.getPath('appData'),
                'PulseSync',
                'themes',
            )
            const themePath = path.join(themesPath, selectedTheme)
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
        return
    }

    if (req.method === 'GET' && req.url?.startsWith('/assets/')) {
        try {
            const themesPath = path.join(
                app.getPath('appData'),
                'PulseSync',
                'themes',
            )
            const themePath = path.join(themesPath, selectedTheme)
            const assetsPath = path.join(themePath, 'Assets')
            const fileName = req.url.substring('/assets/'.length)
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
                    'Content-Type':
                        mimeTypes[ext] || 'application/octet-stream',
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
        return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
})

export const getTrackInfo = () => {
    return data
}

export const updateData = (newData: any) => {
    data = newData
    eventEmitter.emit('dataUpdated', newData)
}

export { eventEmitter }

export const setTheme = (theme: string) => {
    selectedTheme = theme
    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'themes')
    const themePath = path.join(themesPath, selectedTheme)
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

    ws.clients.forEach(x =>
        x.send(
            JSON.stringify({
                ok: true,
                css: cssContent || '{}',
                script: jsContent || '',
            }),
        ),
    )
}

export default server
