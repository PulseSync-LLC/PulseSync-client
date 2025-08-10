import React, { useCallback, useEffect, useRef, useState } from 'react'
import SliderInput from '../PSUI/SliderInput'

type SliderProps = React.ComponentProps<typeof SliderInput>

type Props = Omit<SliderProps, 'value' | 'onChange'> & {
    value: number
    onCommit: (next: number) => void
    onStartDrag?: () => void
    onEndDrag?: () => void
}

const BufferedSliderInput: React.FC<Props> = ({ value, onCommit, onStartDrag, onEndDrag, ...rest }) => {
    const [draft, setDraft] = useState<number>(value)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const commitRef = useRef(onCommit)
    commitRef.current = onCommit

    useEffect(() => {
        setDraft(value)
    }, [value])

    const commit = useCallback(() => {
        if (draft !== value) commitRef.current(draft)
    }, [draft, value])

    useEffect(() => {
        const el = rootRef.current
        if (!el) return
        const onDown = () => {
            onStartDrag?.()
        }
        const onUp = () => {
            onEndDrag?.()
            commit()
        }
        el.addEventListener('pointerdown', onDown, true)
        window.addEventListener('pointerup', onUp, true)
        return () => {
            el.removeEventListener('pointerdown', onDown, true)
            window.removeEventListener('pointerup', onUp, true)
        }
    }, [commit, onStartDrag, onEndDrag])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') commit()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [commit])

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

    return (
        <div ref={rootRef}>
            <SliderInput {...rest} value={draft} onChange={v => setDraft(v)} />
        </div>
    )
}

export default BufferedSliderInput
