import type { ReactNode } from 'react'

export default function TopBar({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <header className="top-bar">
      <div className="t">{title}</div>
      {right}
    </header>
  )
}
