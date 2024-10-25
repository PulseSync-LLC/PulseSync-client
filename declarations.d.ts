declare module '*.svg' {
    import { FC, SVGProps } from 'react'
    const content: FC<SVGProps<SVGElement>>
    export default content
}

declare module '*.wav' {
    const src: string;
    export default src;
}

declare module '*.md'
