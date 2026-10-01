import { isDeveloperAccount } from '../auth/developerAccess'
import mainHttpClient from '../http/client'
import { getState } from '../state'

export class AddonUpdatePolicyError extends Error {}

export async function assertLegacyAddonUpdateAllowed(authToken: string, overrideGroup?: string): Promise<void> {
    const assertIdentity = () => {
        if (getState().get('tokens.token') !== authToken) throw new AddonUpdatePolicyError('AUTH_REQUIRED')
    }
    assertIdentity()

    let group: unknown
    if (typeof overrideGroup === 'string' && overrideGroup.trim() && (await isDeveloperAccount())) {
        group = overrideGroup.trim()
    } else {
        try {
            const response = await mainHttpClient.get<Record<string, { group?: unknown }>>('/experiments', {
                authToken,
                timeoutMs: 15000,
            })
            if (!response.ok || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
                throw new AddonUpdatePolicyError('LEGACY_ADDON_UPDATE_POLICY_UNAVAILABLE')
            }
            const experiment = response.data.ClientLegacyAddonRestrictions
            if (experiment !== undefined && (typeof experiment?.group !== 'string' || !experiment.group.trim())) {
                throw new AddonUpdatePolicyError('LEGACY_ADDON_UPDATE_POLICY_UNAVAILABLE')
            }
            group = typeof experiment?.group === 'string' ? experiment.group.trim() : undefined
        } catch (error) {
            if (error instanceof AddonUpdatePolicyError) throw error
            throw new AddonUpdatePolicyError('LEGACY_ADDON_UPDATE_POLICY_UNAVAILABLE')
        }
    }

    assertIdentity()
    if (typeof group === 'string' && (group === 'on' || group.startsWith('on_'))) {
        throw new AddonUpdatePolicyError('LEGACY_ADDON_UPDATE_DISABLED')
    }
}
