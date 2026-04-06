import UserInterface from '@entities/user/model/user.interface'

export interface ExtendedUser extends UserInterface {
    allAchievements?: any[]
}
