interface Disposal {
  element: Element
  attached: boolean
  dispose: () => void
}

const disposals = new Set<Disposal>()
let observer: MutationObserver | null = null

export function onDetach(element: Element, dispose: () => void): () => void {
  const entry = { element, attached: element.isConnected, dispose }
  disposals.add(entry)
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const current of [...disposals]) {
        if (current.element.isConnected) current.attached = true
        else if (current.attached) {
          disposals.delete(current)
          current.dispose()
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }
  return () => disposals.delete(entry)
}
