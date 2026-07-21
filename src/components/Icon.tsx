interface Props {
  name: string
  size?: number
  /** true/false로 채움 지정, 생략 시 CSS에 위임 (탭바 active 등) */
  fill?: boolean
  color?: string
  className?: string
}

export default function Icon({ name, size = 20, fill, color, className }: Props) {
  const style: React.CSSProperties = { fontSize: size, color }
  if (fill !== undefined) style.fontVariationSettings = `'FILL' ${fill ? 1 : 0}`
  return (
    <span className={`msym${className ? ' ' + className : ''}`} style={style}>
      {name}
    </span>
  )
}
