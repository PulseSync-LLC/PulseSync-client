import { desktopApi } from '@shared/desktop/desktopApi'

import type { DesktopInstallModRequest } from '@common/desktopApi/contract'
import type { ModInterface } from '@entities/mod/model/modInterface'

export const getModInstallRequest = (release: ModInterface): DesktopInstallModRequest => ({
    version: release.modVersion,
    musicVersion: release.realMusicVersion,
    name: release.name,
    link: release.downloadUrl,
    unpackLink: release.downloadUnpackedUrl,
    unpackedChecksum: release.unpackedChecksum,
    checksum: release.checksum_v2,
    shouldReinstall: release.shouldReinstall,
    source: release.source || 'backend',
    channel: release.channel,
    branch: release.branch,
    commit: release.commit,
})

export const prepareModReleaseUpdate = (release: ModInterface): void => {
    desktopApi.mods.prepareUpdate(getModInstallRequest(release))
}

export const installModRelease = (release: ModInterface): void => {
    desktopApi.mods.install(getModInstallRequest(release))
}
