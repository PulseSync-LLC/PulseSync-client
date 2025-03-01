export default interface AddonInterface {
    matches?: boolean
    name: string
    directoryName: string
    image: string
    banner: string
    author: string | string[];
    description: string
    version: string
    path: string
    lastModified: string
    size: string
    tags: string[]
    type: 'theme' | 'script'
    enabled: boolean
}
