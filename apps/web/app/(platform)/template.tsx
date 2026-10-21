/** Re-mounted on every navigation; the CSS rise-in on .page-motion makes page changes read as one continuous surface. */
export default function PlatformTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-motion">{children}</div>;
}
