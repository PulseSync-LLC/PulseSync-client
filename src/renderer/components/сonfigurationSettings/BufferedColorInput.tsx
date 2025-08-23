import React, { useCallback, useEffect, useRef, useState } from 'react'
import ColorInput from '../PSUI/ColorInput'

type ColorProps = React.ComponentProps<typeof ColorInput>

type Props = Omit<ColorProps, 'value' | 'onChange'> & {
    value: string
    onCommit: (next: string) => void
}

const BufferedColorInput: React.FC<Props> = ({ value, onCommit, ...rest }) => {
    const [draft, setDraft] = useState<string>(value)
    const rootRef = useRef<HTMLDivElement | null>(null)

    const commitRef = useRef(onCommit)
    commitRef.current = onCommit

    useEffect(() => {
        setDraft(value)
    }, [value])

    const commit = useCallback(() => {
        if (draft !== value) {
            commitRef.current(draft)
        }
    }, [draft, value])

    useEffect(() => {
        const el = rootRef.current
        if (!el) return
        const onFocusOut = (e: FocusEvent) => {
            const next = e.relatedTarget as Node | null
            if (next && el.contains(next)) return
            commit()
        }
        el.addEventListener('focusout', onFocusOut, true)
        return () => el.removeEventListener('focusout', onFocusOut, true)
    }, [commit])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') commit()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [commit])

    useEffect(() => {
        const onUnload = () => commit()
        window.addEventListener('beforeunload', onUnload)
        return () => window.removeEventListener('beforeunload', onUnload)
    }, [commit])

    return (
        <div ref={rootRef}>
            <ColorInput {...rest} value={draft} onChange={(v: string) => setDraft(v)} />
        </div>
    )
}

export default BufferedColorInput
