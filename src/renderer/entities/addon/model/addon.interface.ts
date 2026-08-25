import type { HandleConfig } from '@common/addons/handleEvents'

export default interface Addon {
    id: string
    name: string
    directoryName: string
    installSource?: 'store' | 'local'
    storeAddonId?: string
    packageHash?: string
    description: string
    version: string
    author: string | string[]

    image: string
    banner: string
    preview?: string
    libraryLogo: string

    path: string
    lastModified: string
    lastModifiedAt?: number
    size: string

    type: 'theme' | 'script' | 'web-addon'
    runtime?: 'legacy' | 'isolated'
    tags: string[]

    enabled: boolean
    css?: string
    script?: string

    matches?: boolean
    dependencies?: string[]
    conflictsWith?: string[]
    allowedUrls?: string[]

    supportedVersions?: string[]
    rootFiles?: string[]
    settings?: HandleConfig
}
