import { h } from './el'

const TITLE_W = ['58%', '43%', '66%', '50%', '38%', '61%', '47%', '70%']
const SUB_W = ['31%', '24%', '37%', '28%', '21%', '33%', '26%', '29%']
const STAT_W = ['44px', '36px', '52px', '40px']
const NAME_W = ['46%', '35%', '54%', '41%', '50%', '38%']
const TEXT_W = ['92%', '78%', '86%', '64%', '95%', '72%']
const CHIP_W = ['64px', '82px', '58px', '96px', '72px', '66px', '88px', '60px']
const REASON_W = ['38%', '46%', '30%', '42%', '34%']

export interface ShapeOpts {
  width?: string
  height?: string
  radius?: string
  index?: number
}

export interface RowOpts {
  rank?: boolean
  stat?: boolean
  index?: number
}

function pick(values: string[], index: number): string {
  return values[Math.abs(index) % values.length]
}

function stagger<T extends HTMLElement>(el: T, index?: number): T {
  if (index !== undefined) el.style.setProperty('--sk-i', String(Math.abs(index) % 14))
  return el
}

function box(className: string, children: (HTMLElement | null)[]): HTMLElement {
  return h('div', { className }, children)
}

function root(className: string, children: (HTMLElement | null)[], index?: number): HTMLElement {
  const el = box(className, children)
  el.setAttribute('aria-hidden', 'true')
  return stagger(el, index)
}

export function skShape(className: string, opts: ShapeOpts = {}): HTMLElement {
  const el = h('div', { className: `skeleton ${className}`.trim() })
  if (opts.width) el.style.width = opts.width
  if (opts.height) el.style.height = opts.height
  if (opts.radius) el.style.borderRadius = opts.radius
  return stagger(el, opts.index)
}

export function skLine(width: string, opts: ShapeOpts = {}): HTMLElement {
  return skShape('sk-line', { ...opts, width })
}

export function skCircle(size: number, extra = ''): HTMLElement {
  return skShape(`sk-circle ${extra}`.trim(), { width: `${size}px`, height: `${size}px` })
}

export function skChip(index = 0): HTMLElement {
  return skShape('sk-chip', { width: pick(CHIP_W, index) })
}

export function skChipRow(count = 8): HTMLElement {
  return root('sk-chip-row', Array.from({ length: count }, (_item, index) => skChip(index)))
}

function skActions(main = 1, icons = 2, width = '132px'): HTMLElement {
  const children: HTMLElement[] = []
  for (let i = 0; i < main; i++) children.push(skShape('sk-btn', { width }))
  for (let i = 0; i < icons; i++) children.push(skShape('sk-icon-btn'))
  return box('sk-actions', children)
}

function skMeta(index: number, small = false): HTMLElement {
  return box('sk-meta', [
    skLine(pick(TITLE_W, index), small ? { height: '12px' } : {}),
    skLine(pick(SUB_W, index), { height: '10px' }),
  ])
}

export function skTrackRow(opts: RowOpts = {}): HTMLElement {
  const index = opts.index ?? 0
  return root(
    'sk-row',
    [
      opts.rank ? skShape('sk-rank') : null,
      skShape('sk-art'),
      skMeta(index),
      opts.stat === false ? null : skShape('sk-stat', { width: pick(STAT_W, index) }),
    ],
    index,
  )
}

export function skTrackRows(count = 6, opts: RowOpts = {}): HTMLElement[] {
  return Array.from({ length: count }, (_item, index) => skTrackRow({ ...opts, index }))
}

export function skTrackList(count = 6, opts: RowOpts = {}): HTMLElement {
  return root('sk-list', skTrackRows(count, opts))
}

export function skMore(count = 2, opts: RowOpts = {}): HTMLElement {
  return root('sk-more', skTrackRows(count, opts))
}

export function skResultRow(kind: 'playlist' | 'user', index = 0): HTMLElement {
  if (kind === 'user') {
    return root(
      'sk-result sk-result-user',
      [
        skCircle(48),
        box('sk-meta', [skLine(pick(NAME_W, index), { height: '13px' }), skLine(pick(SUB_W, index), { height: '10px' })]),
      ],
      index,
    )
  }
  return root(
    'sk-result',
    [
      skShape('sk-art sk-art-md'),
      box('sk-meta', [
        box('sk-inline', [skLine(pick(NAME_W, index), { height: '13px' }), skShape('sk-badge')]),
        skLine(pick(SUB_W, index), { height: '10px' }),
      ]),
    ],
    index,
  )
}

