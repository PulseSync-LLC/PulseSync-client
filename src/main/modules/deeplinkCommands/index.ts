import { BrowserWindow } from 'electron'
import type { BrowserAuthCredentials } from '../auth/browserAuth'
import auth from './auth'
import patch from './patch'

export interface DeeplinkCommandContext {
    rawUrl: string
    args: string[]
    window?: BrowserWindow
    handleBrowserAuth: (credentials: BrowserAuthCredentials, window?: BrowserWindow) => Promise<void>
    handleInstallModUpdateFrom: (asarPath: string, window?: BrowserWindow) => Promise<void>
}

type DeeplinkCommandRun = (context: DeeplinkCommandContext) => Promise<boolean>
type DeeplinkCommandEntry = { name: string; run: DeeplinkCommandRun }

const normalizeCommandName = (value: string): string => value.trim().replace(/-/g, '_').toLowerCase()

export default class deeplinkCommands {
    private readonly commands: DeeplinkCommandEntry[]
    private readonly handleBrowserAuth: (credentials: BrowserAuthCredentials, window?: BrowserWindow) => Promise<void>
    private readonly handleInstallModUpdateFrom: (asarPath: string, window?: BrowserWindow) => Promise<void>

    static loadCommands(): DeeplinkCommandEntry[] {
        return [
            { name: 'browser_auth', run: auth },
            { name: 'patch', run: patch },
        ]
    }

    constructor(deps: {
        handleBrowserAuth: (credentials: BrowserAuthCredentials, window?: BrowserWindow) => Promise<void>
        handleInstallModUpdateFrom: (asarPath: string, window?: BrowserWindow) => Promise<void>
    }) {
        this.handleBrowserAuth = deps.handleBrowserAuth
        this.handleInstallModUpdateFrom = deps.handleInstallModUpdateFrom
        this.commands = deeplinkCommands.loadCommands()
    }

    async runCommand(commandName: string, args: string[], rawUrl: string, window?: BrowserWindow): Promise<boolean> {
        const command = this.commands.find(cmd => cmd.name === normalizeCommandName(commandName))
        if (!command) return false

        return command.run({
            rawUrl,
            args,
            window,
            handleBrowserAuth: this.handleBrowserAuth,
            handleInstallModUpdateFrom: this.handleInstallModUpdateFrom,
        })
    }
}
