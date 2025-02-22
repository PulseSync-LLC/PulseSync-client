export default interface AddonInterface {
    matches?: boolean
    name: string
    image: string
    banner: string
    author: string
    description: string
    version: string
    path: string
    lastModified: number
    size: number
    tags: string[]
    type: 'theme' | 'script'
    enabled: boolean
}
