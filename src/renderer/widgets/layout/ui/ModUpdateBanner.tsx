import React from 'react'
import { MdKeyboardArrowRight, MdOutlineWarningAmber, MdUpdate } from 'react-icons/md'

import type SettingsInterface from '@entities/settings/model/settings.interface'
import type { ModInterface } from '@entities/mod/model/modInterface'
import * as pageStyles from '@widgets/layout/layout.module.scss'

const modInstallProxyDomains = ['pulsesync.dev', 'ru-node-1.pulsesync.dev', 'worker.pulsesync.dev', 's3.pulsesync.dev']

type Props = {
    app: SettingsInterface
    isModUpdateAvailable: boolean
    modInstallError: {
        details: string
        showProxyHint: boolean
        title: string
    } | null
    modInfo: ModInterface[]
    onStartUpdate: () => void
    t: (key: string, options?: Record<string, any>) => string
}

export default function ModUpdateBanner({
    app,
    isModUpdateAvailable,
    modInstallError,
    modInfo,
    onStartUpdate,
    t,
}: Props) {
    if (!isModUpdateAvailable) return null

    return (
        <div className={pageStyles.alert_patch}>
            <div className={pageStyles.patch_container}>
                <div className={pageStyles.patch_detail}>
                    <div className={pageStyles.patch_main_row}>
                        <div className={pageStyles.alert_info}>
                            <div className={pageStyles.alert_title}>
                                {app.mod.installed && app.mod.version ? t('layout.modUpdateTitle') : t('layout.modInstallTitle')}
                            </div>
                            <div className={pageStyles.alert_warn}>{t('layout.modInstallDescription')}</div>
                            <div className={pageStyles.alert_version_update}>
                                <div className={pageStyles.version_old}>
                                    {app.mod.version && app.mod.installed ? app.mod.version : t('layout.modNotInstalled')}
                                </div>
                                <MdKeyboardArrowRight size={14} />
                                <div className={pageStyles.version_new}>{modInfo[0]?.modVersion}</div>
                            </div>
                        </div>
                        <div className={pageStyles.button_container}>
                            <button className={pageStyles.patch_button} onClick={onStartUpdate}>
                                <MdUpdate size={20} />
                                {app.mod.installed && app.mod.version ? t('layout.updateAction') : t('layout.installAction')}
                            </button>
                        </div>
                    </div>
                    {modInstallError && (
                        <div className={pageStyles.patch_error_box}>
                            <div className={pageStyles.patch_error_title_row}>
                                <MdOutlineWarningAmber size={16} />
                                <div className={pageStyles.patch_error_title}>{modInstallError.title}</div>
                            </div>
                            <div className={pageStyles.patch_error_message}>{modInstallError.details}</div>
                            {modInstallError?.showProxyHint && (
                                <div className={pageStyles.patch_error_message}>
                                    <div>{t('layout.modInstallErrorProxyHint')}</div>
                                    {modInstallProxyDomains.map((domain) => (
                                        <div key={domain}>{domain}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
