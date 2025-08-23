import React, { useContext, useEffect, useRef, useState } from 'react'
import PlayerContext from '../../../api/context/player.context'
import UserContext from '../../../api/context/user.context'
import { Track } from '../../../api/interfaces/track.interface'
import trackInitials from '../../../api/initials/track.initials'
import * as styles from './PlayerTimeline.module.scss'

const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`
}

const PlayerTimeline: React.FC = () => {
    const { currentTrack } = useContext(PlayerContext)
    const [currentTime, setCurrentTime] = useState<number>(0)
    const animationFrameRef = useRef<number | null>(null)
    const lastTimestampRef = useRef<number>(performance.now())

    const playingRef = useRef<boolean>(false)

    useEffect(() => {
        setCurrentTime(currentTrack?.progress?.position || 0)
        playingRef.current = currentTrack.status === 'playing'
    }, [currentTrack])

    useEffect(() => {
        const updateTime = (timestamp: number) => {
            if (playingRef.current) {
                const elapsed = (timestamp - lastTimestampRef.current) / 1000
                lastTimestampRef.current = timestamp

                setCurrentTime(prevTime => {
                    const newTime = prevTime + elapsed
                    return newTime < (currentTrack.progress?.duration || 0) ? newTime : prevTime
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
    }, [currentTrack.progress?.duration])

    const progressPercent = currentTrack.progress?.duration && currentTime ? (currentTime / currentTrack.progress.duration) * 100 : 0

    return (
        <div className={styles.timelineContainer}>
            <div className={styles.timestamp}>{formatTime(currentTime)}</div>

            <div className={styles.timeline}>
                <div className={styles.progress} style={{ width: `${progressPercent}%` }}></div>
            </div>

            <div className={styles.timestamp}>{currentTrack.progress?.duration ? formatTime(currentTrack.progress.duration) : '00:00'}</div>
        </div>
    )
}

export default PlayerTimeline
