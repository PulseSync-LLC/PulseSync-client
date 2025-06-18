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
            player: {
                setTrack: (track: Track, currentPercent: number) => void
                setPlaying: (value: boolean) => void
            }
            request: (url: string, config: AxiosRequestConfig) => AxiosResponse
            corsAnywherePort: () => number
            authorize: () => string
            version: () => string
            receive: (channel: string, func: (event: any, ...arg: any[]) => void) => void
            receiveOnce: (channel: string, func: (event: any, ...arg: any[]) => void) => void
            removeListener: (channel: string) => void
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
        appInfo: {
            getBranch: () => string
            getVersion: () => string
        }
    }
}
export {}
