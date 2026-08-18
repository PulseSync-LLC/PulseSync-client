import React from 'react'

import cn from 'clsx'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import * as st from '@shared/ui/PSUI/MarkdownContent/MarkdownContent.module.scss'

import type { Components } from 'react-markdown'

type MarkdownContentProps = {
    children: string
    className?: string
    components?: Components
    allowHtml?: boolean
}

const slug = (value: string) =>
    value
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\wа-яё0-9-]/gi, '')

const Heading =
    (level: number) =>
    ({ children, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) => {
        const id = slug(React.Children.toArray(children).join(''))
        const Tag = `h${level}` as React.ElementType
        return (
            <Tag id={id} {...rest}>
                {children}
            </Tag>
        )
    }

const headingComponents: Components = {
    h1: Heading(1),
    h2: Heading(2),
    h3: Heading(3),
    h4: Heading(4),
    h5: Heading(5),
    h6: Heading(6),
}

export default function MarkdownContent({ children, className, components, allowHtml = true }: MarkdownContentProps) {
    return (
        <div className={cn(st.markdown, className)}>
            <ReactMarkdown
                skipHtml={!allowHtml}
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={allowHtml ? [rehypeRaw] : []}
                components={{ ...headingComponents, ...components }}
            >
                {children}
            </ReactMarkdown>
        </div>
    )
}
