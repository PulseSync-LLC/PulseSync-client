export type ClientBuildSignatureAlgorithm = 'ed25519'

export interface ClientBuildIdentity {
    origin: string
    version: string
    commit: string
    builtAt: string
    signatureAlgorithm: ClientBuildSignatureAlgorithm
    signature: string
}
