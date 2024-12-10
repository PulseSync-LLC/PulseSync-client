import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app, ipcMain } from 'electron';
import { mainWindow } from '../../index';
import { authorized } from '../events';
import isAppDev from 'electron-is-dev';
import logger from './logger';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import trackInitials from '../../renderer/api/initials/track.initials';
import { isFirstInstance } from './singleInstance'
import config from '../../config.json'
import { store } from './storage'

const eventEmitter = new EventEmitter();
let data: any = {};
let selectedTheme: string = 'Default';
let server: http.Server | null = null;
let ws: WebSocketServer | null = null;

const startWebSocketServer = () => {
    if(!isFirstInstance) return;
    if (ws) {
        ws.clients.forEach(client => client.close());
        ws.close();
        logger.main.log('Existing WebSocket server closed.');
    }

    if (server) {
        server.close(() => {
            logger.main.log('HTTP server closed for WebSocket restart.');
            initializeServer();
        });
    } else {
        initializeServer();
    }
};
const stopWebSocketServer = () => {
    try {
        if (ws) {
            ws.clients.forEach(client => client.close());
            ws.close();
            logger.main.log('WebSocket server stopped.');
            ws = null;
        }

        if (server) {
            server.close(() => {
                logger.main.log('HTTP server closed.');
                server = null;
            });
        }
    } catch (error) {
        logger.main.error('Error while stopping WebSocket server:', error);
    }
};
const initializeServer = () => {
    server = http.createServer();
    ws = new WebSocketServer({ server });

    ws.on('connection', socket => {
        if(!authorized) return socket.close();
        logger.main.log('New client connected');

        socket.send(JSON.stringify({ type: 'welcome', message: 'Connected to server' }));
        sendTheme()
        socket.on('message', (message: any) => {
            const data = JSON.parse(message);
            logger.main.log(data);
            if (data.type === 'update_data') {
                logger.main.log(data.data);
                updateData(data.data);
            }
        });

        socket.on('close', () => {
            logger.main.log('Client disconnected');
            data.status = 'null';
            mainWindow.webContents.send('trackinfo', {
                data: {
                    status: 'pause',
                    track: trackInitials
                }
            })
        });
    });

    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
        if (req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': 'music-application://desktop',
                'Access-Control-Allow-Methods': 'POST',
                'Access-Control-Allow-Headers': 'Content-Type',
            });
            res.end();
            return;
        }

        if (req.method === 'GET' && req.url === '/get_handle') {
            handleGetHandleRequest(req, res);
            return;
        }

        if (req.method === 'GET' && req.url === '/assets') {
            handleGetAssetsRequest(req, res);
            return;
        }

        if (req.method === 'GET' && req.url?.startsWith('/assets/')) {
            handleGetAssetFileRequest(req, res);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(config.PORT, () => {
        logger.main.log(`WebSocket server started on port ${config.PORT}`);
    });
};

ipcMain.on('websocket-start', async (event, _) => {
    logger.main.log('Received websocket-start event. Starting WebSocket server...');
    startWebSocketServer();
});

ipcMain.on('websocket-stop', async (event, _) => {
    logger.main.log('Received websocket-stop event. Stopping WebSocket server...');
    stopWebSocketServer();
});
ipcMain.on('websocket-restart', async (event, _) => {
    logger.main.log('Received websocket-restart event. Restarting WebSocket server...');
    stopWebSocketServer()
    setTimeout(() => {
        startWebSocketServer();
    }, 1500)
});
const handleGetHandleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const handleEventsPath = path.join(
            app.getPath('appData'),
            'PulseSync',
            'themes',
            selectedTheme,
            'handleEvents.json',
        );

        if (fs.existsSync(handleEventsPath)) {
            const handleEventsData = JSON.parse(
                fs.readFileSync(handleEventsPath, 'utf8'),
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, data: handleEventsData }));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Handle events data not found' }));
        }
    } catch (error) {
        logger.main.error('Error reading handle events:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error reading handle events' }));
    }
};

const handleGetAssetsRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const themesPath = path.join(
            app.getPath('appData'),
            'PulseSync',
            'themes',
        );
        const themePath = path.join(themesPath, selectedTheme);
        const assetsPath = path.join(themePath, 'Assets');

        if (fs.existsSync(assetsPath)) {
            const files = getFilesInDirectory(assetsPath);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    ok: true,
                    themePath: themePath,
                    assetsPath: assetsPath,
                    files: files,
                }),
            );
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Assets folder not found' }));
        }
    } catch (error) {
        logger.http.error('Error reading theme files:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error reading theme files' }));
    }
};

const handleGetAssetFileRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const themesPath = path.join(
            app.getPath('appData'),
            'PulseSync',
            'themes',
        );
        const themePath = path.join(themesPath, selectedTheme);
        const assetsPath = path.join(themePath, 'Assets');
        const fileName = req.url!.substring('/assets/'.length);
        const filePath = getFilePathInAssets(fileName, assetsPath);

        if (filePath) {
            const ext = path.extname(filePath).substring(1);
            const mimeTypes: { [key: string]: string } = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                ico: 'image/x-icon',
            };

            res.writeHead(200, {
                'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
        }
    } catch (error) {
        logger.http.error('Error serving static file:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error serving static file' }));
    }
};

const getFilesInDirectory = (dirPath: string): { [key: string]: string } => {
    let results: { [key: string]: string } = {};
    const list = fs.readdirSync(dirPath);

    list.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
            results = { ...results, ...getFilesInDirectory(filePath) };
        } else {
            const fileName = path.basename(file);
            results[fileName] = filePath;
        }
    });

    return results;
};

const getFilePathInAssets = (
    filename: string,
    assetsPath: string,
): string | null => {
    const filePath = findFileInDirectory(filename, assetsPath);
    logger.main.log('File Path:', filePath);
    return filePath;
};

const findFileInDirectory = (
    filename: string,
    dirPath: string,
): string | null => {
    const list = fs.readdirSync(dirPath);
    for (const file of list) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            const result = findFileInDirectory(filename, filePath);
            if (result) return result;
        } else if (path.basename(file) === filename) {
            return filePath;
        }
    }
    return null;
};

export const getTrackInfo = () => {
    return data;
};

export const updateData = (newData: any) => {
    data = newData;
    eventEmitter.emit('dataUpdated', newData);
};

export { eventEmitter };

export const setTheme = (theme: string) => {
    if(!authorized) return;
    selectedTheme = theme;
    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'themes');
    const themePath = path.join(themesPath, selectedTheme);
    const metadataPath = path.join(themePath, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
        return;
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    let scriptJS = null;
    let cssContent = '';
    let jsContent = '';
    const styleCSS = path.join(themePath, metadata.css);
    if (metadata.script) {
        scriptJS = path.join(themePath, metadata.script);
        if (fs.existsSync(scriptJS)) {
            jsContent = fs.readFileSync(scriptJS, 'utf8');
        }
    }

    if (fs.existsSync(styleCSS)) {
        cssContent = fs.readFileSync(styleCSS, 'utf8');
    }

    const waitForSocket = new Promise<void>((resolve) => {
        const interval = setInterval(() => {
            if (ws && ws.clients && ws.clients.size > 0) {
                clearInterval(interval);
                resolve();
            }
        }, 100);
    });

    waitForSocket.then(() => {
        ws.clients.forEach(x =>
            x.send(
                JSON.stringify({
                    ok: true,
                    css: cssContent || '{}',
                    script: jsContent || '',
                    type: 'theme',
                }),
            ),
        );
    });
};

export const sendTheme = () => {
    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'themes');
    const themePath = path.join(themesPath, store.get('theme') || "Default");
    const metadataPath = path.join(themePath, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
        return;
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    let scriptJS = null;
    let cssContent = '';
    let jsContent = '';
    const styleCSS = path.join(themePath, metadata.css);
    if (metadata.script) {
        scriptJS = path.join(themePath, metadata.script);
        if (fs.existsSync(scriptJS)) {
            jsContent = fs.readFileSync(scriptJS, 'utf8');
        }
    }

    if (fs.existsSync(styleCSS)) {
        cssContent = fs.readFileSync(styleCSS, 'utf8');
    }

    ws.clients.forEach(x =>
        x.send(
            JSON.stringify({
                ok: true,
                css: cssContent || '{}',
                script: jsContent || '',
                type: 'theme',
            }),
        ),
    );
}

ipcMain.on('getTrackInfo', async (event, _) => {
    logger.main.log('Returning current track data');
    if (!ws) return;
    ws.clients.forEach(x =>
        x.send(
            JSON.stringify({
                ok: true,
                type: 'getTrackInfo',
            }),
        ),
    );
})

export default server;
