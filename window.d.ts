import { AxiosRequestConfig, AxiosResponse } from 'axios'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
import { DesktopEvents } from './src/main/mainWindowPreload'
import { Track } from './src/renderer/api/interfaces/track.interface'

declare global {
    interface Window {
        __listenersAdded?: boolean
        electron: {
            store: {
                get: (key: string) => any
                has: (key: string) => string
                set: (key: string, val: any) => void
                delete: (key: string) => void
            }
            window: {
                maximize: () => void
                minimize: () => void
                close: (val: boolean) => void
                exit: () => void
                isMac: () => boolean
            }
            settings: {
                maximize: () => void
                minimize: () => void
                close: (val: boolean) => void
                exit: () => void
                isMac: () => boolean
            }
            player: {
                setTrack: (track: Track, currentPercent: number) => void
                setPlaying: (value: boolean) => void
            }
            request: (url: string, config: AxiosRequestConfig) => AxiosResponse
            corsAnywherePort: () => number
            musicDevice: () => string
            authorize: () => string
            version: () => string
            receive: (channel: string, func: (event: any, ...arg: any[]) => void) => void
            receiveOnce: (channel: string, func: (event: any, ...arg: any[]) => void) => void
            removeListener: (channel: string) => void
            getVersion: (version: string) => string
            isAppDev: () => boolean
        }
        refreshAddons: () => void
        getModInfo: (args?: any) => void
        discordRpc: {
            discordRpc: (val: boolean) => void
            setActivity: (props: SetActivity) => void
            clearActivity: () => void
        }
        desktopEvents: DesktopEvents
    }
}
export {}
