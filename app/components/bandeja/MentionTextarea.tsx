"use client";

import { useMemo, useRef, useState } from "react";
import { displayName, type Profile } from "@/lib/bandeja-utils";

type MentionTextareaProps = {
  value: string;
  onChange: (v: string) => void;
  users: Profile[];
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
};

export default function MentionTextarea({
  value,
  onChange,
  users,
  className,
  placeholder,
  disabled,
  rows = 6,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return users
      .filter((u) => {
        const name = displayName(u).toLowerCase();
        const email = (u.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 8);
  }, [mentionQuery, users]);

  function insertMention(user: Profile) {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart;
    const before = value.slice(0, pos);
    const atIdx = before.lastIndexOf("@");
    const prefix = atIdx >= 0 ? value.slice(0, atIdx) : value;
    const suffix = value.slice(pos);
    const token = `@[${user.id}] `;
    const next = `${prefix}${token}${suffix}`;
    onChange(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const p = prefix.length + token.length;
      el.focus();
      el.setSelectionRange(p, p);
    });
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    onChange(v);
    const pos = e.target.selectionStart;
    const before = v.slice(0, pos);
    const match = before.match(/@([^\s@[\]]*)$/);
    if (match) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(null);
    }
  }

  return (
    <div className="mention-textarea-wrap">
      <textarea
        ref={ref}
        className={className}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
      />
      {mentionQuery !== null && suggestions.length > 0 && (
        <ul className="mention-suggestions" role="listbox">
          {suggestions.map((u) => (
            <li key={u.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(u)}>
                {displayName(u)}
                {u.email ? <span className="mention-suggestions-email">{u.email}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
