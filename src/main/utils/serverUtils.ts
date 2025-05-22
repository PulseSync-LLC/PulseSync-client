import corsAnywhereServer from 'cors-anywhere'
import getPort from 'get-port'
import { protocol } from 'electron'

export async function initializeCorsAnywhere(): Promise<number> {
    const port = await getPort()
    corsAnywhereServer.createServer().listen(port, 'localhost')
    return port
}

export function registerSchemes(): void {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: 'http',
            privileges: {
                standard: true,
                bypassCSP: true,
                allowServiceWorkers: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
        {
            scheme: 'ws',
            privileges: {
                standard: true,
                bypassCSP: true,
                allowServiceWorkers: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
        {
            scheme: 'wss',
            privileges: {
                standard: true,
                bypassCSP: true,
                allowServiceWorkers: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
        {
            scheme: 'sentry-ipc',
            privileges: {
                standard: true,
                bypassCSP: true,
                allowServiceWorkers: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
        {
            scheme: 'file',
            privileges: {
                standard: true,
                bypassCSP: true,
                allowServiceWorkers: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
        {
            scheme: 'https',
            privileges: {
                standard: true,
                bypassCSP: true,
                allowServiceWorkers: true,
                supportFetchAPI: true,
                corsEnabled: true,
                stream: true,
            },
        },
        { scheme: 'mailto', privileges: { standard: true } },
    ])
}
