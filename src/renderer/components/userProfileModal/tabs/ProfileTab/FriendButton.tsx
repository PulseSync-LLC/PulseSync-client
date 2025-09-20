import React, { useState } from 'react'
import { MdPersonAdd, MdPeopleAlt, MdHowToReg, MdPersonOff, MdPersonRemove, MdSettings } from 'react-icons/md'
import { useMutation } from '@apollo/client/react'
import Button from '../../../buttonV2'
import toggleFollowMutation from '../../../../api/mutations/toggleFollow.query'
import * as styles from '../../userProfileModal.module.scss'

interface FriendButtonProps {
    userProfile: any
    user: any
    username: string
}

type ToggleFollowData = {
    toggleFollow: {
        isFollowing: boolean
        areFriends: boolean
    }
}

type ToggleFollowVars = {
    targetId: string
}

const FriendButton: React.FC<FriendButtonProps> = ({ userProfile, user, username }) => {
    const [isHovered, setIsHovered] = useState(false)

    const [runToggleFollow, { loading, error }] = useMutation<ToggleFollowData, ToggleFollowVars>(toggleFollowMutation, {
        onCompleted: data => {
            userProfile.isFollowing = data.toggleFollow.isFollowing
            userProfile.isFriend = data.toggleFollow.areFriends
        },
    })

    const handleToggleFollow = async () => {
        try {
            await runToggleFollow({
                variables: { targetId: userProfile.id as string },
            })
        } catch (e) {
            console.error('Ошибка при запросе на добавление/удаление из друзей', e)
        }
    }

    if ((user?.username || '').toLowerCase() === (username || '').toLowerCase()) {
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
            disabled={loading}
            aria-busy={loading}
            aria-disabled={loading}
            title={error ? 'Произошла ошибка. Повторите попытку.' : undefined}
        >
            {isHovered ? hoverIcon : normalIcon} {isHovered ? buttonTextHover : buttonTextNormal}
        </Button>
    )
}

export default FriendButton
