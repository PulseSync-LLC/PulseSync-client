import React, { useEffect, useState, useRef, useLayoutEffect, JSX } from 'react'
import toast, { Renderable, ToastOptions } from 'react-hot-toast'
import { CSSTransition, TransitionGroup } from 'react-transition-group'
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
    ts: number
}

const STICKY_KINDS: Kind[] = ['loading', 'download', 'export', 'import']
const STICKY_SET = new Set<Kind>(STICKY_KINDS)

let queue: ToastData[] = []
const subs = new Set<(s: ToastData[]) => void>()
const emit = () => subs.forEach(fn => fn(queue))

function sortQueue() {
    queue.sort((a, b) => {
        const ap = STICKY_SET.has(a.kind) ? 1 : 0
        const bp = STICKY_SET.has(b.kind) ? 1 : 0
        if (ap !== bp) return ap - bp
        return a.ts - b.ts
    })
}

function remove(id: string) {
    queue = queue.filter(t => t.id !== id)
    if (queue.length) emit()
    else {
        toast.dismiss('android-stack')
        stackShown = false
    }
}

let stackShown = false
function ensureStack(opts?: ToastOptions) {
    if (stackShown) return
    toast.custom(() => <ToastStack />, {
        id: 'android-stack',
        duration: Infinity,
        position: 'top-center',
        ...opts,
    })
    stackShown = true
}

export const iToast = {
    custom(kind: Kind, title: string, msg: Renderable, options?: ToastOptions, value?: number, duration = 5000) {
        const sticky = STICKY_SET.has(kind)
        const now = Date.now()

        if (sticky) {
            const existing = queue.find(t => t.kind === kind && t.sticky && (t.value ?? 0) < 100)
            if (existing) {
                Object.assign(existing, { title, msg, value, duration, ts: now })
                sortQueue()
                emit()
                return existing.id
            }
        }

        const id = `t-${now}-${Math.random()}`
        queue.push({
            id,
            kind,
            title,
            msg,
            value,
            sticky,
            duration,
            ts: now,
        })
        sortQueue()
        emit()
        ensureStack(options)
        return id
    },

    update(id: string, patch: Partial<Omit<ToastData, 'id' | 'ts'>>) {
        const t = queue.find(x => x.id === id)
        if (!t) return
        Object.assign(t, patch, { ts: Date.now() })
        sortQueue()
        emit()
    },

    dismiss(id: string) {
        remove(id)
    },
}

const ToastStack: React.FC = () => {
    const [toasts, setToasts] = useState<ToastData[]>(queue)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        const sub = (s: ToastData[]) => setToasts([...s])
        subs.add(sub)
        return () => {
            subs.delete(sub)
        }
    }, [])

    const list = [...toasts].slice(-7).reverse()
    const renderList = open || list.length === 1 ? list : [list[0]]

    const cardRefs = useRef<(HTMLDivElement | null)[]>([])
    const nodeRefs = useRef(new Map<string, React.RefObject<HTMLDivElement>>())
    const getNodeRef = (id: string) => {
        let r = nodeRefs.current.get(id)
        if (!r) {
            r = React.createRef<HTMLDivElement>()
            nodeRefs.current.set(id, r)
        }
        return r
    }

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

    if (!toasts.length) return null

    return (
        <div
            className={`${styles.stack} ${open || list.length === 1 ? styles.expanded : styles.collapsed}`}
            onClick={() => list.length > 1 && setOpen(o => !o)}
        >
            <TransitionGroup component={null}>
                {renderList.map((td, idx) => (
                    <CSSTransition
                        key={td.id}
                        timeout={320}
                        nodeRef={getNodeRef(td.id)}
                        classNames={{
                            enter: styles.fadeEnter,
                            enterActive: styles.fadeEnterActive,
                            exit: styles.fadeExit,
                            exitActive: styles.fadeExitActive,
                        }}
                    >
                        <Card
                            data={td}
                            index={idx}
                            stackSize={renderList.length}
                            open={open || list.length === 1}
                            offset={open ? offsets[idx] : 0}
                            ref={el => {
                                cardRefs.current[idx] = el
                                getNodeRef(td.id).current = el
                            }}
                            onDismiss={() => {
                                nodeRefs.current.delete(td.id)
                                remove(td.id)
                            }}
                        />
                    </CSSTransition>
                ))}
            </TransitionGroup>
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
        if (sticky && (value ?? 0) >= 100) {
            setShow(false)
            toast.dismiss(data.id)
            setTimeout(onDismiss, 220)
        }
    }, [sticky, value, onDismiss, data.id])

    const zIndex = stackSize - index

    return (
        <div
            ref={ref}
            className={`${styles.card} ${show ? styles.cardIn : styles.cardOut} ${styles[kind]}`}
            style={
                {
                    transform: `translateY(${offset}px) scale(1)`,
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
