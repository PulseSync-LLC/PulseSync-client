import { useState } from 'react'

import { desktopApi } from '@shared/desktop/desktopApi'

import type { DesktopStoreReleaseChannel } from '@common/desktopApi/contract'

function getSavedChannel(): DesktopStoreReleaseChannel {
    try {
        return desktopApi.settings.getStoreReleaseChannel() ?? 'stable'
    } catch {
        return 'stable'
    }
}

export default function useStoreReleaseChannel() {
    const [channel, setChannel] = useState<DesktopStoreReleaseChannel>(getSavedChannel)

    const changeChannel = async (nextChannel: DesktopStoreReleaseChannel) => {
        try {
            await desktopApi.settings.setStoreReleaseChannel(nextChannel)
            setChannel(nextChannel)
        } catch {
            setChannel(getSavedChannel())
        }
    }

    return [channel, changeChannel] as const
}
