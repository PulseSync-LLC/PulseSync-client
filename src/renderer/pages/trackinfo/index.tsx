import Layout from '../../components/layout'
import Container from '../../components/container'

import CheckboxNav from '../../components/checkbox'

import * as styles from '../../../../static/styles/page/index.module.scss'
import * as inputStyle from './oldInput.module.scss'
import * as theme from './trackinfo.module.scss'

import React, { useContext, useEffect, useRef, useState } from 'react'
import userContext from '../../api/context/user.context'
import trackInitials from '../../api/initials/track.initials'
import Skeleton from 'react-loading-skeleton'
import playerContext from '../../api/context/player.context'
import { object, string } from 'yup'
import { useFormik } from 'formik'
import { MdClose, MdContentCopy } from 'react-icons/md'
import toast from '../../components/toast'
import { replaceParams, truncateLabel } from '../../utils/formatRpc'
import { useCharCount } from '../../utils/useCharCount'
import config from '../../api/config'

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
                        <Container
                            titleName={'Discord RPC'}
                            description={`Активируйте этот параметр, чтобы ваш текущий статус отображался в Discord`}
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
                        ></Container>
                        <div className={styles.container30x15}>
                            <div className={theme.container}>
                                <form>
                                    <div className={theme.discordRpcSettings}>
                                        <div className={theme.optionalContainer}>
                                            <div className={theme.optionalTitle}>Настроить статус</div>
                                            <div className={inputStyle.textInputContainer}>
                                                <div>App ID</div>
                                                <input
                                                    type="text"
                                                    name="appId"
                                                    aria-errormessage={(formik.errors as any)['appId']}
                                                    placeholder="1270726237605855395"
                                                    className={inputStyle.styledInput}
                                                    value={formik.values.appId}
                                                    onChange={formik.handleChange}
                                                    onBlur={e => {
                                                        handleBlur(e)
                                                    }}
                                                />
                                                {formik.touched.appId && formik.errors.appId ? (
                                                    <div className={inputStyle.error}>{formik.errors.appId}</div>
                                                ) : null}
                                            </div>
                                            <div className={inputStyle.textInputContainer}>
                                                <div>Details</div>
                                                <input
                                                    type="text"
                                                    name="details"
                                                    placeholder="enter text"
                                                    className={inputStyle.styledInput}
                                                    value={formik.values.details}
                                                    onChange={formik.handleChange}
                                                    onBlur={e => {
                                                        handleBlur(e)
                                                    }}
                                                />
                                                {formik.touched.details && formik.errors.details ? (
                                                    <div className={inputStyle.error}>{formik.errors.details}</div>
                                                ) : null}
                                            </div>
                                            <div className={inputStyle.textInputContainer}>
                                                <div>State</div>
                                                <input
                                                    type="text"
                                                    name="state"
                                                    placeholder="enter text"
                                                    className={inputStyle.styledInput}
                                                    value={formik.values.state}
                                                    onChange={formik.handleChange}
                                                    onBlur={e => {
                                                        handleBlur(e)
                                                    }}
                                                />
                                                {formik.touched.state && formik.errors.state ? (
                                                    <div className={inputStyle.error}>{formik.errors.state}</div>
                                                ) : null}
                                            </div>
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
                                            <div className={inputStyle.textInputContainer}>
                                                <div>Button</div>
                                                <input
                                                    type="text"
                                                    name="button"
                                                    placeholder="enter text"
                                                    className={inputStyle.styledInput}
                                                    value={formik.values.button}
                                                    onChange={formik.handleChange}
                                                    onBlur={e => {
                                                        handleBlur(e)
                                                    }}
                                                />
                                                {formik.touched.button && formik.errors.button ? (
                                                    <div className={inputStyle.error}>{formik.errors.button}</div>
                                                ) : null}
                                            </div>
                                            <CheckboxNav
                                                checkType="enableWebsiteButton"
                                                description="Если включить, то в активности появится кнопка, ведущая на сайт проекта."
                                            >
                                                Включить кнопку (PulseSync Project)
                                            </CheckboxNav>
                                            <div className={theme.line}></div>
                                            <CheckboxNav
                                                checkType="showTrackVersion"
                                                description="Если включить, то в активности будет к названию трека будет добавлятся его версия"
                                            >
                                                Включить показ версии трека
                                            </CheckboxNav>
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
                                <div className={theme.discordRpc}>
                                    <img
                                        className={theme.userBanner}
                                        src={`${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`}
                                        alt={user.bannerHash}
                                    />
                                    <div>
                                        <img
                                            className={theme.userAvatar}
                                            src={`${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`}
                                            alt={user.avatarHash}
                                        />
                                        <div className={theme.userName}>{user.username}</div>
                                        <div className={theme.userRPC}>
                                            <div className={theme.status}>Слушает</div>
                                            <div className={theme.statusRPC}>
                                                <div>
                                                    {app.discordRpc.status && currentTrack !== trackInitials ? (
                                                        <div className={theme.flex_container}>
                                                            <img
                                                                className={theme.img}
                                                                src={
                                                                    currentTrack.albumArt ? currentTrack.albumArt : './static/assets/logo/logoapp.png'
                                                                }
                                                                alt=""
                                                            />
                                                            <div className={theme.gap}>
                                                                <div className={theme.appName}>PulseSync</div>
                                                                <div className={theme.name}>
                                                                    {app.discordRpc.details.length > 0
                                                                        ? replaceParams(app.discordRpc.details, currentTrack)
                                                                        : currentTrack.title}
                                                                </div>
                                                                <div className={theme.name}>
                                                                    {app.discordRpc.state.length > 0
                                                                        ? replaceParams(app.discordRpc.state, currentTrack)
                                                                        : currentTrack.artists && currentTrack.artists.length > 0
                                                                          ? currentTrack.artists.map(x => x.name).join(', ')
                                                                          : null}
                                                                </div>
                                                                {/*{currentTrack*/}
                                                                {/*    .timestamps*/}
                                                                {/*    .length >*/}
                                                                {/*    0 && (*/}
                                                                {/*    <div*/}
                                                                {/*        className={*/}
                                                                {/*            theme.time*/}
                                                                {/*        }*/}
                                                                {/*    >*/}
                                                                {/*        {app*/}
                                                                {/*            .discordRpc*/}
                                                                {/*            .state*/}
                                                                {/*            .length >*/}
                                                                {/*        0*/}
                                                                {/*            ? replaceParams(*/}
                                                                {/*                  app*/}
                                                                {/*                      .discordRpc*/}
                                                                {/*                      .state,*/}
                                                                {/*                  currentTrack,*/}
                                                                {/*              )*/}
                                                                {/*            : `${currentTrack.timestamps[0]} - ${currentTrack.timestamps[1]}`}*/}
                                                                {/*    </div>*/}
                                                                {/*)}*/}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className={theme.flex_container}>
                                                            <Skeleton width={58} height={58} />
                                                            <div className={theme.gap}>
                                                                <Skeleton width={70} height={19} />
                                                                <Skeleton width={190} height={16} />
                                                                <Skeleton width={80} height={16} />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className={theme.buttonRpc}>
                                                    <div
                                                        className={theme.button}
                                                        onClick={() => {
                                                            setRickRoll(!rickRollClick)
                                                        }}
                                                    >
                                                        {app.discordRpc.button.length > 0
                                                            ? truncateLabel(app.discordRpc.button)
                                                            : '✌️ Open in Yandex Music'}
                                                    </div>
                                                    {rickRollClick && (
                                                        <video width="600" autoPlay loop>
                                                            <source src="https://s3.pulsesync.dev/files/heheheha.mp4" type="video/mp4" />
                                                        </video>
                                                    )}
                                                    <div
                                                        className={theme.button}
                                                        onClick={() => {
                                                            window.open('https://pulsesync.dev')
                                                        }}
                                                    >
                                                        ♡ PulseSync Project
                                                    </div>
                                                </div>
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
            </div>
        </Layout>
    )
}
