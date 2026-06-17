export type ClientHardwareIdentityAlgorithm = 'sha256'

export interface ClientHardwareIdentity {
    hash: string
    source: string
    algorithm: ClientHardwareIdentityAlgorithm
}
