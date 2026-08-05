import config from '@common/appConfig'
import type Addon from '@entities/addon/model/addon.interface'
import { desktopApi } from '@shared/desktop/desktopApi'

const DEFAULT_NEWS_SLUG = 'legacy-addons-webhost-migration'

export function isRestrictedLegacyAddon(addon: Addon | null | undefined, restrictionsEnabled: boolean): boolean {
    return restrictionsEnabled && Boolean(addon && addon.type !== 'web-addon')
}

export function isAddonAuthor(
    addon: Addon | null | undefined,
    user: { nickname?: string | null; username?: string | null } | null | undefined,
): boolean {
    if (!addon || !user) {
        return false
    }

    const currentUserNames = [user.username, user.nickname]
        .map(value =>
            String(value || '')
                .trim()
                .toLowerCase(),
        )
        .filter(Boolean)
    if (!currentUserNames.length) {
        return false
    }

    const authorNames = (Array.isArray(addon.author) ? addon.author : addon.author.split(','))
        .map(value =>
            String(value || '')
                .trim()
                .toLowerCase(),
        )
        .filter(Boolean)

    return authorNames.some(authorName => currentUserNames.includes(authorName))
}

export function getLegacyAddonMigrationNewsSlug(meta?: Record<string, unknown>): string {
    const configuredSlug = typeof meta?.newsSlug === 'string' ? meta.newsSlug.trim() : ''
    return configuredSlug || DEFAULT_NEWS_SLUG
}

export function getLegacyAddonMigrationNewsUrl(meta?: Record<string, unknown>): string {
    return `${config.WEBSITE_URL}/news/${encodeURIComponent(getLegacyAddonMigrationNewsSlug(meta))}`
}

export function openLegacyAddonMigrationNews(meta?: Record<string, unknown>) {
    return desktopApi.system.openExternal(getLegacyAddonMigrationNewsUrl(meta))
}
