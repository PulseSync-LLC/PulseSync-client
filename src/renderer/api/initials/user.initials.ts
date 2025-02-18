import UserInterface from '../interfaces/user.interface'

const UserInitials: UserInterface = {
    id: '-1',
    avatar: '',
    avatarHash: '',
    avatarType: '',
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
