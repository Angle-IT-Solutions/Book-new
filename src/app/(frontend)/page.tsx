'use client'

import { useEffect, useRef, useState } from 'react'
import { createStory, issueMediaCapability } from './actions'

type Story = {
  title: string
  image: string
  audio: string
}

type OwnedUpload = {
  id: number
  filename: string
  mimeType: string
  url?: string
  capability: string
}

type SavedStory = {
  title: string
  url?: string
  files: OwnedUpload[]
}

const savedStoriesKey = 'divya-jain:saved-stories'

export default function HomePage() {
  const [story, setStory] = useState<Story>({
    title: 'One, Two, Buckle My Shoe',
    image: '',
    audio: '',
  })
  const [view, setView] = useState<'create' | 'read' | 'stories'>('create')
  const imageUrl = useRef('')
  const audioUrl = useRef('')
  const imageFile = useRef<File | null>(null)
  const audioFile = useRef<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedStories, setSavedStories] = useState<SavedStory[]>([])
  const [deleteError, setDeleteError] = useState('')
  const [deletingUploadId, setDeletingUploadId] = useState<number | null>(null)

  useEffect(
    () => () => {
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
    },
    [],
  )

  useEffect(() => {
    try {
      const saved = localStorage.getItem(savedStoriesKey)
      const parsed: unknown = saved ? JSON.parse(saved) : []
      if (Array.isArray(parsed)) setSavedStories(parsed as SavedStory[])
    } catch {
      setSavedStories([])
    }
  }, [])

  const chooseFile = (kind: 'image' | 'audio', file?: File) => {
    if (!file) return
    const urlRef = kind === 'image' ? imageUrl : audioUrl
    const fileRef = kind === 'image' ? imageFile : audioFile
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = URL.createObjectURL(file)
    fileRef.current = file
    setStory((current) => ({ ...current, [kind]: urlRef.current }))
  }

  const uploadFile = async (file: File, capability: string): Promise<OwnedUpload> => {
    if (file.size > 25 * 1024 * 1024) throw new Error('Files must be no larger than 25 MB.')

    const body = new FormData()
    body.append('_payload', JSON.stringify({ alt: story.title || file.name }))
    if (process.env.NEXT_PUBLIC_DIRECT_UPLOADS === 'true') {
      const instructionsResponse = await fetch('/api/story-media/upload-instructions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-media-capability': capability,
        },
        body: JSON.stringify({
          filename: file.name,
          filesize: file.size,
          mimeType: file.type,
        }),
      })
      const instructions = (await instructionsResponse.json()) as {
        type?: string
        file?: {
          filename?: string
          mimeType?: string
          size?: number
          uploadReference?: Record<string, unknown>
        }
        request?: {
          headers?: Record<string, string>
          method?: 'POST' | 'PUT'
          url?: string
        }
        errors?: Array<{ message?: string }>
      }
      if (
        !instructionsResponse.ok ||
        instructions.type !== 'http' ||
        !instructions.file ||
        !instructions.request?.url ||
        !instructions.request.method
      ) {
        throw new Error(instructions.errors?.[0]?.message || 'Could not prepare the upload.')
      }

      const uploadHeaders = new Headers(instructions.request.headers)
      uploadHeaders.delete('Content-Length')
      const uploadResponse = await fetch(instructions.request.url, {
        method: instructions.request.method,
        headers: uploadHeaders,
        body: file,
      })
      if (!uploadResponse.ok) throw new Error('The file could not be uploaded.')
      body.append('file', JSON.stringify(instructions.file))
    } else {
      body.append('file', file)
    }

    const response = await fetch('/api/story-media', {
      method: 'POST',
      headers: { 'x-media-capability': capability },
      body,
    })
    const result = (await response.json()) as {
      doc?: {
        id?: string | number
        filename?: string
        mimeType?: string
        url?: string | null
      }
      errors?: Array<{ message?: string }>
    }
    if (!response.ok || result.doc?.id === undefined) {
      throw new Error(result.errors?.[0]?.message || 'Upload failed.')
    }
    const id = typeof result.doc.id === 'number' ? result.doc.id : Number(result.doc.id)
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error('The upload returned an invalid media reference.')
    }
    return {
      id,
      filename: result.doc.filename || file.name,
      mimeType: result.doc.mimeType || file.type,
      url: result.doc.url || undefined,
      capability,
    }
  }

  const storeStory = (savedStory: SavedStory) => {
    const nextStories = [savedStory, ...savedStories]
    setSavedStories(nextStories)
    localStorage.setItem(savedStoriesKey, JSON.stringify(nextStories))
  }

  const deleteUpload = async (savedStory: SavedStory, upload: OwnedUpload) => {
    if (!window.confirm(`Delete ${upload.filename}?`)) return
    setDeleteError('')
    setDeletingUploadId(upload.id)
    try {
      const response = await fetch(`/api/story-media/${upload.id}`, {
        method: 'DELETE',
        headers: { 'x-media-capability': upload.capability },
      })
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          errors?: Array<{ message?: string }>
        } | null
        throw new Error(result?.errors?.[0]?.message || 'The file could not be deleted.')
      }

      const nextStories = savedStories.map((item) =>
        item === savedStory ? { ...item, files: item.files.filter((file) => file.id !== upload.id) } : item,
      )
      setSavedStories(nextStories)
      localStorage.setItem(savedStoriesKey, JSON.stringify(nextStories))
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'The file could not be deleted.')
    } finally {
      setDeletingUploadId(null)
    }
  }

  const saveStory = async () => {
    setSaving(true)
    setSaveError('')
    const uploadedFiles: OwnedUpload[] = []
    try {
      const capability = imageFile.current || audioFile.current ? await issueMediaCapability() : undefined
      const image = imageFile.current && capability ? await uploadFile(imageFile.current, capability) : undefined
      if (image) uploadedFiles.push(image)
      const audio = audioFile.current && capability ? await uploadFile(audioFile.current, capability) : undefined
      if (audio) uploadedFiles.push(audio)
      const result = await createStory({ title: story.title, image: image?.id, audio: audio?.id })
      if (!result.url) throw new Error(result.error || 'The story could not be saved.')
      storeStory({ title: story.title.trim(), url: result.url, files: uploadedFiles })
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${result.url}`)
      } catch {
        // The permanent page still opens when clipboard permission is unavailable.
      }
      window.location.href = result.url
    } catch (error) {
      if (uploadedFiles.length > 0) {
        storeStory({ title: `${story.title.trim()} (unsaved uploads)`, files: uploadedFiles })
      }
      setSaveError(error instanceof Error ? error.message : 'The story could not be saved.')
      setSaving(false)
    }
  }

  return (
    <main className="min-h-dvh bg-[#fff8ee] text-[#333]">
      <header className="flex min-h-[66.5px] items-center justify-between gap-4 bg-[#f7931e] px-6 py-3.5 max-sm:flex-col max-sm:items-start">
        <h1 className="font-comic-bold text-[22px] leading-[33px] text-white">Divya Jain</h1>
        <nav className="flex flex-wrap gap-2" aria-label="Story sections">
          {[
            ['create', 'Create'],
            ['read', 'Read'],
            ['stories', 'My Stories'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`nav-button ${view === key ? 'bg-white text-[#f7931e]' : 'text-white'}`}
              onClick={() => setView(key as typeof view)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4 p-6 max-sm:p-4">
        <aside className="rounded-lg border border-[#f5d77a] bg-[#fff3cd] px-3 py-[8.5px] font-comic-regular text-[13px] leading-[19.5px]">
          Shared mode: saved stories and their media can be opened by anyone with the permanent
          link.
        </aside>

        {view === 'create' && (
          <section className="rounded-2xl bg-white p-6 shadow-[0_4px_10px_rgba(0,0,0,0.06)]">
            <h2 className="mb-4 font-comic-regular text-2xl leading-9 text-[#f7931e]">
              Create your story page
            </h2>

            <div className="space-y-4">
              <label className="field">
                <span>Title</span>
                <input
                  value={story.title}
                  onChange={(event) =>
                    setStory((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field file-field">
                <span>Background image</span>
                <span className="file-control" aria-hidden="true" />
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={(event) => chooseFile('image', event.target.files?.[0])}
                />
              </label>

              <label className="field file-field">
                <span>Audio</span>
                <span className="file-control" aria-hidden="true" />
                <input
                  className="sr-only"
                  type="file"
                  accept="audio/*"
                  onChange={(event) => chooseFile('audio', event.target.files?.[0])}
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button className="action-button bg-[#f7931e]" onClick={() => setView('read')}>
                Preview
              </button>
              <button
                className="action-button bg-[#2a9d8f]"
                disabled={saving}
                onClick={() => void saveStory()}
              >
                {saving ? 'Saving…' : 'Save & get permanent link'}
              </button>
            </div>
            {saveError && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {saveError}
              </p>
            )}
          </section>
        )}

        {view === 'read' && (
          <section className="story-preview">
            <div
              className="preview-image"
              style={story.image ? { backgroundImage: `url("${story.image}")` } : undefined}
            />
            <div className="preview-details">
              <h2 className="font-comic-bold text-4xl leading-tight text-[#f7931e]">
                {story.title}
              </h2>
              {story.audio && (
                <audio className="mt-4 w-full max-w-lg" controls src={story.audio}>
                  <track kind="captions" />
                </audio>
              )}
            </div>
          </section>
        )}

        {view === 'stories' && (
          <section className="rounded-2xl bg-white p-6 shadow-[0_4px_10px_rgba(0,0,0,0.06)]">
            <h2 className="font-comic-regular text-2xl leading-9 text-[#f7931e]">My Stories</h2>
            {savedStories.length === 0 ? (
              <p className="mt-4 font-comic-regular text-sm text-[#666]">No stories or uploads saved in this browser yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-black/10">
                {savedStories.map((savedStory, index) => (
                  <li className="py-4" key={`${savedStory.url || savedStory.title}-${index}`}>
                    {savedStory.url ? (
                      <a className="font-comic-bold text-lg text-[#333] hover:text-[#f7931e]" href={savedStory.url}>
                        {savedStory.title}
                      </a>
                    ) : (
                      <h3 className="font-comic-bold text-lg text-[#333]">{savedStory.title}</h3>
                    )}
                    {savedStory.files.length > 0 ? (
                      <ul className="mt-3 space-y-2">
                        {savedStory.files.map((file) => (
                          <li className="flex flex-wrap items-center justify-between gap-3" key={file.id}>
                            <div className="min-w-0">
                              {file.url ? (
                                <a className="break-all text-sm underline" href={file.url} target="_blank" rel="noreferrer">
                                  {file.filename}
                                </a>
                              ) : (
                                <span className="break-all text-sm">{file.filename}</span>
                              )}
                              <span className="ml-2 text-xs text-[#777]">{file.mimeType}</span>
                            </div>
                            <button
                              className="shrink-0 text-sm text-red-700 underline disabled:opacity-50"
                              disabled={deletingUploadId !== null}
                              onClick={() => void deleteUpload(savedStory, file)}
                            >
                              {deletingUploadId === file.id ? 'Deleting…' : 'Delete file'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-[#777]">No uploaded files.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {deleteError && <p className="mt-3 text-sm text-red-600" role="alert">{deleteError}</p>}
          </section>
        )}
      </div>

      <footer className="py-4 text-center font-comic-regular text-[13px] leading-[19.5px] text-[#999]">
        Made by Divya Jain
      </footer>
    </main>
  )
}
