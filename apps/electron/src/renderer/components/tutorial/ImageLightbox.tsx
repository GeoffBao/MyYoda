/**
 * 图片大图预览：缩略图负责浏览，大图负责阅读细节。
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ImageLightboxProps {
  src: string
  alt: string
  title?: string
  description?: string
  className?: string
  imageClassName?: string
}

export function ImageLightbox({
  src,
  alt,
  title,
  description,
  className,
  imageClassName,
}: ImageLightboxProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`查看大图${title ? `：${title}` : ''}`}
          className={cn('group/lightbox relative block h-full w-full cursor-zoom-in text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60', className)}
        >
          <img src={src} alt={alt} className={cn('h-full w-full object-cover', imageClassName)} />
          <span className="pointer-events-none absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/lightbox:opacity-100 group-focus-visible/lightbox:opacity-100">
            <Maximize2 className="size-3.5" />
          </span>
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={description ? undefined : 'image-lightbox-description'}
          className="fixed inset-4 z-[121] flex flex-col items-center justify-center outline-none md:inset-8"
        >
          <DialogPrimitive.Title className="sr-only">{title || alt}</DialogPrimitive.Title>
          {!description && <DialogPrimitive.Description id="image-lightbox-description" className="sr-only">大图预览</DialogPrimitive.Description>}
          <div className="relative flex min-h-0 max-w-full flex-col items-center">
            <img src={src} alt={alt} className="max-h-[82vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" />
            {(title || description) && (
              <div className="mt-3 max-w-2xl rounded-xl bg-black/45 px-4 py-2.5 text-center text-white backdrop-blur-sm">
                {title && <p className="text-sm font-medium">{title}</p>}
                {description && <p className="mt-0.5 text-xs text-white/70">{description}</p>}
              </div>
            )}
          </div>
          <DialogPrimitive.Close aria-label="关闭大图预览" className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 md:right-0 md:top-0">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
