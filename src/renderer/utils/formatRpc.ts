import { Track, Album } from '../api/interfaces/track.interface'
import SettingsInterface from '../api/interfaces/settings.interface'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
import { getCoverImage } from './utils'
import UserInterface from '../api/interfaces/user.interface'
import { t as i18nT } from '../i18n'

export function truncateLabel(label: string, maxLength = 30) {
    return label.length > maxLength ? label.slice(0, maxLength) : label
}

export const replaceParams = (str: any, track: Track, showVersion: boolean = false) => {
    return str
        .replace('{track}', showVersion && track.version ? `${track.title} (${track.version})` : track.title || '')
        .replace('{artist}', track.artists.map(a => a.name).join(', ') || i18nT('rpc.unknownArtist'))
        .replace('{album}', track.albums.map(a => a.title).join(', ') || i18nT('rpc.unknownAlbum'))
}

export function fixStrings(string: string): string {
    if (!string) return string
    if (string.length <= 1) {
        string += 'ㅤ'
    }
    if (string.length > 128) {
        string = string.substring(0, 127)
        string += '…'
    }
    return string
}

function stripAfterDash(str: string): string {
    if (!str) return str
    const idx = str.indexOf('-')
    return idx !== -1 ? str.slice(0, idx).trim() : str
}

class ConvertableLink {
    link?: string
    constructor(link?: string) {
        this.link = link
    }
    toString() {
        return this.link ?? ''
    }
    toWeb() {
        if (!this.link) return undefined
        return `https://music.yandex.ru/${this.link}?utm_source=discord&utm_medium=rich_presence_click`
    }
    toApp() {
        if (!this.link) return undefined
        return `yandexmusic://${this.link}`
    }
}

export function buildShareLinks(t: Track) {
    const albumId = t.albums?.[0]?.id
    const trackId = t.id
    const realTrackId = t.realId
    const artistId = t.artists?.[0]?.id

    const shareTrackPathYnison = new ConvertableLink(albumId && trackId ? `album/${albumId}/track/${trackId}` : undefined)
    const shareTrackPathRegular = new ConvertableLink(albumId && realTrackId ? `album/${albumId}/track/${realTrackId}` : undefined)
    const shareAlbumPath = new ConvertableLink(albumId ? `album/${albumId}` : undefined)
    const shareArtistPath = new ConvertableLink(artistId ? `artist/${artistId}` : undefined)

    return { shareTrackPathYnison, shareTrackPathRegular, shareAlbumPath, shareArtistPath }
}

export const STATUS_DISPLAY_TYPES: Record<number, number> = {
    0: 0,
    1: 1,
    2: 2,
}

export function buildActivityButtons(t: Track, settings: SettingsInterface, user?: UserInterface) {
    const buttons: { label: string; url: string }[] = []
    const { shareTrackPathYnison, shareTrackPathRegular } = buildShareLinks(t)
    const shareTrackPath = t.sourceType === 'ynison' ? shareTrackPathYnison : shareTrackPathRegular

    if (settings.discordRpc.enableRpcButtonListen) {
        if (t.trackSource === 'UGC' && typeof t.id === 'string' && !t.id.includes('generative') && t.url) {
            buttons.push({
                label: settings.discordRpc.button ? truncateLabel(settings.discordRpc.button) : '✌️ Open music file',
                url: t.url,
            })
        } else if (typeof t.id === 'string' && !t.id.includes('generative')) {
            const appUrl = shareTrackPath.toApp()
            const webUrl = shareTrackPath.toWeb()

            if (settings.discordRpc.enableDeepLink) {
                if (settings.discordRpc.enableWebsiteButton) {
                    const custom =
                        settings.discordRpc.button && settings.discordRpc.button.trim().length > 0
                            ? truncateLabel(settings.discordRpc.button)
                            : undefined

                    if (appUrl) {
                        buttons.push({ label: custom ?? '✌️ Open in Yandex Music App', url: appUrl })
                    } else if (webUrl) {
                        buttons.push({ label: custom ?? '✌️ Open in Yandex Music Web', url: webUrl })
                    }
                } else {
                    if (appUrl) buttons.push({ label: '✌️ Open in Yandex Music App', url: appUrl })
                    if (webUrl && buttons.length < 2) buttons.push({ label: '✌️ Open in Yandex Music Web', url: webUrl })
                }
            } else {
                if (appUrl) {
                    const custom =
                        settings.discordRpc.button && settings.discordRpc.button.trim().length > 0
                            ? truncateLabel(settings.discordRpc.button)
                            : '✌️ Open in Yandex Music App'
                    buttons.push({ label: custom, url: appUrl })
                }
            }
        }
    }

    if (settings.discordRpc.enableWebsiteButton && buttons.length < 2) {
        buttons.push({
            label: '♡ PulseSync Project',
            url: 'https://pulsesync.dev',
        })
    }

    return buttons.length > 2 ? buttons.slice(0, 2) : buttons.length ? buttons : undefined
}

