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
    levelInfoV2: {
        totalPoints: 0,
    },
}

export default UserInitials
