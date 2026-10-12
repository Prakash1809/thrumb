/**
 * Hand-rolled icon set. A dozen 16px glyphs is less weight than an icon
 * package, and keeps the bundle free of a dependency we would use 2% of.
 */
type IconProps = { className?: string };

const base = "size-4 shrink-0";

export const HashIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M6.3 1.6 5.7 5H2.8l-.3 1.6h2.9l-.5 2.8H2l-.3 1.6h2.9l-.6 3.4h1.6l.6-3.4h2.6l-.6 3.4h1.6l.6-3.4h2.9l.3-1.6h-2.9l.5-2.8h2.9l.3-1.6h-2.9l.6-3.4H11l-.6 3.4H7.8l.6-3.4zm1.2 5h2.6l-.5 2.8H7z" />
  </svg>
);

export const LockIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 3.5a2 2 0 1 1 4 0V6H6z" />
  </svg>
);

export const SearchIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M6.75 1.5a5.25 5.25 0 1 0 3.2 9.41l3.07 3.07a.75.75 0 1 0 1.06-1.06l-3.07-3.07A5.25 5.25 0 0 0 6.75 1.5zm0 1.5a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5z" />
  </svg>
);

export const PlusIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M8 2.5a.75.75 0 0 1 .75.75v4h4a.75.75 0 0 1 0 1.5h-4v4a.75.75 0 0 1-1.5 0v-4h-4a.75.75 0 0 1 0-1.5h4v-4A.75.75 0 0 1 8 2.5z" />
  </svg>
);

export const CloseIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M4.3 3.2 3.2 4.3 6.9 8l-3.7 3.7 1.1 1.1L8 9.1l3.7 3.7 1.1-1.1L9.1 8l3.7-3.7-1.1-1.1L8 6.9z" />
  </svg>
);

export const SendIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M1.7 1.6a.75.75 0 0 0-1 .93l1.9 5.1a.75.75 0 0 0 .6.48l6 .74a.15.15 0 0 1 0 .3l-6 .74a.75.75 0 0 0-.6.48l-1.9 5.1a.75.75 0 0 0 1 .93l13-6.5a.75.75 0 0 0 0-1.34z" />
  </svg>
);

export const ThreadIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H7.6l-3 2.8A.75.75 0 0 1 3.4 13.3V11h-.1A1.3 1.3 0 0 1 2 9.7zm1.5 0v6h.6a.9.9 0 0 1 .9.9v1l1.9-1.7a.75.75 0 0 1 .5-.2h5.1v-6z" />
  </svg>
);

export const EmojiIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM5.75 6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm4.5 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zM4.9 9.7a.75.75 0 0 0-.3 1.03A4 4 0 0 0 8 12.5a4 4 0 0 0 3.4-1.77.75.75 0 1 0-1.26-.8A2.5 2.5 0 0 1 8 11a2.5 2.5 0 0 1-2.1-1.07.75.75 0 0 0-1-.23z" />
  </svg>
);

export const PaperclipIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M10.6 2.3a3 3 0 0 1 4.25 4.24l-6.3 6.3a4.5 4.5 0 0 1-6.37-6.36l5.6-5.6 1.07 1.07-5.6 5.6a3 3 0 0 0 4.24 4.24l6.3-6.3a1.5 1.5 0 0 0-2.12-2.12L6.1 8.96a.75.75 0 0 0 1.06 1.06l4.6-4.6 1.06 1.07-4.6 4.6a2.25 2.25 0 0 1-3.18-3.19z" />
  </svg>
);

export const PencilIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M11.4 1.6a1.5 1.5 0 0 1 2.12 0l.88.88a1.5 1.5 0 0 1 0 2.12l-8 8a1.5 1.5 0 0 1-.72.4l-3.1.74a.75.75 0 0 1-.9-.9l.74-3.1a1.5 1.5 0 0 1 .4-.72zm1.06 1.06L11.6 3.5 12.5 4.4l.86-.86zM10.5 4.6 4 11.1l-.4 1.7 1.7-.4 6.5-6.5z" />
  </svg>
);

export const TrashIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M6.5 1a1.5 1.5 0 0 0-1.5 1.5V3H2.75a.75.75 0 0 0 0 1.5h.4l.6 8.1A1.5 1.5 0 0 0 5.25 14h5.5a1.5 1.5 0 0 0 1.5-1.4l.6-8.1h.4a.75.75 0 0 0 0-1.5H11v-.5A1.5 1.5 0 0 0 9.5 1zm0 1.5h3V3h-3zM4.66 4.5h6.68l-.59 8h-5.5z" />
  </svg>
);

export const ChevronIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M5.3 3.3 4.2 4.4 7.9 8l-3.7 3.6 1.1 1.1L10.1 8z" />
  </svg>
);

export const MoreIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M4 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm5.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM15 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
  </svg>
);

export const DownIcon = ({ className = "" }: IconProps) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`${base} ${className}`} fill="currentColor">
    <path d="M8 11.3 2.9 6.2 4 5.1l4 4 4-4 1.1 1.1z" />
  </svg>
);
