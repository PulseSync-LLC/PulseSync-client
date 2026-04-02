import React, { useEffect, useState } from 'react'
import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import * as styles from '@widgets/modalContainer/modals/ExtensionPublicationModal.module.scss'

const REPUBLISH_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000
const ADDON_PUBLISHING_RULES_URL = 'https://pulsesync.dev/wiki/main/app/addons/publishing'

function isGithubUrl(value: string): boolean {
    const trimmed = value.trim()
    if (!trimmed) return false

    try {
        const url = new URL(trimmed)
        return (url.protocol === 'http:' || url.protocol === 'https:') && ['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())
    } catch {
        return false
    }
}

const ExtensionPublicationModal: React.FC = () => {
    const { t, i18n } = useTranslation()
    const { Modals, closeModal, isModalOpen, getModalState, setModalState } = useModalContext()
    const { addon, authorsDisplay, publication, publicationBusy, changelogText, githubUrlText, onChangeChangelog, onChangeGithubUrl, onPublish, onUpdate } = getModalState(
        Modals.EXTENSION_PUBLICATION_MODAL,
    )
    const publicationRelease = publication?.currentRelease
    const [rulesAccepted, setRulesAccepted] = useState(false)

    useEffect(() => {
        if (!isModalOpen(Modals.EXTENSION_PUBLICATION_MODAL)) {
            setRulesAccepted(false)
            return
        }

        setRulesAccepted(false)
    }, [Modals.EXTENSION_PUBLICATION_MODAL, addon?.path, isModalOpen, publication?.id, publicationRelease?.id])

    const handleClose = () => {
        closeModal(Modals.EXTENSION_PUBLICATION_MODAL)
    }

    const handleChangelogChange = (value: string) => {
        setModalState(Modals.EXTENSION_PUBLICATION_MODAL, {
            changelogText: value,
        })
        onChangeChangelog?.(value)
    }

    const handleGithubUrlChange = (value: string) => {
        setModalState(Modals.EXTENSION_PUBLICATION_MODAL, {
            githubUrlText: value,
        })
        onChangeGithubUrl?.(value)
    }

    const statusLabel = publicationRelease
        ? publicationRelease.status === 'accepted'
            ? t('store.status.accepted')
            : publicationRelease.status === 'rejected'
              ? t('store.status.rejected')
              : t('store.status.pending')
        : t('store.status.notPublished')

    const statusClassName = publicationRelease
        ? publicationRelease.status === 'accepted'
            ? styles.statusAccepted
            : publicationRelease.status === 'rejected'
              ? styles.statusRejected
              : styles.statusPending
        : styles.statusUnpublished

    const publicationDate = publicationRelease?.updatedAt
        ? new Intl.DateTimeFormat(i18n.language, {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
          }).format(new Date(publicationRelease.updatedAt))
        : null

    const republishAvailableAtTimestamp =
        publicationRelease?.status === 'rejected' && publicationRelease?.updatedAt
            ? new Date(publicationRelease.updatedAt).getTime() + REPUBLISH_COOLDOWN_MS
            : null

    const republishAvailableAt =
        typeof republishAvailableAtTimestamp === 'number' &&
        Number.isFinite(republishAvailableAtTimestamp) &&
        Date.now() < republishAvailableAtTimestamp
            ? new Intl.DateTimeFormat(i18n.language, {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
              }).format(new Date(republishAvailableAtTimestamp))
            : null

    const normalizedChangelog = changelogText
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*[-*•]\s*/, '').trim())
        .filter(Boolean)

    const hasValidGithubUrl = isGithubUrl(githubUrlText)
    const canSubmit = normalizedChangelog.length > 0 && hasValidGithubUrl && rulesAccepted && !publicationBusy

    const primaryButton = onUpdate
        ? {
              text: publicationBusy ? t('extensions.publication.uploading') : t('extensions.publication.update'),
              onClick: () => {
                  onUpdate(changelogText, githubUrlText)
              },
              disabled: !canSubmit,
          }
        : onPublish
          ? {
                text: publicationBusy ? t('extensions.publication.uploading') : t('extensions.publication.publish'),
                onClick: () => {
                    onPublish(changelogText, githubUrlText)
                },
                disabled: !canSubmit,
            }
          : null

    return (
        <CustomModalPS
            className={styles.publicationModal}
            isOpen={isModalOpen(Modals.EXTENSION_PUBLICATION_MODAL)}
            onClose={handleClose}
            buttons={[
                {
                    text: t('common.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: publicationBusy,
                },
                ...(primaryButton ? [primaryButton] : []),
            ]}
        >
            <div className={styles.body}>
                <div className={styles.header}>
                    <span className={styles.eyebrow}>{t('extensions.publication.modalTitle')}</span>
                    <div className={styles.headlineRow}>
                        <div className={styles.identity}>
                            <h2 className={styles.addonName}>{addon?.name || t('store.unknownAddon')}</h2>
                            <p className={styles.authors}>
                                <span className={styles.authorsLabel}>{t('extensions.meta.authors')}</span>
                                <span>{authorsDisplay || t('common.emDash')}</span>
                            </p>
                        </div>

                        <span className={cn(styles.statusBadge, statusClassName)}>{statusLabel}</span>
                    </div>
                </div>

                <div className={styles.infoGrid}>
                    <div className={styles.infoCard}>
                        <span className={styles.label}>{t('extensions.meta.version')}</span>
                        <span className={styles.value}>{addon?.version || publicationRelease?.version || t('common.emDash')}</span>
                    </div>
                    {publicationDate ? (
                        <div className={styles.infoCard}>
                            <span className={styles.label}>{t('extensions.meta.updated')}</span>
                            <span className={styles.value}>{publicationDate}</span>
                        </div>
                    ) : null}
                </div>

                {publicationRelease?.moderationNote ? (
                    <div className={styles.noteCard}>
                        <span className={styles.label}>{t('extensions.publication.noteLabel')}</span>
                        <span className={styles.subValue}>{publicationRelease.moderationNote}</span>
                    </div>
                ) : publicationDate ? (
                    <div className={styles.noteCard}>
                        <span className={styles.label}>{t('extensions.meta.updated')}</span>
                        <span className={styles.subValue}>{t('extensions.publication.statusDate', { date: publicationDate })}</span>
                    </div>
                ) : null}

                {republishAvailableAt ? (
                    <div className={styles.cooldownCard}>
                        <span className={styles.label}>{t('extensions.publication.cooldownLabel')}</span>
                        <span className={styles.subValue}>{t('extensions.publication.cooldownMessage', { date: republishAvailableAt })}</span>
                    </div>
                ) : null}

                <div className={styles.noteCard}>
                    <span className={styles.label}>
                        {t('extensions.publication.githubUrlLabel')} <span className={styles.requiredMark}>*</span>
                    </span>
                    {primaryButton ? (
                        <input
                            className={styles.githubInput}
                            type="url"
                            value={githubUrlText}
                            onChange={event => handleGithubUrlChange(event.target.value)}
                            placeholder={t('extensions.publication.githubUrlPlaceholder')}
                        />
                    ) : publicationRelease?.githubUrl ? (
                        <a className={styles.subValue} href={publicationRelease.githubUrl} target="_blank" rel="noreferrer">
                            {publicationRelease.githubUrl}
                        </a>
                    ) : (
                        <span className={styles.subValue}>{t('common.emDash')}</span>
                    )}
                </div>

                {primaryButton ? (
                    <div className={styles.noteCard}>
                        <span className={styles.label}>
                            {t('extensions.publication.changelogLabel')} <span className={styles.requiredMark}>*</span>
                        </span>
                        <textarea
                            className={styles.changelogInput}
                            value={changelogText}
                            onChange={event => handleChangelogChange(event.target.value)}
                            placeholder={t('extensions.publication.changelogPlaceholder')}
                            rows={5}
                        />
                    </div>
                ) : null}

                {primaryButton ? (
                    <label className={styles.rulesCheckbox}>
                        <input
                            type="checkbox"
                            checked={rulesAccepted}
                            onChange={event => setRulesAccepted(event.target.checked)}
                        />
                        <span className={styles.rulesCheckboxMark}></span>
                        <span>
                            {t('extensions.publication.rulesAgreementPrefix')}{' '}
                            <a
                                className={styles.rulesLink}
                                href={ADDON_PUBLISHING_RULES_URL}
                                target="_blank"
                                rel="noreferrer"
                                onClick={event => event.stopPropagation()}
                            >
                                {t('extensions.publication.rulesAgreementLink')}
                            </a>
                        </span>
                    </label>
                ) : null}
            </div>
        </CustomModalPS>
    )
}

export default ExtensionPublicationModal