export function skResultRows(kind: 'playlist' | 'user', count = 6): HTMLElement[] {
  return Array.from({ length: count }, (_item, index) => skResultRow(kind, index))
}

export function skPlaylistCard(variant: 'row' | 'tile' = 'tile', index = 0): HTMLElement {
  if (variant === 'row') {
    return root('sk-card sk-card-row', [skShape('sk-art sk-art-md'), skMeta(index, true)], index)
  }
  return root(
    'sk-card sk-card-tile',
    [skShape('sk-art sk-art-fill'), skLine(pick(TITLE_W, index), { height: '12px' }), skLine(pick(SUB_W, index), { height: '10px' })],
    index,
  )
}

export function skPlaylistCards(count = 8, variant: 'row' | 'tile' = 'tile'): HTMLElement[] {
  return Array.from({ length: count }, (_item, index) => skPlaylistCard(variant, index))
}

export function skCardGrid(count = 6, variant: 'row' | 'tile' = 'row'): HTMLElement {
  return root(`sk-grid sk-grid-${variant}`, skPlaylistCards(count, variant))
}

export function skCarousel(count = 6): HTMLElement {
  return root(
    'sk-carousel',
    Array.from({ length: count }, (_item, index) =>
      root(
        'sk-tile-card',
        [
          skShape('sk-art sk-art-fill'),
          skLine(pick(TITLE_W, index), { height: '12px' }),
          skLine(pick(SUB_W, index), { height: '10px' }),
        ],
        index,
      ),
    ),
  )
}

export function skAvatarRow(count = 6): HTMLElement {
  return root(
    'sk-avatar-row',
    Array.from({ length: count }, (_item, index) =>
      root('sk-avatar-card', [skCircle(72), skLine('68%', { height: '11px' }), skLine('48%', { height: '9px' })], index),
    ),
  )
}

function skHead(action = false): HTMLElement {
  return box('sk-head', [
    skShape('sk-head-icon'),
    skLine('26%', { height: '15px' }),
    action ? skShape('sk-head-action', { width: '58px' }) : null,
  ])
}

export function skSection(body: HTMLElement, action = false): HTMLElement {
  return root('sk-section', [skHead(action), body])
}

export function skHero(): HTMLElement {
  return root('sk-hero card', [
    skShape('sk-hero-art'),
    box('sk-hero-info', [
      skLine('76px', { height: '10px' }),
      skLine('64%', { height: '28px' }),
      box('sk-inline', [
        skLine('92px', { height: '12px' }),
        skLine('46px', { height: '12px' }),
        skLine('74px', { height: '12px' }),
      ]),
      skActions(1, 1, '142px'),
    ]),
  ])
}

export function skHome(): HTMLElement {
  return root('sk-page sk-home', [
    skHero(),
    skSection(skCarousel(6), true),
    skSection(skTrackList(7, { rank: true }), true),
    skSection(skChipRow(10)),
    skSection(skCarousel(5)),
  ])
}

const WAVE_BARS = 64

export function skWave(bars = WAVE_BARS): HTMLElement {
  const wave = root('sk-wave', [])
  for (let i = 0; i < bars; i++) {
    const bar = h('div', { className: 'sk-wave-bar' })
    const shape = Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.19) + Math.sin(i * 1.7) * 0.28)
    bar.style.height = `${Math.round(22 + shape * 74)}%`
    bar.style.setProperty('--sk-i', String(i % 14))
    wave.appendChild(bar)
  }
  return wave
}

export function skTrackPage(): HTMLElement {
  return root('sk-page sk-track-page', [
    box('sk-track-hero card card-pad', [
      box('sk-track-art-col', [skShape('sk-art sk-art-fill sk-art-hero')]),
      box('sk-track-info', [
        box('sk-inline', [skChip(0), skChip(3)]),
        skLine('74%', { height: '30px' }),
        box('sk-byline', [skCircle(28), skLine('30%', { height: '14px' })]),
        box('sk-inline', [
          skLine('86px', { height: '12px' }),
          skLine('72px', { height: '12px' }),
          skLine('64px', { height: '12px' }),
        ]),
        skActions(1, 3, '138px'),
      ]),
    ]),
    skWave(),
    skSection(skTrackList(6)),
  ])
}

