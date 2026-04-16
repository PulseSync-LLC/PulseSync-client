export type InstalledSubcomponentId = 'ffmpeg' | 'ytdlp'

export type SubcomponentMeta = {
    version: string
    path: string
}

export type SubcomponentsMeta = Record<InstalledSubcomponentId, SubcomponentMeta | null>
