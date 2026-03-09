import type { LevelInfo, LevelInfoV2 } from '../api/interfaces/user.interface'

export const defaultLevelInfo: LevelInfo = {
    totalPoints: 0,
    currentLevel: 1,
    progressInCurrentLevel: 0,
    currentLevelThreshold: 100,
}

type LevelInfoOwner = {
    levelInfoV2?: LevelInfoV2 | null
}

function getThresholdForLevel(level: number): number {
    if (level === 1) return 100

    let total = 100
    for (let i = 2; i <= level; i++) {
        total += 100 + i * 5
    }

    return total
}

export function calculateLevelInfo(totalPoints: number): LevelInfo {
    const xp = Math.max(0, Math.floor(totalPoints || 0))
    let currentLevel = 1
    let prevLevelThreshold = 0
    let nextLevelThreshold = getThresholdForLevel(currentLevel)

    while (xp >= nextLevelThreshold) {
        currentLevel++
        prevLevelThreshold = nextLevelThreshold
        nextLevelThreshold = getThresholdForLevel(currentLevel)
    }

    return {
        totalPoints: xp,
        currentLevel,
        progressInCurrentLevel: xp - prevLevelThreshold,
        currentLevelThreshold: nextLevelThreshold - prevLevelThreshold,
    }
}

export function getEffectiveLevelInfo(user?: LevelInfoOwner | null): LevelInfo {
    return calculateLevelInfo(user?.levelInfoV2?.totalPoints ?? 0)
}
