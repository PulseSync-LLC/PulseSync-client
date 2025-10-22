export default class Throttler<T> {
    private throttleMs: number
    private sender: (v: T) => void
    private lastSentAt = 0
    private timer: ReturnType<typeof setTimeout> | undefined
    private latest: T | undefined

    constructor(ms: number, sender: (v: T) => void) {
        this.throttleMs = ms
        this.sender = sender
    }

    schedule(v: T) {
        this.latest = v
        const now = Date.now()
        const elapsed = now - this.lastSentAt

        if (elapsed >= this.throttleMs && !this.timer) {
            this.sender(v)
            this.lastSentAt = Date.now()
            return
        }

        if (!this.timer) {
            const wait = Math.max(0, this.throttleMs - elapsed)
            this.timer = setTimeout(() => {
                this.timer = undefined
                if (this.latest !== undefined) {
                    this.sender(this.latest)
                    this.lastSentAt = Date.now()
                }
            }, wait)
        }
    }

    clear() {
        this.latest = undefined
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = undefined
        }
    }

    markJustSent() {
        this.lastSentAt = Date.now()
    }
}
