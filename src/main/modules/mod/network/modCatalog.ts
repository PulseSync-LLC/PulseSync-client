import { app } from 'electron'
import * as fs from 'original-fs'
import crypto from 'crypto'
import config from '@common/appConfig'
import { getState } from '../../state'

const State = getState()
const GET_MODS_QUERY = `
    query GetMod {
        getMod {
            modVersion
            musicVersion
            realMusicVersion
            name
            checksum
            checksum_v2
        }
    }
`
const USER_AGENT = () =>
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/142.0.7444.59 Electron/39.1.1 Safari/537.36`

export type RemoteModInfo = {
    modVersion: string
    musicVersion: string
    realMusicVersion: string
    name: string
    checksum?: string | null
    checksum_v2?: string | null
}

export type ResolvedInstallModMatch = {
    incomingAsar: Buffer
    incomingChecksum: string
    matchedMod: RemoteModInfo | null
}

const resolveTokenHeader = (): Record<string, string> => {
    const token = State.get('tokens.token')
    return typeof token === 'string' && token ? { Authorization: `Bearer ${token}` } : {}
}

const fetchRemoteMods = async (): Promise<RemoteModInfo[]> => {
    const response = await fetch(`${config.SERVER_URL}/graphql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT(),
            ...resolveTokenHeader(),
        },
        body: JSON.stringify({
            query: GET_MODS_QUERY,
        }),
    })

    if (!response.ok) {
        throw new Error(`Failed to load mod versions: HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
        data?: { getMod?: RemoteModInfo[] }
        errors?: Array<{ message?: string }>
    }
    if (payload.errors?.length) {
        throw new Error(
            payload.errors
                .map(error => error.message)
                .filter(Boolean)
                .join('; ') || 'Failed to load mod versions',
        )
    }

    return Array.isArray(payload.data?.getMod) ? payload.data.getMod : []
}

const findRemoteModByChecksum = async (checksum: string): Promise<RemoteModInfo | null> => {
    const mods = await fetchRemoteMods()
    return (
        mods.find(mod => {
            const checksumV2 = typeof mod.checksum_v2 === 'string' ? mod.checksum_v2.trim().toLowerCase() : ''
            const checksumV1 = typeof mod.checksum === 'string' ? mod.checksum.trim().toLowerCase() : ''
            return checksumV2 === checksum || checksumV1 === checksum
        }) ?? null
    )
}

export const resolveInstallModMatch = async (asarPath: string): Promise<ResolvedInstallModMatch> => {
    const incomingAsar = await fs.promises.readFile(asarPath)
    const incomingChecksum = crypto.createHash('sha256').update(incomingAsar).digest('hex')
    const matchedMod = await findRemoteModByChecksum(incomingChecksum)
    return { incomingAsar, incomingChecksum, matchedMod }
}
