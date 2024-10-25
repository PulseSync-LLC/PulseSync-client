import Header from '../../components/layout/header'
import { useContext, useEffect, useMemo, useState } from 'react'
import MarkDown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate } from 'react-router-dom'

import * as styles from './auth.module.scss'

import CheckboxNav from '../../components/checkbox'

import { MdAdminPanelSettings } from 'react-icons/md'
import userContext from '../../api/context/user.context'
import config from '../../api/config'

const LinkRenderer = (props: any) => {
    return (
        <a href={props.href} target="_blank" rel="noopener noreferrer">
            {props.children}
        </a>
    )
}

export default function AuthPage() {
    const navigate = useNavigate()
    const [mdText, setMdText] = useState(null)
    const { user, app } = useContext(userContext)
    const auth = () => {
        window.open(config.SERVER_URL + '/auth/discord')
        navigate('/auth/callback', {
            replace: true,
        })
    }
    useEffect(() => {
        if (mdText === null) {
            fetch('./static/assets/policy/terms.ru.md')
                .then(response => response.text())
                .then(text => {
                    setMdText(text)
                })
        }
    }, [])
    useEffect(() => {
        if (user.id !== '-1') {
            navigate('/trackinfo', {
                replace: true,
            })
        }
    }, [user.id])
    const memoizedMdText = useMemo(() => mdText, [mdText])
    return (
        <>
            <Header />
            <div className={styles.main_window}>
                <div className={styles.container}>
                    <div className={styles.policy}>
                        <MarkDown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                a: LinkRenderer,
                            }}
                        >
                            {memoizedMdText}
                        </MarkDown>
                        <CheckboxNav checkType="readPolicy">
                            Я соглашаюсь со всеми выше перечисленными условиями.
                        </CheckboxNav>
                    </div>
                    <button
                        className={styles.discordAuth}
                        disabled={!app.settings.readPolicy}
                        onClick={() => auth()}
                    >
                        <MdAdminPanelSettings size={20} />
                        Авторизация через дискорд
                    </button>
                </div>
            </div>
        </>
    )
}
