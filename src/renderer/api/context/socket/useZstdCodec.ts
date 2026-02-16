import { useEffect, useRef, useState } from 'react'

export function useZstdCodec() {
    const [zstdReady, setZstdReady] = useState(false)
    const zstdRef = useRef<any>(null)

    useEffect(() => {
        let cancelled = false

        ;(async () => {
            try {
                const mod = await import('zstd-codec')
                await new Promise<void>(resolve => {
                    ;(mod as any).ZstdCodec.run((z: any) => {
                        zstdRef.current = new z.Streaming()
                        if (!cancelled) setZstdReady(true)
                        resolve()
                    })
                })
            } catch {}
        })()

        return () => {
            cancelled = true
        }
    }, [])

    return { zstdReady, zstdRef }
}
