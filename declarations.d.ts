declare module '*.svg' {
    import { FC, SVGProps } from 'react'
    const content: FC<SVGProps<SVGElement>>
    export default content
}

declare module '*.wav' {
    const src: string
    export default src
}

declare module '*.gif' {
    const src: string
    export default src
}

declare module '*.md'

declare module 'js-yaml'
declare module 'zstd-codec'

declare namespace Electron {
    interface FileFilter {
        name: string
        extensions: string[]
    }
}
