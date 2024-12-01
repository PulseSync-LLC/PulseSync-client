import { createContext } from 'react'
import { Track } from '../interfaces/track.interface'

interface p {
    currentTrack?: Track
    setTrack?: (data: any) => void
    state?: boolean
    highQuality?: boolean
    muted?: boolean
    shuffle?: boolean
    mode?: 'DEFAULT' | 'REPEAT' | 'REPEAT_ONE' | 'SHUFFLE'
    currentMs?: number
    volume?: number
    loading?: boolean
    queue?: Track[]
    pauseResume?: () => void
    playTrack?: (data: any) => void
    addTracks?: (data: any[]) => void
    dispatch?: (action: any) => void
    seek?: (number: number) => void
    mute?: () => void
    skipTrack?: () => void
    prevTrack?: () => void
}

const PlayerContext = createContext<p>({
    setTrack: () => void 0,
    shuffle: false,
    state: false,
    loading: false,
    muted: false,
    highQuality: false,
    currentMs: 0,
    mode: 'DEFAULT',
    queue: [],
    volume: 100,
})

export default PlayerContext
