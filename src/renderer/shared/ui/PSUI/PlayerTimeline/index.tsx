import React, { useContext, useEffect, useRef, useState } from 'react'
import PlayerContext from '@entities/track/model/player.context'
import * as styles from '@shared/ui/PSUI/PlayerTimeline/PlayerTimeline.module.scss'

const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`
}

const PlayerTimeline: React.FC = () => {
    const { currentTrack } = useContext(PlayerContext)
    const track = currentTrack
    const [currentTime, setCurrentTime] = useState<number>(0)
    const animationFrameRef = useRef<number | null>(null)
    const lastTimestampRef = useRef<number>(performance.now())

    const playingRef = useRef<boolean>(false)

    useEffect(() => {
        setCurrentTime(track?.progress?.position || 0)
        playingRef.current = track?.status === 'playing'
        lastTimestampRef.current = performance.now()
    }, [track])

    useEffect(() => {
        const updateTime = (timestamp: number) => {
            if (playingRef.current) {
                const elapsed = (timestamp - lastTimestampRef.current) / 1000
                lastTimestampRef.current = timestamp

                setCurrentTime(prevTime => {
                    const newTime = prevTime + elapsed
                    return newTime < (track?.progress?.duration || 0) ? newTime : prevTime
                })
            } else {
                lastTimestampRef.current = timestamp
            }

            animationFrameRef.current = requestAnimationFrame(updateTime)
        }

        animationFrameRef.current = requestAnimationFrame(updateTime)

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current)
            }
        }
    }, [track?.progress?.duration, track?.status])

    const progressPercent = track?.progress?.duration && currentTime ? (currentTime / track.progress.duration) * 100 : 0

    return (
        <div className={styles.timelineContainer}>
            <div className={styles.timestamp}>{formatTime(currentTime)}</div>

            <div className={styles.timeline}>
                <div className={styles.progress} style={{ width: `${progressPercent}%` }}></div>
            </div>

            <div className={styles.timestamp}>{track?.progress?.duration ? formatTime(track.progress.duration) : '00:00'}</div>
        </div>
    )
}

export default PlayerTimeline
