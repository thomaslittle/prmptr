"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
    TextB,
    TextItalic,
    TextStrikethrough,
    ListBullets,
    ListNumbers,
    Quotes,
    Code,
    LinkSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface ContextEditorProps {
    markdown: string;
    onChange: (markdown: string) => void;
}

function getMarkdown(editor: Editor): string {
    const storage = editor.storage as unknown as Record<string, { getMarkdown?: () => string } | undefined>;
    return storage.markdown?.getMarkdown?.() ?? "";
}

const btnClass = (active: boolean) =>
    cn(
        "p-1.5 transition-colors",
        active
            ? "text-foreground"
            : "text-muted-foreground/50 hover:text-foreground"
    );

export default function ContextEditor({ markdown, onChange }: ContextEditorProps) {
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            Link.configure({
                openOnClick: false,
                HTMLAttributes: { class: "text-primary underline underline-offset-2" },
            }),
            Placeholder.configure({
                placeholder: "Describe what you're working on...",
            }),
            Markdown,
        ],
        content: markdown,
        editorProps: {
            attributes: {
                class: "context-editor-content outline-none min-h-[260px] px-4 py-3 text-xs leading-relaxed text-foreground/90",
            },
        },
        onUpdate: ({ editor: e }) => {
            const md = getMarkdown(e);
            onChange(md);
        },
    });

    // Sync external markdown changes (e.g. template applied)
    useEffect(() => {
        if (!editor) return;
        const current = getMarkdown(editor);
        if (current !== markdown) {
            editor.commands.setContent(markdown);
        }
    }, [markdown, editor]);

    if (!editor) return null;

    return (
        <div className="flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center px-2 py-1 border-b border-border bg-muted/40">
                <button
                    type="button"
                    title="Bold"
                    className={btnClass(editor.isActive("bold"))}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
                >
                    <TextB weight="bold" className="size-3" />
                </button>
                <button
                    type="button"
                    title="Italic"
                    className={btnClass(editor.isActive("italic"))}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
                >
                    <TextItalic weight="bold" className="size-3" />
                </button>
                <button
                    type="button"
                    title="Strikethrough"
                    className={btnClass(editor.isActive("strike"))}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}
                >
                    <TextStrikethrough weight="bold" className="size-3" />
                </button>
                <button
                    type="button"
                    title="Code"
                    className={btnClass(editor.isActive("code"))}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}
                >
                    <Code weight="bold" className="size-3" />
                </button>

                <div className="w-px h-3 bg-border mx-1.5" />

                <button
                    type="button"
                    title="Bullet list"
                    className={btnClass(editor.isActive("bulletList"))}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}
                >
                    <ListBullets weight="bold" className="size-3" />
                </button>
                <button
                    type="button"
                    title="Numbered list"
                    className={btnClass(editor.isActive("orderedList"))}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}
                >
                    <ListNumbers weight="bold" className="size-3" />
                </button>
                <button
                    type="button"
                    title="Quote"
                    className={btnClass(editor.isActive("blockquote"))}
                    onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }}
                >
                    <Quotes weight="bold" className="size-3" />
                </button>

                <div className="w-px h-3 bg-border mx-1.5" />

                <button
                    type="button"
                    title="Link"
                    className={btnClass(editor.isActive("link"))}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        if (editor.isActive("link")) {
                            editor.chain().focus().unsetLink().run();
                        } else {
                            const url = window.prompt("URL");
                            if (url) editor.chain().focus().setLink({ href: url }).run();
                        }
                    }}
                >
                    <LinkSimple weight="bold" className="size-3" />
                </button>
            </div>

            {/* Editor */}
            <EditorContent editor={editor} />
        </div>
    );
}