export function buildDiscordActivity(t: Track, settings: SettingsInterface, user?: UserInterface): SetActivity | null {
    if (!t.title) return null
    if (t.status === 'paused' && !settings.discordRpc.displayPause) return null

    const { shareAlbumPath, shareArtistPath, shareTrackPathRegular } = buildShareLinks(t)
    const album: Album | undefined = Array.isArray(t.albums) && t.albums.length > 0 ? t.albums[0] : undefined
    const isGenerative = typeof t.id === 'string' && t.id.includes('generative')
    const withSmall = settings.discordRpc.showSmallIcon
    const hasSupporter = Boolean(user?.hasSupporterBadge || user?.badges?.some((badge: any) => badge.type === 'supporter'))
    const hideBranding = Boolean(settings.discordRpc.supporterHideBranding && hasSupporter)

    const base: SetActivity = {
        type: 2,
        statusDisplayType: STATUS_DISPLAY_TYPES[settings.discordRpc.statusDisplayType] ?? 0,
        largeImageKey: getCoverImage(t),
        largeImageText: hideBranding ? '' : stripAfterDash(`PulseSync ${settings.info.version}`),
        largeImageUrl: hideBranding ? undefined : 'https://pulsesync.dev',
    }

    if (album?.title && album.title !== t.title) {
        base.largeImageText = fixStrings(album.title)
        const web = shareAlbumPath.toWeb()
        if (web) base.largeImageUrl = web
    }

    if (withSmall) {
        base.smallImageText = settings.discordRpc.showVersionOrDevice ? settings.info.version : ' on ' + (t.currentDevice?.info?.type ?? 'DESKTOP')
        base.smallImageKey = 'https://cdn.discordapp.com/app-assets/1124055337234858005/1250833449380614155.png'
    }

    if (t.sourceType === 'ynison') {
        const start = Date.now() - (typeof t.ynisonProgress === 'number' ? t.ynisonProgress : 0)
        const activity: SetActivity = { ...base, details: fixStrings(t.title) }

        if (t.status === 'paused' && settings.discordRpc.displayPause) {
            activity.smallImageText = i18nT('rpc.paused')
            activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/984031241357647892/1340838860963450930.png?size=256'
        } else if (!isGenerative) {
            activity.startTimestamp = Math.floor(start)
            activity.endTimestamp = Math.floor(start + (t.durationMs ?? 0))
        }

        const buttons = buildActivityButtons(t, settings, user)
        if (buttons) activity.buttons = buttons
        return activity
    } else {
        const start = Date.now() - (t.progress?.position ? t.progress.position * 1000 : 0)
        const artistName = (t.artists || []).map(x => x.name).join(', ')
        let rawDetails = ''

        if (settings.discordRpc.showTrackVersion && t.version) {
            rawDetails = `${t.title} (${t.version})`
        } else if (settings.discordRpc.details && settings.discordRpc.details.length > 0) {
            rawDetails = replaceParams(settings.discordRpc.details, t, settings.discordRpc.showTrackVersion)
        } else {
            rawDetails = t.title || i18nT('rpc.unknownTrack')
        }

        const stateText =
            settings.discordRpc.state && settings.discordRpc.state.length > 0
                ? fixStrings(replaceParams(settings.discordRpc.state, t))
                : fixStrings(artistName || i18nT('rpc.unknownArtist'))

        const activity: SetActivity = {
            ...base,
            details: fixStrings(rawDetails),
            detailsUrl: shareTrackPathRegular.toWeb(),
            state: stateText,
            stateUrl: shareArtistPath.toWeb(),
        }

        if (t.status === 'paused' && settings.discordRpc.displayPause) {
            activity.smallImageText = i18nT('rpc.paused')
            activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/984031241357647892/1340838860963450930.png?size=256'
            activity.details = fixStrings(t.title)
            delete activity.startTimestamp
            delete activity.endTimestamp
        } else if (!isGenerative) {
            activity.startTimestamp = Math.floor(start)
            activity.endTimestamp = Math.floor(start + (t.durationMs ?? 0))
        }

        if ((!t.artists || t.artists.length === 0) && t.trackSource !== 'UGC') {
            const neuroSuffix = ` - ${i18nT('rpc.neuroMusic')}`
            const newDetails = t.title.endsWith(neuroSuffix) ? t.title : `${t.title}${neuroSuffix}`
            activity.details = fixStrings(newDetails)
            if (t.albumArt && t.albumArt.includes('%%')) {
                activity.largeImageKey = `https://${t.albumArt.replace('%%', 'orig')}`
            }
            delete activity.state
        }

        const buttons = buildActivityButtons(t, settings, user)
        if (buttons) activity.buttons = buttons
        return activity
    }
}
