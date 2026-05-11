import type { ButtonHTMLAttributes, RefObject } from 'react'
import { Maximize2 } from 'lucide-react'

type GraphFullscreenButtonProps<TElement extends HTMLElement> = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'onClick' | 'type'
> & {
  iconSize?: number
  targetRef: RefObject<TElement | null>
}

export default function GraphFullscreenButton<TElement extends HTMLElement>({
  iconSize = 16,
  targetRef,
  'aria-label': ariaLabel = '切换图谱全屏',
  ...buttonProps
}: GraphFullscreenButtonProps<TElement>) {
  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await targetRef.current?.requestFullscreen()
  }

  return (
    <button {...buttonProps} type="button" aria-label={ariaLabel} onClick={toggleFullscreen}>
      <Maximize2 size={iconSize} />
    </button>
  )
}
