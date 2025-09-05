import Layout from '../../components/layout'
import MainEvents from '../../../common/types/mainEvents'

import * as styles from '../../../../static/styles/page/index.module.scss'
import * as inputStyle from './oldInput.module.scss'
import * as themeV2 from './trackinfo.module.scss'

import { useContext, useRef, useState, useMemo } from 'react'
import userContext from '../../api/context/user.context'
import trackInitials from '../../api/initials/track.initials'
import Skeleton from 'react-loading-skeleton'
import { Cubic } from '../../components/PSUI/Cubic'
import playerContext from '../../api/context/player.context'
import { object, string } from 'yup'
import { useFormik } from 'formik'
import { buildActivityButtons as buildActivityButtonsRpc, fixStrings, replaceParams } from '../../utils/formatRpc'
import { useCharCount } from '../../utils/useCharCount'
import config from '../../api/config'
import ContainerV2 from '../../components/containerV2'
import PlayerTimeline from '../../components/PSUI/PlayerTimeline'
import TextInput from '../../components/PSUI/TextInput'
import ButtonInput from '../../components/PSUI/ButtonInput'
import Scrollbar from '../../components/PSUI/Scrollbar'

import statusDisplayTip from './../../../../static/assets/tips/statusDisplayType.gif'

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
    const [rickRollClick, setRickRoll] = useState(false)

    const [previousValues, setPreviousValues] = useState<FormValues>(() => ({
        appId: app.discordRpc.appId || '',
        details: app.discordRpc.details || '',
        state: app.discordRpc.state || '',
        button: app.discordRpc.button || '',
        statusDisplayType: String(app.discordRpc.statusDisplayType ?? ''),
    }))

    const schema = object().shape({
        appId: string()
            .nullable()
            .notRequired()
            .test('len', 'Минимальная длина 18 символов', val => !val || val.length >= 18)
            .test('len', 'Максимальная длина 20 символов', val => !val || val.length <= 20),
        details: string()
            .test('len', 'Минимальная длина 2 символа', val => !val || val.length >= 2)
            .test('len', 'Максимальная длина 128 символов', val => !val || val.length <= 128),
        state: string()
            .test('len', 'Минимальная длина 2 символа', val => !val || val.length >= 2)
            .test('len', 'Максимальная длина 128 символов', val => !val || val.length <= 128),
        button: string().test('len', 'Максимальная длина 30 символов', val => !val || val.length <= 30),
        statusDisplayType: string()
            .matches(/^[012]$/, 'Введите 0 (Name), 1 (State) или 2 (Details)')
            .required('Введите 0, 1 или 2'),
    })

    const getChangedValues = (initialValues: any, currentValues: any) => {
        const changedValues: any = {}
        for (const key in initialValues) {
            if (initialValues[key] !== currentValues[key]) {
                changedValues[key] = currentValues[key]
            }
        }
        return changedValues
    }

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

    const handleBlur = (e: any) => {
        formik.handleBlur(e)
        const changedValues = getChangedValues(previousValues, formik.values)
        if (formik.isValid && Object.keys(changedValues).length > 0) {
            formik.handleSubmit()
        }
    }

    const containerRef = useRef<HTMLDivElement>(null)
    const fixedAddon = { charCount: inputStyle.charCount }
    useCharCount(containerRef, fixedAddon)

    const hasData = currentTrack.realId !== trackInitials.realId
    const shouldShowByStatus = currentTrack.status === 'playing' || (currentTrack.status === 'paused' && app.discordRpc.displayPause)
    const isReady = app.discordRpc.status && hasData && shouldShowByStatus

    const activityButtons = useMemo(() => buildActivityButtonsRpc(currentTrack, app), [currentTrack, app])

    return (
        <Layout title="Discord RPC">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div ref={containerRef} className={styles.main_container}>
                        <ContainerV2
                            titleName={'Discord RPC'}
                            imageName={'discord'}
                            onClick={() => {
                                window.desktopEvents?.send(MainEvents.GET_TRACK_INFO)
                                window.discordRpc.discordRpc(!app.discordRpc.status)
                                setApp({
                                    ...app,
                                    discordRpc: {
                                        ...app.discordRpc,
                                        status: !app.discordRpc.status,
                                    },
                                })
                            }}
                            classNameButton={themeV2.buttonRpcStatus}
                            buttonName={app.discordRpc.status ? 'Выключить' : 'Включить'}
                        ></ContainerV2>
                        <Scrollbar className={themeV2.container} classNameInner={themeV2.containerInner}>
                            <div className={themeV2.form}>
                                <div className={themeV2.discordRpcSettings}>
                                    <div className={themeV2.optionalContainer}>
                                        <div className={themeV2.optionalTitle}>Статус</div>
                                        <TextInput
                                            name="appId"
                                            label="App ID"
                                            placeholder="1270726237605855395"
                                            ariaLabel="App ID"
                                            value={formik.values.appId}
                                            onChange={val => formik.setFieldValue('appId', val)}
                                            onBlur={handleBlur}
                                            error={formik.errors.appId as any}
                                            touched={formik.touched.appId}
                                            description="Идентификатор приложения в Discord Developer Portal, необходимый для отображения Rich Presence."
                                        />
                                        <TextInput
                                            name="details"
                                            label="Details"
                                            placeholder="enter text"
                                            ariaLabel="Details"
                                            value={formik.values.details}
                                            onChange={val => formik.setFieldValue('details', val)}
                                            onBlur={handleBlur}
                                            error={formik.errors.details as any}
                                            touched={formik.touched.details}
                                            description="Описание Details"
                                            showCommandsButton={true}
                                        />
                                        <TextInput
                                            name="state"
                                            label="State"
                                            placeholder="enter text"
                                            ariaLabel="State"
                                            value={formik.values.state}
                                            onChange={val => formik.setFieldValue('state', val)}
                                            onBlur={handleBlur}
                                            error={formik.errors.state as any}
                                            touched={formik.touched.state}
                                            description="Описание State"
                                            showCommandsButton={true}
                                        />
                                        <TextInput
                                            name="statusDisplayType"
                                            label="Поменять тип отображения статуса активности"
                                            description={
                                                <>
                                                    <img src={statusDisplayTip} alt="" srcSet="" /> В статусе меняет, как будет отображаться
                                                    активность после «Слушать»
                                                </>
                                            }
                                            placeholder="0"
                                            ariaLabel="DisplayType"
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
                                        <div className={themeV2.optionalTitle}>Кнопки</div>
                                        <ButtonInput
                                            label="Включить кнопку (Слушать)"
                                            checkType="enableRpcButtonListen"
                                            description="Показывает кнопку «Слушать» в статусе."
                                        />
                                        <TextInput
                                            name="button"
                                            label="Слушать трек на Яндекс Музыке"
                                            placeholder="enter text"
                                            ariaLabel="Button"
                                            value={formik.values.button}
                                            onChange={val => formik.setFieldValue('button', val)}
                                            onBlur={handleBlur}
                                            error={formik.errors.button as any}
                                            touched={formik.touched.button}
                                            description="Текст отображаемой кнопки"
                                        />
                                        <ButtonInput
                                            label="Включить кнопку (PulseSync Project)"
                                            checkType="enableWebsiteButton"
                                            description="Добавляет кнопку на сайт проекта."
                                        />
                                        <ButtonInput
                                            label="Включить DeepLink"
                                            checkType="enableDeepLink"
                                            description="Добавляет кнопки «Открыть в вебе/приложении Яндекс Музыки»."
                                        />
                                    </div>
                                    <div className={themeV2.optionalContainer}>
                                        <div className={themeV2.optionalTitle}>Особое</div>
                                        <ButtonInput
                                            label="Включить показ версии трека"
                                            checkType="showTrackVersion"
                                            description="Добавляет версию трека к названию."
                                        />
                                        <ButtonInput
                                            label="Включить иконоку статуса прослушивания"
                                            checkType="showSmallIcon"
                                            description="Показывает маленькую иконку со статусом прослушивания."
                                        />
                                        <ButtonInput
                                            label="Показывать версию приложения вместо устройства, где играет трек."
                                            disabled={!app.discordRpc.showSmallIcon}
                                            checkType="showVersionOrDevice"
                                            description="В подсказке к иконке показывает версию приложения вместо устройства."
                                        />
                                        <ButtonInput
                                            label="Показывать трек на паузе"
                                            checkType="displayPause"
                                            description="Показывает трек в статусе, даже когда он на паузе."
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
                                            ;(e.currentTarget as HTMLImageElement).src = './static/assets/images/undef.png'
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
                                        <div className={themeV2.status}>Слушает PulseSync</div>

                                        <div className={themeV2.statusRPC}>
                                            <>
                                                {isReady ? (
                                                    <div className={themeV2.flex_container}>
                                                        <img
                                                            className={themeV2.img}
                                                            src={currentTrack.albumArt || './static/assets/logo/logoapp.png'}
                                                            onClick={() => {
                                                                setRickRoll(!rickRollClick)
                                                            }}
                                                            alt="Обложка альбома"
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
                                                                    : `PulseSync ${app.info.version}`}
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
                    </div>
                </div>
            </div>
        </Layout>
    )
}
