import * as semver from 'semver'

import type { ModInterface } from '@entities/mod/model/modInterface'
import type { Mod } from '@entities/settings/model/settings.interface'

export function isModReleaseUpdateAvailable(release: ModInterface | undefined, installed: Mod): boolean {
    if (!release) return false

    if (release.channel === 'branch') {
        if (installed.sourceType !== 'branch' || installed.branch !== release.branch) return true
        return Boolean(release.commit && release.commit !== installed.commit)
    }

    if (installed.sourceType === 'branch') return true

    const remoteVersion = semver.valid(String(release.modVersion || '').trim())
    const installedVersion = semver.valid(String(installed.version || '').trim())
    if (!remoteVersion || !installedVersion) return false

    return semver.gt(remoteVersion, installedVersion)
}

export function getModReleaseIdentity(release: ModInterface): string {
    return release.channel === 'branch' ? `${release.branch}:${release.commit}` : release.modVersion
}
