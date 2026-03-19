import React from 'react'
import axios from 'axios'

import config from '@common/appConfig'
import toast from '@shared/ui/toast'

type UploadKind = 'avatar' | 'banner'

type UploadProfileMediaParams = {
    kind: UploadKind
    file: File
    setProgress: React.Dispatch<React.SetStateAction<number>>
    setUser: React.Dispatch<React.SetStateAction<any>>
    t: (key: string, options?: any) => string
}

const uploadConfig = {
    avatar: {
        endpoint: 'avatar',
        hashKey: 'avatarHash',
        typeKey: 'avatarType',
        successKey: 'header.avatarUploadSuccess',
        unknownKey: 'header.avatarUploadUnknownError',
        forbiddenKey: 'header.avatarUploadForbidden',
        retryKey: 'header.avatarUploadRetry',
        allowFileNotImageError: true,
    },
    banner: {
        endpoint: 'banner',
        hashKey: 'bannerHash',
        typeKey: 'bannerType',
        successKey: 'header.bannerUploadSuccess',
        unknownKey: 'header.bannerUploadUnknownError',
        forbiddenKey: 'header.bannerUploadForbidden',
        retryKey: 'header.bannerUploadRetry',
        allowFileNotImageError: false,
    },
} as const

export async function uploadProfileMedia({ kind, file, setProgress, setUser, t }: UploadProfileMediaParams) {
    if (!file) return

    const currentConfig = uploadConfig[kind]
    const formData = new FormData()
    formData.append('file', file)

    try {
        const response = await axios.post(`${config.SERVER_URL}/cdn/${currentConfig.endpoint}/upload`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
                Authorization: `Bearer ${window.electron.store.get('tokens.token')}`,
            },
            onUploadProgress: progressEvent => {
                const { loaded, total } = progressEvent
                const percentCompleted = Math.floor((loaded * 100) / (total || 1))
                setProgress(percentCompleted)
            },
        })

        const data = response.data

        if (data?.ok) {
            setProgress(-1)
            setUser((prev: any) => ({
                ...prev,
                [currentConfig.hashKey]: data.hash,
                [currentConfig.typeKey]: data.type,
            }))
            toast.custom('success', t('common.doneTitle'), t(currentConfig.successKey))
            return
        }

        setProgress(-1)
        toast.custom('error', t('common.oopsTitle'), t(currentConfig.unknownKey))
    } catch (error: any) {
        switch (error.response?.data?.message) {
            case 'FILE_TOO_LARGE':
                toast.custom('error', t('header.uploadAttentionTitle'), t('header.fileTooLarge'))
                break
            case 'FILE_NOT_ALLOWED':
                toast.custom(
                    'error',
                    t('header.uploadAttentionTitle'),
                    t(currentConfig.allowFileNotImageError ? 'header.fileNotImage' : currentConfig.retryKey),
                )
                break
            case 'UPLOAD_FORBIDDEN':
                toast.custom('error', t('header.accessDeniedTitle'), t(currentConfig.forbiddenKey))
                break
            default:
                toast.custom('error', t('common.oopsTitle'), t(currentConfig.retryKey))
                break
        }

        setProgress(-1)
    }
}
