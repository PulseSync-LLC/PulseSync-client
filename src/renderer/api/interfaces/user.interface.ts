import { Track } from './track.interface'
import SubscriptionInterface from './subscription.interface'

export default interface UserInterface {
    id: string
    avatar: string
    banner: string
    username: string
    nickname: string
    email: string
    createdAt: number
    status: string
    lastOnline: string
    currentTrack: Track
    avatarHash: string
    avatarType: string
    bannerHash: string
    bannerType: string
    perms: string
    isFriend: boolean
    isFollowing: boolean
    levelInfo: {
        totalPoints: number
        currentLevel: number
        currentLevelThreshold: number
        progressInCurrentLevel: number
    }
    userAchievements: any[]
    badges: any[]
    subscription: SubscriptionInterface | null
    hasSupporterBadge: boolean
    active: boolean
}
