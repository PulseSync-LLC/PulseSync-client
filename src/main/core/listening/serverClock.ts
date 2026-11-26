interface ClockSample {
    receivedAt: number
    offsetMs: number
    uncertaintyMs: number
}

export class ServerClock {
    private samples: ClockSample[] = []
    private offsetMs: number | null = null
    private targetOffsetMs = 0
    private advancedAt = 0
    private sampledAt = -Infinity
    private uncertaintyMs = 2000
    rttMs: number | null = null

    add(sent: number, received: number, serverReceive: number, serverSend: number): void {
        if (![sent, received, serverReceive, serverSend].every(Number.isFinite) || received < sent || serverSend < serverReceive) return
        const uncertainty = Math.ceil((received - sent - (serverSend - serverReceive)) / 2)
        if (uncertainty < 0 || uncertainty > 2000) return
        if (received - this.sampledAt >= 30000) this.reset()
        this.advance(received)
        this.samples = this.samples.filter(sample => received - sample.receivedAt < 20000)
        this.samples.push({ receivedAt: received, offsetMs: (serverReceive - sent + serverSend - received) / 2, uncertaintyMs: uncertainty })
        this.samples = this.samples.slice(-8)
        const best = this.samples.reduce((left, right) => (right.uncertaintyMs <= left.uncertaintyMs ? right : left))
        this.targetOffsetMs = best.offsetMs
        this.uncertaintyMs = best.uncertaintyMs + Math.ceil((received - best.receivedAt) * 0.0001)
        if (this.offsetMs === null) {
            this.offsetMs = best.offsetMs
            this.advancedAt = received
        }
        this.sampledAt = received
        this.rttMs = Math.round(received - sent)
    }

    read(now = performance.now()): { nowMs: number; uncertaintyMs: number } | null {
        if (this.offsetMs === null || now - this.sampledAt >= 30000) return null
        this.advance(now)
        const uncertainty = Math.ceil(this.uncertaintyMs + Math.abs(this.targetOffsetMs - this.offsetMs) + (now - this.sampledAt) * 0.0001)
        return uncertainty > 2000 ? null : { nowMs: now + this.offsetMs, uncertaintyMs: uncertainty }
    }

    reset(): void {
        this.samples = []
        this.offsetMs = null
        this.targetOffsetMs = 0
        this.sampledAt = -Infinity
        this.advancedAt = 0
        this.uncertaintyMs = 2000
        this.rttMs = null
    }

    private advance(now: number): void {
        if (this.offsetMs === null) return
        const step = Math.max(0, now - this.advancedAt) * 0.02
        this.offsetMs += Math.max(-step, Math.min(step, this.targetOffsetMs - this.offsetMs))
        this.advancedAt = now
    }
}
