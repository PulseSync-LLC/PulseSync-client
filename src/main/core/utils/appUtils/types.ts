export interface ProcessInfo {
    pid: number
    isLinuxHelper?: boolean
}

export interface AppxPackage {
    Name: string
    PackageFullName: string
    PackageFamilyName: string
    Version: string
    [key: string]: any
}

export type PatchCallback = (progress: number, message: string) => void
