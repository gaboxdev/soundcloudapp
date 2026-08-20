import type { PlaylistSummary, Track } from '@soundclear/api'
import { navigate } from '../core/router'
import {
  addTrackToPlaylist,
  canWrite,
  createPlaylistWith,
  invalidatePlaylists,
  myPlaylists,
} from '../core/social'
import { artEl } from '../ui/artwork'
import { h } from '../ui/el'
import { openModal, type Modal } from '../ui/modal'
import { skPickerRows } from '../ui/skeleton'
import { toast, toastErr } from '../ui/toast'
import { t } from '../core/i18n.ts'

let open = false

function dateLabel(): string {
  return new Date().toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

function createForm(
  modal: Modal,
  defaultTitle: string,
  submitLabel: string,
  onCreate: (title: string, isPublic: boolean) => Promise<void>,
): HTMLElement {
  const form = h('div', { className: 'picker-create' })
  const label = h('label', { className: 'field-label', for: 'picker-title' }, t('Nombre de la playlist'))
  const input = h('input', {
    className: 'input',
    id: 'picker-title',
    type: 'text',
    value: defaultTitle,
    maxlength: '100',
    autocomplete: 'off',
  }) as HTMLInputElement

  const visibility = h('div', { className: 'chip-row' })
  const privateChip = h('button', { className: 'chip active', type: 'button' }, t('Privada'))
  const publicChip = h('button', { className: 'chip', type: 'button' }, t('Pública'))
  visibility.append(privateChip, publicChip)
  let isPublic = false
  const paintVisibility = (): void => {
    privateChip.classList.toggle('active', !isPublic)
    publicChip.classList.toggle('active', isPublic)
    privateChip.setAttribute('aria-pressed', String(!isPublic))
    publicChip.setAttribute('aria-pressed', String(isPublic))
    hint.textContent = isPublic
      ? t('Cualquiera podrá verla en tu perfil de SoundCloud.')
      : t('Solo tú la verás en tu perfil de SoundCloud.')
  }
  const hint = h('p', { className: 'text-faint settings-hint' })
  privateChip.addEventListener('click', () => {
    isPublic = false
    paintVisibility()
  })
  publicChip.addEventListener('click', () => {
    isPublic = true
    paintVisibility()
  })
  paintVisibility()

  const submit = h('button', { className: 'btn btn-primary btn-sm' }, submitLabel) as HTMLButtonElement
  const run = async (): Promise<void> => {
    const title = input.value.trim()
    if (!title) {
      input.focus()
      toastErr(t('Ponle un nombre a la playlist'))
      return
    }
    submit.disabled = true
    submit.textContent = t('Creando…')
    try {
      await onCreate(title, isPublic)
      modal.close()
    } catch {
      submit.disabled = false
      submit.textContent = submitLabel
      toastErr(t('No se pudo crear la playlist en SoundCloud'))
    }
  }
  submit.addEventListener('click', () => void run())
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void run()
    }
  })

  form.append(label, input, visibility, hint, submit)
  return form
}

function playlistRow(playlist: PlaylistSummary, onPick: () => Promise<void>): HTMLElement {
  const row = h('button', { className: 'picker-row', type: 'button' }) as HTMLButtonElement
  const art = artEl(playlist.artwork_url, playlist.title, { size: 't120x120' })
  art.classList.add('picker-art')
  const meta = h('span', { className: 'picker-meta' })
  const count = playlist.track_count ?? 0
  meta.append(
    h('span', { className: 'picker-title truncate' }, playlist.title),
    h('span', { className: 'picker-sub truncate' }, `${count} ${count === 1 ? 'track' : 'tracks'}`),
  )
  const status = h('span', { className: 'picker-status' })
  row.append(art, meta, status)
  row.addEventListener('click', () => {
    if (row.disabled) return
    row.disabled = true
    status.textContent = t('Añadiendo…')
    void onPick()
      .then(() => {
        status.textContent = ''
      })
      .catch(() => {
        row.disabled = false
        status.textContent = ''
      })
  })
  return row
}

export function openPlaylistPicker(track: Track): void {
  if (!canWrite() || open) return
  open = true
  const modal = openModal({
    title: t('Añadir a una playlist'),
    className: 'picker-modal',
    onClose: () => {
      open = false
    },
  })

  const list = h('div', { className: 'picker-list' })
  for (const skeleton of skPickerRows(4)) list.appendChild(skeleton)

  modal.body.append(
    h('p', { className: 'text-dim truncate' }, `«${track.title}»`),
    list,
    h('div', { className: 'picker-sep' }),
    createForm(modal, `${track.title}`.slice(0, 80), t('Crear playlist con este track'), async (title, isPublic) => {
      const created = await createPlaylistWith(title, [track.id], isPublic)
      toast(`Playlist «${created.title}» creada`, 'ok')
    }),
  )

  void myPlaylists()
    .then((items) => {
      if (!modal.root.isConnected) return
      list.replaceChildren()
      if (items.length === 0) {
        list.appendChild(h('p', { className: 'text-faint' }, t('Todavía no tienes playlists propias. Crea una aquí abajo.')))
        return
      }
      for (const playlist of items) {
        list.appendChild(
          playlistRow(playlist, async () => {
            const result = await addTrackToPlaylist(playlist, track)
            if (result === 'duplicate') {
              toast(t('Ese track ya estaba en la playlist'))
              return
            }
            toast(`Añadido a «${playlist.title}»`, 'ok')
            modal.close()
          }),
        )
      }
    })
    .catch(() => {
      if (!modal.root.isConnected) return
      list.replaceChildren(h('p', { className: 'text-faint' }, t('No se pudieron cargar tus playlists. Puedes crear una nueva.')))
    })
}

export function openSaveQueue(tracks: Track[]): void {
  if (!canWrite() || open) return
  if (tracks.length === 0) {
    toast(t('La cola está vacía'))
    return
  }
  open = true
  const modal = openModal({
    title: t('Guardar la cola como playlist'),
    className: 'picker-modal',
    onClose: () => {
      open = false
    },
  })

  const total = tracks.length
  modal.body.append(
    h('p', { className: 'text-dim' }, `Se guardarán ${total} ${total === 1 ? 'track' : 'tracks'} en el orden actual de la cola.`),
    createForm(modal, `Cola de SoundClear · ${dateLabel()}`, t('Guardar playlist'), async (title, isPublic) => {
      const created = await createPlaylistWith(
        title,
        tracks.map((track) => track.id),
        isPublic,
      )
      invalidatePlaylists()
      toast(`Playlist «${created.title}» creada con ${total} tracks`, 'ok')
      navigate(`/playlist/${created.id}`)
    }),
  )
}
