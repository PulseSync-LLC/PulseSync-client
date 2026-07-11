/// <reference types="vite/client" />
/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string

declare const SETTINGS_WINDOW_VITE_DEV_SERVER_URL: string
declare const SETTINGS_WINDOW_VITE_NAME: string

declare const PRELOADER_VITE_DEV_SERVER_URL: string
declare const PRELOADER_VITE_NAME: string

declare const PULSESYNC_VERSION: string
declare const PULSESYNC_HOST_VERSION: string
declare const PULSESYNC_CORE_VERSION: string
declare const PULSESYNC_BRANCH: string
declare const PULSESYNC_DIST: string
declare const PULSESYNC_RENDERER_BUILD_NUMBER: string

interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
