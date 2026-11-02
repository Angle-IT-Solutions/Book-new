import { findBySlug } from '@/lib/payload'
import Image from 'next/image'
import { notFound } from 'next/navigation'

type MediaValue = {
  url?: string | null
}

export default async function SharedStoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const story = await findBySlug('stories', slug)
  if (!story) notFound()

  const image = typeof story.image === 'object' ? (story.image as MediaValue).url : null
  const audio = typeof story.audio === 'object' ? (story.audio as MediaValue).url : null

  return (
    <main className="flex min-h-dvh flex-col bg-[#fff8ee]">
      <div className="relative min-h-0 w-full flex-1">
        {image && (
          <Image src={image} alt="" fill priority sizes="100vw" className="object-contain" />
        )}
      </div>
      <article className="mx-auto w-full max-w-xl shrink-0 border-t border-black/5 bg-white/90 p-4 text-center shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm">
        <h1 className="font-comic-bold text-3xl leading-tight text-[#333]">{story.title}</h1>
        {audio && (
          <audio className="mx-auto mt-4 w-full max-w-lg" controls src={audio}>
            <track kind="captions" />
          </audio>
        )}
      </article>
    </main>
  )
}
