export default interface Addon {
    name: string
    directoryName: string
    description: string
    version: string
    author: string | string[]

    image: string
    banner: string
    libraryLogo: string

    path: string
    lastModified: string
    size: string

    type: 'theme' | 'script'
    tags: string[]

    enabled: boolean
    css?: string
    script?: string

    matches?: boolean
    dependencies?: string[]
    allowedUrls?: string[]
}
