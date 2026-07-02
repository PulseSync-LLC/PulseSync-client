export type DesktopDist = `${NodeJS.Platform}-${NodeJS.Architecture}`

export function getCurrentDist(): DesktopDist {
    return `${process.platform}-${process.arch}` as DesktopDist
}
