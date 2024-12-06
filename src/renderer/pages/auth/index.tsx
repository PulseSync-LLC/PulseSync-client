import { useContext, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import MarkDown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import OldHeader from '../../components/layout/old_header'
import CheckboxNav from '../../components/checkbox'

import { MdAdminPanelSettings } from 'react-icons/md'
import userContext from '../../api/context/user.context'
import config from '../../api/config'

import * as pageStyles from './auth.module.scss'

function LinkRenderer(props: any) {
    return (
        <a href={props.href} target="_blank" rel="noopener noreferrer">
            {props.children}
        </a>
    )
}

export default function AuthPage() {
    const navigate = useNavigate()
    const [markdownContent, setMarkdownContent] = useState<string | null>(null)
    const { user, app } = useContext(userContext)

    const startAuthProcess = () => {
        window.open(config.SERVER_URL + '/auth/discord')
        navigate('/auth/callback', { replace: true })
    }

    useEffect(() => {
        if (markdownContent === null) {
            fetch('./static/assets/policy/terms.ru.md')
                .then(response => response.text())
                .then(text => {
                    setMarkdownContent(text)
                })
        }
    }, [markdownContent])

    useEffect(() => {
        if (user.id !== '-1') {
            navigate('/trackinfo', { replace: true })
        }
    }, [user.id, navigate])

    const memoizedMarkdown = useMemo(() => markdownContent, [markdownContent])

    return (
        <>
            <OldHeader />
            <div className={pageStyles.main_window}>
                <div className={pageStyles.container}>
                    <div className={pageStyles.policy}>
                        <MarkDown
                            remarkPlugins={[remarkGfm]}
                            components={{ a: LinkRenderer }}
                        >
                            {memoizedMarkdown || ''}
                        </MarkDown>
                        <CheckboxNav checkType="readPolicy">
                            Я соглашаюсь со всеми выше перечисленными условиями.
                        </CheckboxNav>
                    </div>
                    <button
                        className={pageStyles.discordAuth}
                        disabled={!app.settings.readPolicy}
                        onClick={startAuthProcess}
                    >
                        <MdAdminPanelSettings size={20} />
                        Авторизация через дискорд
                    </button>
                </div>
            </div>
        </>
    )
}