export function skPlaylistPage(): HTMLElement {
  return root('sk-page sk-playlist-page', [
    box('sk-pl-header card card-pad', [
      skShape('sk-art sk-pl-art'),
      box('sk-pl-info', [
        box('sk-inline', [skChip(2), skChip(1)]),
        skLine('56%', { height: '30px' }),
        box('sk-byline', [skCircle(26), skLine('26%', { height: '14px' })]),
        skLine('44%', { height: '12px' }),
        skActions(2, 2, '128px'),
      ]),
    ]),
    skTrackList(8),
  ])
}

export function skProfileHead(): HTMLElement {
  return root('sk-profile', [
    skShape('sk-banner'),
    box('sk-profile-body', [
      skCircle(96, 'sk-profile-avatar'),
      box('sk-profile-info', [
        skLine('30%', { height: '26px' }),
        box('sk-inline', [skLine('124px', { height: '12px' }), skLine('104px', { height: '12px' })]),
        skLine(pick(TEXT_W, 0), { height: '11px' }),
        skLine(pick(TEXT_W, 3), { height: '11px' }),
        box('sk-inline', [skChip(0), skChip(1), skChip(2)]),
        skActions(1, 2, '150px'),
      ]),
    ]),
  ])
}

export function skComments(count = 3): HTMLElement {
  return root(
    'sk-comments',
    Array.from({ length: count }, (_item, index) =>
      root(
        'sk-comment',
        [
          skCircle(36),
          box('sk-meta', [
            box('sk-inline', [skLine(pick(NAME_W, index), { height: '12px' }), skLine('48px', { height: '10px' })]),
            skLine(pick(TEXT_W, index), { height: '11px' }),
          ]),
        ],
        index,
      ),
    ),
  )
}

export function skFeedItems(count = 5): HTMLElement[] {
  return Array.from({ length: count }, (_item, index) =>
    root('sk-feed-item', [box('sk-feed-reason', [skCircle(20), skLine(pick(REASON_W, index), { height: '10px' })]), skTrackRow({ index })], index),
  )
}

export function skAccountCard(): HTMLElement {
  return root('sk-account card card-pad', [
    box('sk-account-row', [
      skCircle(56),
      box('sk-meta', [skLine('180px', { height: '15px' }), skLine('260px', { height: '11px' })]),
    ]),
    box('sk-inline', [skChip(0), skChip(4), skChip(2)]),
    skActions(2, 0, '120px'),
  ])
}

export function skPickerRows(count = 4): HTMLElement[] {
  return Array.from({ length: count }, (_item, index) =>
    root('sk-picker-row', [skShape('sk-art sk-art-sm'), skMeta(index, true)], index),
  )
}

export function skPaletteRows(count = 3): HTMLElement[] {
  return Array.from({ length: count }, (_item, index) =>
    root(
      'sk-palette-row',
      [skShape('sk-palette-icon'), box('sk-meta', [skLine(pick(NAME_W, index), { height: '12px' }), skLine(pick(SUB_W, index), { height: '9px' })])],
      index,
    ),
  )
}

export function skStatus(width = '160px'): HTMLElement {
  return skShape('sk-status', { width })
}

export function skAppearsRow(count = 5): HTMLElement {
  return root(
    'sk-appears-row',
    Array.from({ length: count }, (_item, index) =>
      root(
        'sk-appears-card',
        [
          skShape('sk-art sk-appears-art'),
          skLine(pick(TITLE_W, index), { height: '11px' }),
          skLine(pick(SUB_W, index), { height: '9px' }),
        ],
        index,
      ),
    ),
  )
}

export function skAccountPreview(size = 40): HTMLElement {
  return root('sk-account-row', [
    skCircle(size),
    box('sk-meta', [skLine('170px', { height: '13px' }), skLine('230px', { height: '10px' })]),
  ])
}

export function skReveal(el: HTMLElement): void {
  el.classList.add('sk-swap-in')
  const done = (event: AnimationEvent): void => {
    if (event.target !== el) return
    el.classList.remove('sk-swap-in')
    el.removeEventListener('animationend', done)
  }
  el.addEventListener('animationend', done)
}
