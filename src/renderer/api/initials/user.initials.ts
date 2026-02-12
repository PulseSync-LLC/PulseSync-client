import UserInterface from '../interfaces/user.interface'

const UserInitials: UserInterface = {
    id: '-1',
    avatar: '',
    avatarHash: '',
    avatarType: '',
    email: '',
    createdAt: 0,
    lastOnline: '',
    currentTrack: null,
    status: '',
    banner: '',
    bannerHash: '',
    bannerType: '',
    username: '',
    nickname: '',
    perms: 'default',
    badges: [],
    userAchievements: [],
    subscription: null,
    hasSupporterBadge: false,
    active: false,
    isFriend: false,
    isFollowing: false,
    levelInfo: {
        totalPoints: 0,
        currentLevel: 0,
        currentLevelThreshold: 0,
        progressInCurrentLevel: 0,
    },
}

export default UserInitials
