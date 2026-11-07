import { safeHref } from '../utils/safeHref';

interface ExternalLinkProps {
  url: string | null | undefined;
  /** The text shown; the address itself by default. */
  label?: string;
  className?: string;
}

/** A stored web address: a link in a new tab when it's http(s), plain text otherwise. */
export default function ExternalLink({ url, label, className = 'text-sky-700 hover:underline' }: ExternalLinkProps) {
  const href = safeHref(url);
  const text = label ?? url ?? '';
  if (!href) return <span>{text}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{text}</a>;
}
