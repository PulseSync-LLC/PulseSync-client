import PageLayout from '../PageLayout'
import MainEvents from '../../../common/types/mainEvents'

import * as inputStyle from './oldInput.module.scss'
import * as themeV2 from './trackinfo.module.scss'

import { useCallback, useContext, useRef, useState, useMemo, useEffect } from 'react'
import userContext from '../../api/context/user.context'
import trackInitials from '../../api/initials/track.initials'
import Skeleton from 'react-loading-skeleton'
import { Cubic } from '../../components/PSUI/Cubic'
import playerContext from '../../api/context/player.context'
import { object, string } from 'yup'
import { useFormik } from 'formik'
import { buildActivityButtons as buildActivityButtonsRpc, fixStrings, replaceParams } from '../../utils/formatRpc'
import { useCharCount } from '../../utils/useCharCount'
import config from '../../api/web_config'
import { staticAsset } from '../../utils/staticAssets'
import ContainerV2 from '../../components/containerV2'
import PlayerTimeline from '../../components/PSUI/PlayerTimeline'
import TextInput from '../../components/PSUI/TextInput'
import ButtonInput from '../../components/PSUI/ButtonInput'
import Scrollbar from '../../components/PSUI/Scrollbar'
import { useTranslation } from 'react-i18next'

import statusDisplayTip from '../../../../static/assets/tips/statusDisplayType.gif?url'

type FormValues = {
    appId: string
    details: string
    state: string
    button: string
    statusDisplayType: string
}

