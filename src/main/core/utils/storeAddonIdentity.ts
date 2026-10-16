import * as fs from 'original-fs'
import path from 'path'

import { branch } from '@common/appConfig'

import logger from '../../shared/logger'
import mainHttpClient from '../http/client'
import { getState } from '../state'
import { resolveAddonStableId } from './addonIdentity'

import type Addon from '@entities/addon/model/addon.interface'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'

const recoveryAttempts = new Map<string, number>()
let recoveryAuthToken = ''

export async function recoverStoreAddonIdentities(addons: Addon[]): Promise<void> {
    const authToken = getState().get('tokens.token')
    if (typeof authToken !== 'string' || !authToken) return
    if (authToken !== recoveryAuthToken) {
        recoveryAttempts.clear()
        recoveryAuthToken = authToken
    }

    await Promise.all(
        (['stable', 'dev'] as const).map(async channel => {
            const candidates = addons.filter(addon => {
                if (addon.installSource !== 'store' || addon.type === 'web-addon' || !addon.storeAddonId || addon.id !== addon.storeAddonId)
                    return false
                if ((addon.storeReleaseChannel ?? 'stable') !== channel) return false
                const key = JSON.stringify([addon.storeAddonId, addon.version, channel])
                return Date.now() - (recoveryAttempts.get(key) ?? 0) > 60_000
            })
            if (!candidates.length) return
            candidates.forEach(addon => recoveryAttempts.set(JSON.stringify([addon.storeAddonId, addon.version, channel]), Date.now()))

            try {
                const response = await mainHttpClient.post<{ ok?: boolean; addons?: StoreAddon[] }>('/extensions/updates', {
                    authToken,
                    headers: { 'x-pulsesync-channel': branch === 'dev' ? 'dev' : 'beta' },
                    body: {
                        ids: Array.from(new Set(candidates.map(addon => addon.storeAddonId))),
                        releaseChannel: channel,
                        resolveMetadataIds: true,
                    },
                    timeoutMs: 15_000,
                })
                if (!response.ok || response.data?.ok === false) throw new Error('STORE_IDENTITY_RECOVERY_FAILED')
                if (getState().get('tokens.token') !== authToken) return

                for (const addon of candidates) {
                    const publication = response.data?.addons?.find(item => item.id === addon.storeAddonId)
                    const release = [publication?.currentRelease, ...(publication?.releases || [])].find(
                        item => item?.version === addon.version && item.status === 'accepted' && item.metadataId,
                    )
                    if (!release?.metadataId) continue
                    const metadataId = resolveAddonStableId({ id: release.metadataId })
                    const metadataPath = path.join(addon.path, 'metadata.json')
                    const current = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8')) as Addon
                    if (current.id !== addon.id || current.storeAddonId !== addon.storeAddonId || current.version !== addon.version) continue
                    if (metadataId !== current.id) {
                        current.id = metadataId
                        await fs.promises.writeFile(metadataPath, JSON.stringify(current, null, 4), 'utf8')
                        addon.id = metadataId
                    }
                    recoveryAttempts.set(JSON.stringify([addon.storeAddonId, addon.version, channel]), Infinity)
                }
            } catch (error) {
                logger.main.warn('Addons: failed to recover original store addon IDs', error)
            }
        }),
    )
}
