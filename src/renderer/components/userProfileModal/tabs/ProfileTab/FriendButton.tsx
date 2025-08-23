import React, { useState } from 'react'
import { MdPersonAdd, MdPeopleAlt, MdHowToReg, MdPersonOff, MdPersonRemove, MdSettings } from 'react-icons/md'
import Button from '../../../buttonV2'
import apolloClient from '../../../../api/apolloClient'
import toggleFollowMutation from '../../../../api/mutations/toggleFollow.query'
import * as styles from '../../userProfileModal.module.scss'

interface FriendButtonProps {
    userProfile: any
    user: any
    username: string
}

const FriendButton: React.FC<FriendButtonProps> = ({ userProfile, user, username }) => {
    const [isHovered, setIsHovered] = useState(false)
    const [, setFriendStatusLoading] = useState(false)

    const handleToggleFollow = async () => {
        try {
            setFriendStatusLoading(true)
            const { data } = await apolloClient.mutate({
                mutation: toggleFollowMutation,
                variables: { targetId: userProfile.id },
            })
            if (data && data.toggleFollow) {
                userProfile.isFollowing = data.toggleFollow.isFollowing
                userProfile.isFriend = data.toggleFollow.areFriends
            }
        } catch (error) {
            console.error('Ошибка при запросе на добавление/удаление из друзей', error)
        } finally {
            setFriendStatusLoading(false)
        }
    }

    if (user.username === username) {
        return (
            <>
                <Button className={styles.buttonAddFriend} disabled>
                    <MdPersonAdd size={20} /> Редактировать профиль
                </Button>
                <Button className={styles.buttonPersonal} disabled>
                    <MdSettings size={20} />
                </Button>
            </>
        )
    }

    let buttonTextNormal = 'Добавить в друзья'
    let buttonTextHover = 'Подписаться'
    let normalIcon = <MdPersonAdd size={20} />
    let hoverIcon = <MdPersonAdd size={20} />
    let buttonClass = styles.buttonAddFriendWhite

    if (userProfile.isFriend) {
        buttonTextNormal = 'Друзья'
        buttonTextHover = 'Удалить из друзей'
        normalIcon = <MdPeopleAlt size={20} />
        hoverIcon = <MdPersonOff size={20} />
        buttonClass = styles.buttonRemoveFriend
    } else if (userProfile.isFollowing) {
        buttonTextNormal = 'Подписан'
        buttonTextHover = 'Отписаться'
        normalIcon = <MdHowToReg size={20} />
        hoverIcon = <MdPersonRemove size={20} />
        buttonClass = styles.buttonUnsubscribe
    }

    return (
        <Button
            type="button"
            className={`${styles.friendActionButton} ${buttonClass}`}
            onClick={handleToggleFollow}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {isHovered ? hoverIcon : normalIcon} {isHovered ? buttonTextHover : buttonTextNormal}
        </Button>
    )
}

export default FriendButton
