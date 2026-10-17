export type AddonProjectDocument = 'manifest' | 'readme' | 'changelog'

export interface AddonProject {
    id: string
    rootPath: string
}

export interface AddonProjectOpenRequest {
    directoryName: string
    linkedOnly?: boolean
}
