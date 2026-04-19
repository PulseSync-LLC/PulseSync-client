import React from 'react'

import rendererHttpClient from '@shared/api/http/client'
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
        tooLargeKey: 'header.avatarFileTooLarge',
        maxFileSize: 5 * 1024 * 1024,
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
        tooLargeKey: 'header.bannerFileTooLarge',
        maxFileSize: 5 * 1024 * 1024,
    },
} as const

type UploadProfileMediaResponse = {
    hash?: string
    message?: string
    ok?: boolean
    type?: string
}

export async function uploadProfileMedia({ kind, file, setProgress, setUser, t }: UploadProfileMediaParams) {
    if (!file) return

    const currentConfig = uploadConfig[kind]

    if (file.size > currentConfig.maxFileSize) {
        toast.custom('error', t('header.uploadAttentionTitle'), t(currentConfig.tooLargeKey))
        setProgress(-1)
        return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
        const response = await rendererHttpClient.post<UploadProfileMediaResponse>(`/cdn/${currentConfig.endpoint}/upload`, {
            auth: true,
            body: formData,
            onUploadProgress: progressEvent => {
                const { loaded, total } = progressEvent
                const percentCompleted = Math.floor((loaded * 100) / (total || 1))
                setProgress(percentCompleted)
            },
        })

        const data = response.data

        if (response.ok && data?.ok) {
            setProgress(-1)
            setUser((prev: any) => ({
                ...prev,
                [currentConfig.hashKey]: data.hash,
                [currentConfig.typeKey]: data.type,
            }))
            toast.custom('success', t('common.doneTitle'), t(currentConfig.successKey))
            return
        }

        if (response.ok) {
            setProgress(-1)
            toast.custom('error', t('common.oopsTitle'), t(currentConfig.unknownKey))
            return
        }

        switch (data?.message) {
            case 'FILE_TOO_LARGE':
                toast.custom('error', t('header.uploadAttentionTitle'), t(currentConfig.tooLargeKey))
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
    } catch (error) {
        console.error('Failed to upload profile media:', error)
        toast.custom('error', t('common.oopsTitle'), t(currentConfig.retryKey))
        setProgress(-1)
    }
}
