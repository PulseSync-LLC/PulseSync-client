import { type ReactNode, Suspense, useEffect, useState } from 'react'

export default function DeferredContent({ active, children }: { active: boolean; children: ReactNode }) {
    const [opened, setOpened] = useState(active)
    useEffect(() => {
        if (active) setOpened(true)
    }, [active])

    // Preserve state and closing animations after the first activation.
    if (!active && !opened) return null
    return <Suspense fallback={null}>{children}</Suspense>
}
