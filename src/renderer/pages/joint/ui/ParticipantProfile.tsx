import { useContext } from 'react'

import { useQuery } from '@apollo/client/react'
import { Avatar } from '@pulsesync/uikit/data-display'
import { useTranslation } from 'react-i18next'
import { MdPersonOutline } from 'react-icons/md'

import getUserIdentityQuery from '@entities/user/api/getUserIdentity.query'
import UserContext from '@entities/user/model/context'
import { getAvatarMediaUrls } from '@shared/lib/mediaVariants'

import * as styles from '../joint.module.scss'

import type { ListeningParticipant } from '@common/listening/types'
import type { GetUserIdentityData } from '@entities/user/api/getUserIdentity.query'

interface Props {
    participant: ListeningParticipant
    index: number
    self: boolean
    nameOnly?: boolean
}

export default function ParticipantProfile({ participant, index, self, nameOnly }: Props) {
    const { t } = useTranslation()
    const { user } = useContext(UserContext)
    const ownProfile = participant.userId === user.id
    const { data } = useQuery<GetUserIdentityData>(getUserIdentityQuery, {
        variables: { id: participant.userId },
        skip: ownProfile,
        fetchPolicy: 'cache-first',
    })
    const profile = ownProfile ? user : data?.findUserById?.id === participant.userId ? data.findUserById : null
    const name =
        profile?.nickname?.trim() || profile?.username?.trim() || t(self ? 'pages.joint.you' : 'pages.joint.participant', { number: index + 1 })
    if (nameOnly) return <>{name}</>
    const avatar = getAvatarMediaUrls({ hash: profile?.avatarHash, ext: profile?.avatarType })

    return (
        <>
            <Avatar
                size="sm"
                shape="rounded"
                src={avatar?.src}
                srcSet={avatar?.srcSet}
                sizes="40px"
                alt={name}
                loading="lazy"
                decoding="async"
                fallback={<MdPersonOutline size={20} />}
            />
            <div className={styles.participantInfo}>
                <strong title={name}>{name}</strong>
                <span>
                    {t(participant.role === 'host' ? 'pages.joint.host' : 'pages.joint.listener')}
                    {self && <> · {t('pages.joint.you')}</>}
                </span>
            </div>
        </>
    )
}
