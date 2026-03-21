import React from 'react'
import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import * as styles from '@widgets/modalContainer/modals/ExtensionPublicationModal.module.scss'

const REPUBLISH_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000

const ExtensionPublicationModal: React.FC = () => {
    const { t, i18n } = useTranslation()
    const { Modals, closeModal, isModalOpen, getModalState, setModalState } = useModalContext()
    const { addon, authorsDisplay, publication, publicationBusy, changelogText, onChangeChangelog, onPublish, onUpdate } =
        getModalState(Modals.EXTENSION_PUBLICATION_MODAL)
    const publicationRelease = publication?.currentRelease

    const handleClose = () => {
        closeModal(Modals.EXTENSION_PUBLICATION_MODAL)
    }

    const handleChangelogChange = (value: string) => {
        setModalState(Modals.EXTENSION_PUBLICATION_MODAL, {
            changelogText: value,
        })
        onChangeChangelog?.(value)
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

    const canSubmit = normalizedChangelog.length > 0 && !publicationBusy

    const primaryButton = onUpdate
        ? {
              text: publicationBusy ? t('extensions.publication.uploading') : t('extensions.publication.update'),
              onClick: () => {
                  onUpdate(changelogText)
              },
              disabled: !canSubmit,
          }
        : onPublish
          ? {
                text: publicationBusy ? t('extensions.publication.uploading') : t('extensions.publication.publish'),
                onClick: () => {
                    onPublish(changelogText)
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
                ...(primaryButton ? [primaryButton] : []),
                {
                    text: t('common.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: publicationBusy,
                },
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

                {primaryButton ? (
                    <div className={styles.noteCard}>
                        <span className={styles.label}>{t('extensions.publication.changelogLabel')}</span>
                        <textarea
                            className={styles.changelogInput}
                            value={changelogText}
                            onChange={event => handleChangelogChange(event.target.value)}
                            placeholder={t('extensions.publication.changelogPlaceholder')}
                            rows={5}
                        />
                    </div>
                ) : null}
            </div>
        </CustomModalPS>
    )
}

export default ExtensionPublicationModal
