import React, { useEffect, useState, useRef, useLayoutEffect, JSX } from 'react'
import toast, { Renderable, ToastOptions, Toast } from 'react-hot-toast'
import * as styles from './toast.module.scss'
import { MdCheckCircle, MdError, MdInfo, MdWarning, MdDownload, MdLoop, MdImportExport, MdClose } from 'react-icons/md'

type Kind = 'success' | 'error' | 'warning' | 'info' | 'download' | 'loading' | 'export' | 'import' | 'default'

interface ToastData {
    id: string
    kind: Kind
    title: string
    msg: Renderable
    value?: number
    sticky: boolean
    duration: number
}

let queue: ToastData[] = []
const subs = new Set<(s: ToastData[]) => void>()
const emit = () => subs.forEach(fn => fn(queue))
const sub = (fn: (s: ToastData[]) => void) => {
    subs.add(fn)
    return () => subs.delete(fn)
}

export const iToast = {
    custom: (kind: Kind, title: string, msg: Renderable, options?: ToastOptions, value?: number, duration = 5000) => {
        const sticky = ['loading', 'export', 'import', 'download'].includes(kind)
        const id = `t-${Date.now()}-${Math.random()}`
        queue.push({ id, kind, title, msg, value, sticky, duration })
        emit()
        renderStack(options)
        return id
    },
}

function remove(id: string) {
    queue = queue.filter(t => t.id !== id)
    queue.length ? renderStack() : toast.dismiss('android-stack')
}

function renderStack(opts?: ToastOptions) {
    toast.custom((t: Toast) => <ToastStack toasts={queue} />, { id: 'android-stack', duration: Infinity, position: 'top-center', ...opts })
}

const ToastStack: React.FC<{ toasts: ToastData[] }> = ({ toasts }) => {
    const [open, setOpen] = useState(toasts.length === 1)
    const list = [...toasts].slice(-7).reverse()
    const cardRefs = useRef<(HTMLDivElement | null)[]>([])
    const [offsets, setOffsets] = useState<number[]>([])

    useLayoutEffect(() => {
        if (open && cardRefs.current.length) {
            let acc = 0
            const arr: number[] = []
            for (let i = 0; i < list.length; ++i) {
                arr[i] = acc
                const h = cardRefs.current[i]?.getBoundingClientRect().height ?? 64
                acc += h + 10
            }
            setOffsets(arr)
        } else {
            setOffsets(Array(list.length).fill(0))
        }
    }, [open, list.length, toasts.map(t => t.id).join('|')])

    const prevCount = useRef(list.length)
    useEffect(() => {
        if (list.length === 1) setOpen(true)
        else if (list.length > 1 && list.length > prevCount.current) setOpen(false)
        prevCount.current = list.length
    }, [list.length])

    return (
        <div
            className={`${styles.stack} ${open || list.length === 1 ? styles.expanded : styles.collapsed}`}
            onClick={() => list.length > 1 && setOpen(o => !o)}
        >
            {list.map((td, idx) => (
                <Card
                    key={td.id}
                    data={td}
                    index={idx}
                    stackSize={list.length}
                    open={open || list.length === 1}
                    offset={open ? offsets[idx] : 0}
                    ref={el => {
                        cardRefs.current[idx] = el
                    }}
                    onDismiss={() => remove(td.id)}
                />
            ))}
        </div>
    )
}

interface CardProps {
    data: ToastData
    index: number
    stackSize: number
    open: boolean
    offset: number
    onDismiss: () => void
}
const Card = React.forwardRef<HTMLDivElement, CardProps>(({ data, index, stackSize, open, offset, onDismiss }, ref) => {
    const { kind, title, msg, value, sticky, duration } = data
    const [show, setShow] = useState(false)

    useEffect(() => {
        const t = setTimeout(() => setShow(true), 60)
        return () => clearTimeout(t)
    }, [])

    useEffect(() => {
        if (!sticky && show) {
            const t = setTimeout(() => {
                setShow(false)
                setTimeout(onDismiss, 280)
            }, duration)
            return () => clearTimeout(t)
        }
    }, [show, sticky, duration, onDismiss])

    useEffect(() => {
        if (sticky && value === 100) {
            setTimeout(() => {
                setShow(false)
                setTimeout(onDismiss, 280)
            }, 350)
        }
    }, [sticky, value, onDismiss])

    const scale = 1
    const zIndex = stackSize - index

    return (
        <div
            ref={ref}
            className={`${styles.card} ${show ? styles.cardIn : styles.cardOut} ${styles[kind]}`}
            style={
                {
                    transform: `translateY(${offset}px) scale(${scale})`,
                    zIndex,
                    color: palette(kind),
                } as React.CSSProperties
            }
        >
            <div className={styles.icon}>{sticky ? <Progress val={value} /> : icons[kind]}</div>
            <div className={styles.text}>
                <div className={styles.title}>{title}</div>
                <div className={styles.msg}>{msg}</div>
            </div>
            <button
                className={styles.hide}
                onClick={e => {
                    e.stopPropagation()
                    setShow(false)
                    setTimeout(onDismiss, 220)
                }}
            >
                <MdClose size={18} />
            </button>
        </div>
    )
})

const Progress: React.FC<{ val?: number }> = ({ val = 0 }) => (
    <div className={styles.progressContainer}>
        <div className={styles.progressText}>{Math.round(val)}%</div>
        <svg viewBox="0 0 36 36" className={styles.prog}>
            <path className={styles.bg} d="M18 2.1a15.9 15.9 0 1 1 0 31.8 15.9 15.9 0 0 1 0-31.8" fill="none" strokeWidth="3" />
            <path
                className={styles.fg}
                strokeDasharray={`${val},100`}
                d="M18 2.1a15.9 15.9 0 1 1 0 31.8 15.9 15.9 0 0 1 0-31.8"
                fill="none"
                strokeWidth="3"
            />
        </svg>
    </div>
)

const palette = (k: Kind) =>
    ({
        success: '#87FF77',
        error: '#FF7777',
        warning: '#FFEF77',
        info: '#77FFC9',
        download: '#87FF77',
        loading: '#FFEF77',
        export: '#77F1FF',
        import: '#77F1FF',
        default: '#87FF77',
    })[k]

const icons: Record<Kind, JSX.Element> = {
    success: <MdCheckCircle size={22} />,
    error: <MdError size={22} />,
    info: <MdInfo size={22} />,
    warning: <MdWarning size={22} />,
    download: <MdDownload size={22} />,
    loading: <MdLoop size={22} />,
    export: <MdImportExport size={22} />,
    import: <MdImportExport size={22} />,
    default: <MdInfo size={22} />,
}

export default iToast