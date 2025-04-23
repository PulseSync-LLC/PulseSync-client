import Layout from '../../components/layout'
import Container from '../../components/container'

import CheckboxNav from '../../components/checkbox'

import * as styles from '../../../../static/styles/page/index.module.scss'
import * as inputStyle from './oldInput.module.scss'
import * as theme from './oldtrackinfo.module.scss'
import * as themeV2 from './trackinfo.module.scss'

import React, { useContext, useEffect, useRef, useState } from 'react'
import userContext from '../../api/context/user.context'
import trackInitials from '../../api/initials/track.initials'
import Skeleton from 'react-loading-skeleton'
import { Cubic } from '../../components/PSUI/Cubic'
import playerContext from '../../api/context/player.context'
import { object, string } from 'yup'
import { useFormik } from 'formik'
import { MdClose, MdContentCopy } from 'react-icons/md'
import toast from '../../components/toast'
import { replaceParams, truncateLabel } from '../../utils/formatRpc'
import { useCharCount } from '../../utils/useCharCount'
import config from '../../api/config'
import ContainerV2 from '../../components/containerV2'
import PlayerTimeline from '../../components/playerTimeline'
import TextInput from '../../components/PSUI/TextInput'

export default function TrackInfoPage() {
    const { user, app, setApp } = useContext(userContext)
    const { currentTrack } = useContext(playerContext)
    const [rickRollClick, setRickRoll] = useState(false)
    const [modal, setModal] = useState(false)
    const [modalAnim, setModalAnim] = useState(false)
    const [previousValues, setPreviousValues] = useState({
        appId: '',
        details: '',
        state: '',
        button: '',
    })
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
    })
    const copyValues = async (value: string) => {
        setModalAnim(false)
        setTimeout(() => setModal(false), 200)
        await navigator.clipboard.writeText(value)
        toast.custom('success', 'Крутяк', 'Скопировано в буфер обмена')
    }
    const getChangedValues = (initialValues: any, currentValues: any) => {
        const changedValues: any = {}
        for (const key in initialValues) {
            if (initialValues[key] !== currentValues[key]) {
                changedValues[key] = currentValues[key]
            }
        }
        return changedValues
    }
    useEffect(() => {
        setPreviousValues({
            ...(previousValues as any),
            appId: app.discordRpc.appId,
            details: app.discordRpc.details,
            state: app.discordRpc.state,
            button: app.discordRpc.button,
        })
    }, [])
    const formik = useFormik({
        initialValues: {
            appId: app.discordRpc.appId,
            details: app.discordRpc.details,
            state: app.discordRpc.state,
            button: app.discordRpc.button,
        },
        validationSchema: schema,
        onSubmit: values => {
            const changedValues = getChangedValues(previousValues, values)
            if (Object.keys(changedValues).length > 0) {
                window.desktopEvents?.send('update-rpcSettings', changedValues)
                window.desktopEvents?.send('GET_TRACK_INFO')
                setPreviousValues(values)
                setApp({
                    ...app,
                    discordRpc: {
                        ...app.discordRpc,
                        ...values,
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

    return (
        <Layout title="Discord RPC">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div ref={containerRef} className={styles.main_container}>
                        <ContainerV2
                            titleName={'Discord RPC'}
                            imageName={'discord'}
                            onClick={() => {
                                if (app.discordRpc.status) {
                                    window.desktopEvents?.send('GET_TRACK_INFO')
                                    window.discordRpc.discordRpc(false)
                                } else {
                                    window.desktopEvents?.send('GET_TRACK_INFO')
                                    window.discordRpc.discordRpc(true)
                                }
                                setApp({
                                    ...app,
                                    discordRpc: {
                                        ...app.discordRpc,
                                        status: !app.discordRpc.status,
                                    },
                                })
                            }}
                            buttonName={app.discordRpc.status ? 'Выключить' : 'Включить'}
                        ></ContainerV2>
                        <div className={themeV2.container}>
                            <form className={themeV2.form}>
                                <div className={theme.discordRpcSettings}>
                                    <div className={theme.optionalContainer}>
                                        <div className={theme.optionalTitle}>Статус</div>
                                        <TextInput
                                            name="appId"
                                            label="App ID"
                                            placeholder="1270726237605855395"
                                            ariaLabel="App ID"
                                            value={formik.values.appId}
                                            onChange={val => formik.setFieldValue('appId', val)}
                                            onBlur={handleBlur}
                                            error={formik.errors.appId}
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
                                            error={formik.errors.details}
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
                                            error={formik.errors.state}
                                            touched={formik.touched.state}
                                            description="Описание State"
                                            showCommandsButton={true}
                                        />

                                        <div
                                            className={theme.openModalButton}
                                            onClick={() => {
                                                setModalAnim(true)
                                                setModal(true)
                                            }}
                                        >
                                            Посмотреть все параметры полей.
                                        </div>

                                        <div className={theme.line}></div>

                                        <CheckboxNav
                                            checkType="enableRpcButtonListen"
                                            description="Активируйте этот параметр, чтобы включить отображение в активности кнопку слушать. Ограничения по русским символам 15+-, по английским 30+-"
                                        >
                                            Включить кнопку (Слушать)
                                        </CheckboxNav>

                                        <TextInput
                                            name="button"
                                            label="Слушать трек на Яндекс Музыке"
                                            placeholder="enter text"
                                            ariaLabel="Button"
                                            value={formik.values.button}
                                            onChange={val => formik.setFieldValue('button', val)}
                                            onBlur={handleBlur}
                                            error={formik.errors.button}
                                            touched={formik.touched.button}
                                            description="Текст отображаемой кнопки"
                                        />

                                        <CheckboxNav
                                            checkType="enableGithubButton"
                                            description="Если включить, то в активности появится кнопка, ведущая на гитхаб-репозиторий проекта."
                                        >
                                            Включить кнопку (PulseSync Project)
                                        </CheckboxNav>

                                        <div className={theme.line}></div>

                                        <CheckboxNav
                                            checkType="showSmallIcon"
                                            description="Если включить, то в активности будет показываться иконка с текстом который настраивается ниже."
                                        >
                                            Включить иконоку статуса прослушивания
                                        </CheckboxNav>

                                        <CheckboxNav
                                            checkType="showVersionOrDevice"
                                            disabled={!app.discordRpc.showSmallIcon}
                                            description="Если включить, то в активности при наведении на иконку будет показываться версия приложения, а не устройство, где играет трек."
                                        >
                                            Показывать версию приложения вместо устройства, где играет трек.
                                        </CheckboxNav>

                                        <CheckboxNav
                                            checkType="displayPause"
                                            description="Активируйте этот параметр, чтобы показывать трек на паузе."
                                        >
                                            Показывать трек на паузе
                                        </CheckboxNav>
                                    </div>
                                </div>
                            </form>

                            <div className={themeV2.discordRpc}>
                                <img
                                    className={themeV2.userBanner}
                                    src={`${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`}
                                    alt={user.bannerHash}
                                />
                                <div className={themeV2.userInfo}>
                                    <img
                                        className={themeV2.userAvatar}
                                        src={`${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`}
                                        alt={user.avatarHash}
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
                                                {app.discordRpc.status && currentTrack.status !== trackInitials.status ? (
                                                    <div className={themeV2.flex_container}>
                                                        <img
                                                            className={themeV2.img}
                                                            src={currentTrack.albumArt || './static/assets/logo/logoapp.png'}
                                                            alt="Обложка альбома"
                                                        />

                                                        <div className={themeV2.gap}>
                                                            <div className={themeV2.name}>
                                                                {app.discordRpc.details.length > 0
                                                                    ? replaceParams(app.discordRpc.details, currentTrack)
                                                                    : currentTrack.title}
                                                            </div>

                                                            <div className={themeV2.autor}>
                                                                {app.discordRpc.state.length > 0
                                                                    ? replaceParams(app.discordRpc.state, currentTrack)
                                                                    : currentTrack.artists?.length
                                                                      ? currentTrack.artists.map(x => x.name).join(', ')
                                                                      : null}
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
                                                            <Skeleton width={240} height={15} />
                                                        </div>
                                                    </div>
                                                )}
                                            </>

                                            <div className={themeV2.buttonRpc}>
                                                <div className={themeV2.button} onClick={() => setRickRoll(!rickRollClick)}>
                                                    {app.discordRpc.button.length > 0
                                                        ? truncateLabel(app.discordRpc.button)
                                                        : '✌️ Open in Yandex Music'}
                                                </div>

                                                {rickRollClick && (
                                                    <video className={themeV2.rickRoll} width="600" autoPlay loop>
                                                        <source src="https://s3.pulsesync.dev/files/heheheha.mp4" type="video/mp4" />
                                                    </video>
                                                )}

                                                <div
                                                    className={themeV2.button}
                                                    onClick={() => window.open('https://github.com/PulseSync-LLC/PulseSync-client/tree/dev')}
                                                >
                                                    ♡ PulseSync Project
                                                </div>
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
                            {modal && (
                                <div className={modalAnim ? theme.modalBlur : theme.modalBlurOff}>
                                    <div
                                        className={theme.modalCloseZone}
                                        onClick={() => {
                                            setModalAnim(false)
                                            setTimeout(() => setModal(false), 200)
                                        }}
                                    ></div>
                                    <div className={theme.modal}>
                                        <div className={theme.modalTitle}>
                                            <div>Параметры полей</div>
                                            <button
                                                className={theme.closeModal}
                                                onClick={() => {
                                                    setModalAnim(false)
                                                    setTimeout(() => setModal(false), 200)
                                                }}
                                            >
                                                <MdClose size={20} />
                                            </button>
                                        </div>
                                        <div className={theme.modalContainer}>
                                            <button className={theme.modalContextButton}>
                                                <div className={theme.contextInfo}>
                                                    <div className={theme.contextPreview}>track</div>- название трека
                                                </div>
                                                <MdContentCopy cursor={'pointer'} size={18} onClick={() => copyValues('{track}')} />
                                            </button>
                                            <button className={theme.modalContextButton}>
                                                <div className={theme.contextInfo}>
                                                    <div className={theme.contextPreview}>artist</div>- имя артиста
                                                </div>
                                                <MdContentCopy cursor={'pointer'} size={18} onClick={() => copyValues('{artist}')} />
                                            </button>
                                            <button className={theme.modalContextButton}>
                                                <div className={theme.contextInfo}>
                                                    <div className={theme.contextPreview}>album</div>- название альбома
                                                </div>
                                                <MdContentCopy cursor={'pointer'} size={18} onClick={() => copyValues('{album}')} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
