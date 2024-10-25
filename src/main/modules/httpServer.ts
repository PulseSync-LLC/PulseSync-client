import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { mainWindow } from '../../index'
import {authorized} from "../events";
import isAppDev from "electron-is-dev";
import logger from "./logger";

let jsonDataGET: any = {}
let selectedTheme: string = 'Default'

const server = http.createServer()

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

    if (req.method === 'POST' && req.url === '/track_info') {
        let data: any = ''
        req.on('data', chunk => {
            data += chunk
        })
        req.on('end', () => {
            try {
                mainWindow.webContents.send('track_info', JSON.parse(data))
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(
                    JSON.stringify({ message: 'Data received successfully' }),
                )
            } catch (error) {
                logger.http.error('Error parsing JSON:', error)
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Invalid JSON' }))
            }
        })
        return
    }

    if (req.method === 'POST' && req.url === '/update_data') {
        let data = ''
        req.on('data', chunk => {
            data += chunk
        })
        req.on('end', () => {
            try {
                jsonDataGET = JSON.parse(data)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(
                    JSON.stringify({ message: 'Data received successfully' }),
                )
            } catch (error) {
                logger.http.error('Error parsing JSON:', error)
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Invalid JSON' }))
            }
        })
        return
    }

    if (req.method === 'GET' && req.url === '/get_theme') {
        try {
            if(authorized || isAppDev) {
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

                    res.writeHead(200, {'Content-Type': 'application/json'})
                    res.end(
                        JSON.stringify({
                            ok: true,
                            css: cssContent ? cssContent : "{}",
                            script: jsContent ? jsContent : '',
                        }),
                    )
                    return
                }

                res.writeHead(404, {'Content-Type': 'application/json'})
                res.end(JSON.stringify({error: 'Metadata not found'}))
            } else {
                res.writeHead(200, {'Content-Type': 'application/json'})
                res.end(
                    JSON.stringify({
                        ok: true,
                        css: "{}",
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
    return jsonDataGET
}

export const setTheme = (theme: string) => {
    selectedTheme = theme
}

export default server