export default function TrackInfoPage() {
    const { user, app, setApp } = useContext(userContext)
    const { currentTrack } = useContext(playerContext)
    const { t } = useTranslation()
    const [rickRollClick, setRickRoll] = useState(false)
    const fallbackAvatar = staticAsset('assets/images/undef.png')
    const fallbackLogo = staticAsset('assets/logo/logoapp.png')
    const hasSupporter = user?.badges?.some((badge: any) => badge.type === 'supporter')

    const [previousValues, setPreviousValues] = useState<FormValues>(() => ({
        appId: app.discordRpc.appId || '',
        details: app.discordRpc.details || '',
        state: app.discordRpc.state || '',
        button: app.discordRpc.button || '',
        statusDisplayType: String(app.discordRpc.statusDisplayType ?? ''),
    }))

    useEffect(() => {
        if (hasSupporter || !app.discordRpc.supporterHideBranding) return

        window.discordRpc.clearActivity()
        window.desktopEvents?.send(MainEvents.GET_TRACK_INFO)
        window.electron.store.set('discordRpc.supporterHideBranding', false)
        setApp({
            ...app,
            discordRpc: {
                ...app.discordRpc,
                supporterHideBranding: false,
            },
        })
    }, [app.discordRpc.supporterHideBranding, hasSupporter, setApp])

    const schema = object().shape({
        appId: string()
            .nullable()
            .notRequired()
            .test('len', t('trackInfo.validation.minLength', { count: 18 }), val => !val || val.length >= 18)
            .test('len', t('trackInfo.validation.maxLength', { count: 20 }), val => !val || val.length <= 20),
        details: string()
            .test('len', t('trackInfo.validation.minLength', { count: 2 }), val => !val || val.length >= 2)
            .test('len', t('trackInfo.validation.maxLength', { count: 128 }), val => !val || val.length <= 128),
        state: string()
            .test('len', t('trackInfo.validation.minLength', { count: 2 }), val => !val || val.length >= 2)
            .test('len', t('trackInfo.validation.maxLength', { count: 128 }), val => !val || val.length <= 128),
        button: string().test('len', t('trackInfo.validation.maxLength', { count: 30 }), val => !val || val.length <= 30),
        statusDisplayType: string()
            .matches(/^[012]$/, t('trackInfo.validation.statusDisplayTypeFormat'))
            .required(t('trackInfo.validation.statusDisplayTypeRequired')),
    })

    const getChangedValues = useCallback((initialValues: any, currentValues: any) => {
        const changedValues: any = {}
        for (const key in initialValues) {
            if (initialValues[key] !== currentValues[key]) {
                changedValues[key] = currentValues[key]
            }
        }
        return changedValues
    }, [])

    const formik = useFormik<FormValues>({
        initialValues: {
            appId: app.discordRpc.appId,
            details: app.discordRpc.details,
            state: app.discordRpc.state,
            button: app.discordRpc.button,
            statusDisplayType: String(app.discordRpc.statusDisplayType ?? ''),
        },
        validationSchema: schema,
        onSubmit: values => {
            const changedValues = getChangedValues(previousValues, values)
            if (Object.keys(changedValues).length > 0) {
                if (Object.prototype.hasOwnProperty.call(changedValues, 'statusDisplayType')) {
                    changedValues.statusDisplayType = parseInt(changedValues.statusDisplayType, 10)
                }
                window.desktopEvents?.send(MainEvents.UPDATE_RPC_SETTINGS, changedValues)
                window.desktopEvents?.send(MainEvents.GET_TRACK_INFO)
                setPreviousValues(values)
                setApp({
                    ...app,
                    discordRpc: {
                        ...app.discordRpc,
                        ...values,
                        statusDisplayType: parseInt(values.statusDisplayType, 10),
                    },
                })
            }
        },
    })

    const handleBlur = useCallback(
        (e: any) => {
            formik.handleBlur(e)
            const changedValues = getChangedValues(previousValues, formik.values)
            if (formik.isValid && Object.keys(changedValues).length > 0) {
                formik.handleSubmit()
            }
        },
        [formik, getChangedValues, previousValues],
    )

    const toggleRpcStatus = useCallback(() => {
        window.desktopEvents?.send(MainEvents.GET_TRACK_INFO)
        window.discordRpc.discordRpc(!app.discordRpc.status)
        setApp({
            ...app,
            discordRpc: {
                ...app.discordRpc,
                status: !app.discordRpc.status,
            },
        })
    }, [app, setApp])

    const containerRef = useRef<HTMLDivElement>(null)
    const fixedAddon = useMemo(() => ({ charCount: inputStyle.charCount }), [])
    useCharCount(containerRef, fixedAddon)

    const hasData = currentTrack.realId !== trackInitials.realId
    const shouldShowByStatus = currentTrack.status === 'playing' || (currentTrack.status === 'paused' && app.discordRpc.displayPause)
    const isReady = app.discordRpc.status && hasData && shouldShowByStatus

    const activityButtons = useMemo(() => buildActivityButtonsRpc(currentTrack, app), [currentTrack, app])
    return (
        <PageLayout title={t('trackInfo.pageTitle')} containerRef={containerRef}>
            <ContainerV2
                titleName={t('trackInfo.pageTitle')}
                imageName={'discord'}
                onClick={toggleRpcStatus}
                classNameButton={themeV2.buttonRpcStatus}
                buttonName={app.discordRpc.status ? t('common.disable') : t('common.enable')}
            ></ContainerV2>
            <Scrollbar className={themeV2.container} classNameInner={themeV2.containerInner}>
                <div className={themeV2.form}>
                    <div className={themeV2.discordRpcSettings}>
                        <div className={themeV2.optionalContainer}>
                            <div className={themeV2.optionalTitle}>{t('trackInfo.sections.status')}</div>
                            <TextInput
                                name="appId"
                                label={t('trackInfo.fields.appIdLabel')}
                                placeholder="1270726237605855395"
                                ariaLabel={t('trackInfo.fields.appIdLabel')}
                                value={formik.values.appId}
                                onChange={val => formik.setFieldValue('appId', val)}
                                onBlur={handleBlur}
                                error={formik.errors.appId as any}
                                touched={formik.touched.appId}
                                description={t('trackInfo.fields.appIdDescription')}
                            />
                            <TextInput
                                name="details"
                                label={t('trackInfo.fields.detailsLabel')}
                                placeholder={t('trackInfo.fields.textPlaceholder')}
                                ariaLabel={t('trackInfo.fields.detailsLabel')}
                                value={formik.values.details}
                                onChange={val => formik.setFieldValue('details', val)}
                                onBlur={handleBlur}
                                error={formik.errors.details as any}
                                touched={formik.touched.details}
                                description={t('trackInfo.fields.detailsDescription')}
                                showCommandsButton={true}
                            />
                            <TextInput
                                name="state"
                                label={t('trackInfo.fields.stateLabel')}
                                placeholder={t('trackInfo.fields.textPlaceholder')}
                                ariaLabel={t('trackInfo.fields.stateLabel')}
                                value={formik.values.state}
                                onChange={val => formik.setFieldValue('state', val)}
                                onBlur={handleBlur}
                                error={formik.errors.state as any}
                                touched={formik.touched.state}
                                description={t('trackInfo.fields.stateDescription')}
                                showCommandsButton={true}
                            />
                            <TextInput
                                name="statusDisplayType"
                                label={t('trackInfo.fields.statusDisplayTypeLabel')}
                                description={
                                    <>
                                        <img src={statusDisplayTip} alt="" srcSet="" /> {t('trackInfo.fields.statusDisplayTypeDescription')}
                                    </>
                                }
                                placeholder="0"
                                ariaLabel={t('trackInfo.fields.statusDisplayTypeAria')}
                                value={formik.values.statusDisplayType}
                                onChange={val => {
                                    formik.setFieldValue('statusDisplayType', String(val))
                                }}
                                onBlur={handleBlur}
                                error={formik.errors.statusDisplayType as any}
                                touched={formik.touched.statusDisplayType as any}
                                showCommandsButton={true}
                                commandsType="status"
                            />
                        </div>
                        <div className={themeV2.optionalContainer}>
                            <div className={themeV2.optionalTitle}>{t('trackInfo.sections.buttons')}</div>
                            <ButtonInput
                                label={t('trackInfo.buttons.enableListenLabel')}
                                checkType="enableRpcButtonListen"
                                description={t('trackInfo.buttons.enableListenDescription')}
                            />
                            <TextInput
                                name="button"
                                label={t('trackInfo.fields.listenButtonLabel')}
                                placeholder={t('trackInfo.fields.textPlaceholder')}
                                ariaLabel={t('trackInfo.fields.listenButtonLabel')}
                                value={formik.values.button}
                                onChange={val => formik.setFieldValue('button', val)}
                                onBlur={handleBlur}
                                error={formik.errors.button as any}
                                touched={formik.touched.button}
                                description={t('trackInfo.fields.listenButtonDescription')}
                            />
                            <ButtonInput
                                label={t('trackInfo.buttons.enableWebsiteLabel')}
                                checkType="enableWebsiteButton"
                                description={t('trackInfo.buttons.enableWebsiteDescription')}
                            />
                            <ButtonInput
                                label={t('trackInfo.buttons.enableDeepLinkLabel')}
                                checkType="enableDeepLink"
                                description={t('trackInfo.buttons.enableDeepLinkDescription')}
                            />
                        </div>
                        <div className={themeV2.optionalContainer}>
                            <div className={themeV2.optionalTitle}>{t('trackInfo.sections.special')}</div>
                            <ButtonInput
                                label={t('trackInfo.special.showTrackVersionLabel')}
                                checkType="showTrackVersion"
                                description={t('trackInfo.special.showTrackVersionDescription')}
                            />
                            <ButtonInput
                                label={t('trackInfo.special.showSmallIconLabel')}
                                checkType="showSmallIcon"
                                description={t('trackInfo.special.showSmallIconDescription')}
                            />
                            <ButtonInput
                                label={t('trackInfo.special.showVersionOrDeviceLabel')}
                                disabled={!app.discordRpc.showSmallIcon}
                                checkType="showVersionOrDevice"
                                description={t('trackInfo.special.showVersionOrDeviceDescription')}
                            />
                            <ButtonInput
                                label={t('trackInfo.special.showPausedLabel')}
                                checkType="displayPause"
                                description={t('trackInfo.special.showPausedDescription')}
                            />
                            <ButtonInput
                                label={t('trackInfo.special.supporterHideBrandingLabel')}
                                checkType="supporterHideBranding"
                                description={
                                    hasSupporter
                                        ? t('trackInfo.special.supporterHideBrandingDescription')
                                        : t('trackInfo.special.supporterHideBrandingLockedDescription')
                                }
                                disabled={!hasSupporter}
                            />
                        </div>
                    </div>
                </div>

                <div className={themeV2.discordRpc}>
                    <img
                        className={themeV2.userBanner}
                        src={`${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`}
                        alt={user.bannerHash}
                        onError={e => {
                            ;(e.currentTarget as HTMLImageElement).src = `${config.S3_URL}/banners/default_banner.webp`
                        }}
                    />
                    <div className={themeV2.userInfo}>
                        <img
                            className={themeV2.userAvatar}
                            src={`${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`}
                            alt={user.avatarHash}
                            onError={e => {
                                ;(e.currentTarget as HTMLImageElement).src = fallbackAvatar
                            }}
                        />
                        <div className={themeV2.userInfoContainer}>
                            <div className={themeV2.userName}>{user.username}</div>
                            <div className={themeV2.userTag}>
                                <Cubic width="72" color="#F2F3F5" />
                                <Cubic width="6" height="6" color="#F2F3F5" />
                                <Cubic width="56" color="#F2F3F5" />
                                <Cubic width="12" color="#F2F3F5" />
                                <Cubic width="12" color="#F2F3F5" />
                                <Cubic width="12" color="#F2F3F5" />
                                <Cubic width="12" color="#F2F3F5" />
                            </div>
                        </div>
                        <div className={themeV2.userInfoContainer}>
                            <div className={themeV2.userTag}>
                                <Cubic width="17" color="#FFC250" />
                                <Cubic width="20" color="#F2F3F5" />
                                <Cubic width="44" color="#F2F3F5" />
                                <Cubic width="137" color="#7FAAFF" />
                            </div>
                            <div className={themeV2.userTag}>
                                <Cubic width="17" color="#FFC250" />
                                <Cubic width="113" color="#F2F3F5" />
                                <Cubic width="12" color="#F2F3F5" />
                                <Cubic width="32" color="#F2F3F5" />
                            </div>
                            <div className={themeV2.userTag}>
                                <Cubic width="300" color="#80AAFF" />
                            </div>
                        </div>
                        <Cubic width="72" color="#8E96B3" />
                        <div className={themeV2.userRPC}>
                            <div className={themeV2.status}>{t('trackInfo.listeningStatus')}</div>

                            <div className={themeV2.statusRPC}>
                                <>
                                    {isReady ? (
                                        <div className={themeV2.flex_container}>
                                            <img
                                                className={themeV2.img}
                                                src={currentTrack.albumArt || fallbackLogo}
                                                onClick={() => {
                                                    setRickRoll(!rickRollClick)
                                                }}
                                                alt={t('trackInfo.albumCoverAlt')}
                                            />

                                            <div className={themeV2.gap}>
                                                <div className={themeV2.name}>
                                                    {app.discordRpc.details.length > 0
                                                        ? replaceParams(app.discordRpc.details, currentTrack)
                                                        : currentTrack.title}
                                                </div>

                                                <div className={themeV2.author}>
                                                    {app.discordRpc.state.length > 0
                                                        ? replaceParams(app.discordRpc.state, currentTrack)
                                                        : currentTrack.artists?.length
                                                          ? currentTrack.artists.map((x: any) => x.name).join(', ')
                                                          : null}
                                                </div>

                                                <div className={themeV2.album}>
                                                    {currentTrack.albums?.[0]?.title
                                                        ? fixStrings(currentTrack.albums?.[0]?.title)
                                                        : t('trackInfo.fallbackAlbumTitle', { version: app.info.version })}
                                                </div>

                                                <PlayerTimeline />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className={themeV2.flex_container}>
                                            <Skeleton width={64} height={64} />
                                            <div className={themeV2.gap}>
                                                <Skeleton width={70} height={19} />
                                                <Skeleton width={190} height={14} />
                                                <Skeleton width={90} height={14} />
                                                <Skeleton width={240} height={15} />
                                            </div>
                                        </div>
                                    )}
                                </>

                                <div className={themeV2.buttonRpc}>
                                    {activityButtons?.map((btn, idx) => (
                                        <div key={`${btn.label}-${idx}`} className={themeV2.button} onClick={() => window.open(btn.url)}>
                                            {btn.label}
                                        </div>
                                    ))}
                                    {rickRollClick && (
                                        <video className={themeV2.rickRoll} width="600" autoPlay loop>
                                            <source src="https://s3.pulsesync.dev/files/heheheha.mp4" type="video/mp4" />
                                        </video>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className={themeV2.userInfoContainer}>
                            <div className={themeV2.userTag}>
                                <Cubic width="143" height="20" color="#8E96B3" />
                                <Cubic width="158" height="20" color="#8E96B3" />
                            </div>
                            <div className={themeV2.userTag}>
                                <Cubic width="209" height="20" color="#8E96B3" />
                                <Cubic width="75" height="20" color="#8E96B3" />
                            </div>
                        </div>
                    </div>
                </div>
            </Scrollbar>
        </PageLayout>
    )
}
