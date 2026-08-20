import { SHORTCUTS } from '../core/shortcuts'
import { h } from '../ui/el'
import { openModal } from '../ui/modal'
import { t } from '../core/i18n.ts'

let open = false

export function openShortcuts(): void {
  if (open) return
  open = true
  const modal = openModal({
    title: t('Atajos de teclado'),
    className: 'shortcuts-modal',
    onClose: () => {
      open = false
    },
  })

  const groups = [...new Set(SHORTCUTS.map((item) => item.group))]
  for (const group of groups) {
    modal.body.appendChild(h('h3', { className: 'shortcut-group' }, t(group)))
    const list = h('div', { className: 'shortcut-list' })
    for (const item of SHORTCUTS.filter((entry) => entry.group === group)) {
      const row = h('div', { className: 'shortcut-row' })
      row.append(h('kbd', { className: 'kbd' }, item.keys), h('span', { className: 'text-dim' }, t(item.label)))
      list.appendChild(row)
    }
    modal.body.appendChild(list)
  }
  modal.body.appendChild(
    h('p', { className: 'text-faint' }, t('Los atajos de una sola letra no se disparan mientras escribes en un campo.')),
  )
}
