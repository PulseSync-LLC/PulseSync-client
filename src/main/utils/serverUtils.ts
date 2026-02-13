import { protocol } from 'electron'

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
