import type {
  ChartItem,
  Comment,
  DownloadUrlEnvelope,
  Playlist,
  QuerySuggestion,
  SearchResponse,
  Searchable,
  Selection,
  StreamUrlEnvelope,
  Track,
  User,
} from './types'
import { API_BASE, ApiError, isTauri, resetClientIdCache, type Transport } from './transport'

export interface SearchFilters {
  track?: boolean
  playlist?: boolean
  album?: boolean
  user?: boolean
  [key: string]: unknown
}

export type UserContentKind = 'tracks' | 'playlists' | 'likes' | 'followings' | 'followers'

export type StreamProtocol = 'progressive' | 'hls'

export interface StreamTarget {
  url: string
  protocol: StreamProtocol
  mimeType: string
  snipped?: boolean
}

function unwrapLike(item: unknown): Searchable[] {
  const rec = item as Record<string, unknown> & { kind?: string; type?: string; track?: unknown; playlist?: unknown; system_playlist?: unknown }
  if (rec.track && typeof rec.track === 'object') return [rec.track as Searchable]
  if (rec.playlist && typeof rec.playlist === 'object') return [rec.playlist as Searchable]
  if (rec.system_playlist && typeof rec.system_playlist === 'object') return [rec.system_playlist as Searchable]
  return [item as Searchable]
}

const GENRES: Record<string, string> = {
  'all-music': 'soundcloud:genres:all-music',
  electro: 'soundcloud:genres:electro',
  'electro-house': 'soundcloud:genres:electro-house',
  hiphop: 'soundcloud:genres:hiphop',
  techno: 'soundcloud:genres:techno',
  dubstep: 'soundcloud:genres:dubstep',
  'drum-and-bass': 'soundcloud:genres:drum-and-bass',
  house: 'soundcloud:genres:house',
  trap: 'soundcloud:genres:trap',
  trance: 'soundcloud:genres:trance',
  ambient: 'soundcloud:genres:ambient',
  breakbeat: 'soundcloud:genres:breakbeat',
  'chill-hop': 'soundcloud:genres:chill-hop',
  metal: 'soundcloud:genres:metal',
  pop: 'soundcloud:genres:pop',
  rnb: 'soundcloud:genres:rnb',
  rock: 'soundcloud:genres:rock',
  soul: 'soundcloud:genres:soul',
  indie: 'soundcloud:genres:indie',
  funk: 'soundcloud:genres:funk',
  jazz: 'soundcloud:genres:jazz',
  classical: 'soundcloud:genres:classical',
  country: 'soundcloud:genres:country',
  world: 'soundcloud:genres:world',
  folk: 'soundcloud:genres:folk',
  reggae: 'soundcloud:genres:reggae',
  latin: 'soundcloud:genres:latin',
  punk: 'soundcloud:genres:punk',
}

const ALL_MUSIC = 'all-music'

const GENRE_SLUGS: string[] = Object.keys(GENRES).filter((slug) => slug !== ALL_MUSIC)

const IDS_BATCH_SIZE = 50

export class SoundCloudAPI {
  constructor(private readonly transport: Transport) {}

  private async buildUrl(
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    refresh = false,
  ): Promise<string> {
    const base = path.startsWith('http') ? new URL(path) : new URL(`${API_BASE}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) base.searchParams.set(key, String(value))
    }
    base.searchParams.set('client_id', await this.transport.getClientId(refresh))
    return base.toString()
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const doFetch = async (refresh: boolean): Promise<T> => {
      const url = await this.buildUrl(path, params, refresh)
      return (await this.transport.getJSON(url)) as T
    }
    try {
      return await doFetch(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        resetClientIdCache()
        return doFetch(true)
      }
      throw error
    }
  }

  private mapPaged<T>(response: SearchResponse<unknown>): SearchResponse<T> {
    return {
      ...response,
      next_href: response.next_href ? this.transport.rewriteHref(response.next_href) : null,
    } as unknown as SearchResponse<T>
  }

  async search(q: string, offset = 0, limit = 20, filters: SearchFilters = {}): Promise<SearchResponse<Searchable>> {
    const params: Record<string, string | number | boolean | undefined> = { q, offset, limit }
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === 'boolean' && value) params[`filter.${key}`] = true
    }
    return this.mapPaged<Searchable>(await this.get('/search', params))
  }

  async searchTracks(q: string, offset = 0, limit = 20): Promise<SearchResponse<Track>> {
    return this.mapPaged<Track>(await this.get('/search/tracks', { q, offset, limit }))
  }

  async searchPlaylists(q: string, offset = 0, limit = 20): Promise<SearchResponse<Playlist>> {
    return this.mapPaged<Playlist>(await this.get('/search/playlists', { q, offset, limit }))
  }

  async searchAlbums(q: string, offset = 0, limit = 20): Promise<SearchResponse<Playlist>> {
    return this.mapPaged<Playlist>(await this.get('/search/albums', { q, offset, limit }))
  }

  async searchUsers(q: string, offset = 0, limit = 20): Promise<SearchResponse<User>> {
    return this.mapPaged<User>(await this.get('/search/users', { q, offset, limit }))
  }

  async searchSuggestions(q: string, limit = 6): Promise<string[]> {
    const response = await this.get<SearchResponse<QuerySuggestion>>('/search/queries', { q, limit })
    return response.collection.map((item) => item.output)
  }

  async track(id: number): Promise<Track> {
    return this.get<Track>(`/tracks/${id}`)
  }

  async trackComments(id: number, offset = 0, limit = 30): Promise<SearchResponse<Comment>> {
    return this.mapPaged<Comment>(await this.get('/tracks/' + id + '/comments', { threaded: 1, offset, limit }))
  }

  async trackRelated(id: number, offset = 0, limit = 12): Promise<SearchResponse<Track>> {
    return this.mapPaged<Track>(await this.get(`/tracks/${id}/related`, { offset, limit }))
  }

  async playlist(id: number): Promise<Playlist> {
    return this.get<Playlist>(`/playlists/${id}`)
  }

  async user(id: number): Promise<User> {
    return this.get<User>(`/users/${id}`)
  }

  async userContent(id: number, kind: UserContentKind, offset = 0, limit = 30): Promise<SearchResponse<Searchable>> {
    const response = await this.get<SearchResponse<unknown>>(`/users/${id}/${kind}`, { offset, limit })
    const paged = this.mapPaged<Searchable>(response)
    if (kind !== 'likes') return paged
    return { ...paged, collection: ((response.collection ?? []) as unknown[]).flatMap(unwrapLike) }
  }

  async tracksByIds(ids: number[]): Promise<Track[]> {
    const unique: number[] = []
    const seen = new Set<number>()
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id)
        unique.push(id)
      }
    }
    if (unique.length === 0) return []
    const batches: Promise<Track[]>[] = []
    for (let start = 0; start < unique.length; start += IDS_BATCH_SIZE) {
      const batch = unique.slice(start, start + IDS_BATCH_SIZE)
      batches.push(this.get<Track[]>('/tracks', { ids: batch.join(',') }))
    }
    const found = new Map<number, Track>()
    for (const chunk of await Promise.all(batches)) {
      for (const track of chunk ?? []) found.set(track.id, track)
    }
    const ordered: Track[] = []
    for (const id of ids) {
      const track = found.get(id)
      if (track) ordered.push(track)
    }
    return ordered
  }

  async charts(genre = 'soundcloud:genres:all-music', kind = 'trending', offset = 0, limit = 20): Promise<SearchResponse<ChartItem>> {
    return this.mapPaged<ChartItem>(await this.get('/charts', { genre, kind, offset, limit }))
  }

  async featured(genre = ALL_MUSIC, offset = 0, limit = 20): Promise<SearchResponse<Track>> {
    return this.mapPaged<Track>(await this.get(`/featured_tracks/top/${genre}`, { offset, limit }))
  }

  async recentTracks(slug: string, limit = 20): Promise<SearchResponse<Track>> {
    return this.mapPaged<Track>(await this.get(`/recent-tracks/${encodeURIComponent(slug)}`, { limit }))
  }

  async mixedSelections(limit = 8): Promise<Selection[]> {
    const response = await this.get<SearchResponse<Selection>>('/mixed-selections', { limit })
    return response.collection
  }

  async resolve(url: string): Promise<Track | Playlist | User> {
    return this.get<Track | Playlist | User>('/resolve', { url })
  }

  async page<T>(href: string): Promise<SearchResponse<T>> {
    return this.mapPaged<T>((await this.transport.getJSON(href)) as SearchResponse<unknown>)
  }

  async me(): Promise<User | null> {
    try {
      const url = await this.buildUrl('/me', {})
      return (await this.transport.authedRequest('GET', url)) as User
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null
      throw error
    }
  }

  async meLikes(userId: number, limit = 50, next: string | null = null): Promise<SearchResponse<Searchable>> {
    const built = next ? await this.buildUrl(next, {}) : await this.buildUrl(`/users/${userId}/likes`, { limit })
    const response = (await this.transport.authedRequest('GET', built)) as SearchResponse<unknown>
    const collection = ((response.collection ?? []) as unknown[]).flatMap(unwrapLike)
    return {
      ...response,
      collection,
      next_href: response.next_href ? this.transport.rewriteHref(response.next_href) : null,
    } as SearchResponse<Searchable>
  }

  async mePlaylists(userId: number, limit = 50, next: string | null = null): Promise<SearchResponse<Searchable>> {
    const built = next ? await this.buildUrl(next, {}) : await this.buildUrl(`/users/${userId}/playlists`, { limit })
    const response = (await this.transport.authedRequest('GET', built)) as SearchResponse<unknown>
    const collection = ((response.collection ?? []) as unknown[]).flatMap(unwrapLike)
    return {
      ...response,
      collection,
      next_href: response.next_href ? this.transport.rewriteHref(response.next_href) : null,
    } as SearchResponse<Searchable>
  }

  async toggleAccountLike(trackId: number, liked: boolean): Promise<void> {
    const url = await this.buildUrl(`/me/likes/${trackId}`, {})
    const body = liked ? { item_urn: `soundcloud:tracks:${trackId}` } : undefined
    await this.transport.authedRequest(liked ? 'PUT' : 'DELETE', url, body)
  }

  async streamUrl(track: Track, preferred: StreamProtocol = 'progressive'): Promise<StreamTarget | null> {
    const transcodings = track.media?.transcodings ?? []
    if (transcodings.length === 0) return null
    const byProtocol = (protocol: StreamProtocol) => transcodings.filter((t) => t.format.protocol === protocol)
    const ordered =
      preferred === 'progressive' ? [...byProtocol('progressive'), ...byProtocol('hls')] : [...byProtocol('hls'), ...byProtocol('progressive')]
    if (ordered.length === 0) return null
    for (const selected of ordered) {
      const envelope = await this.streamEnvelope(selected.url)
      if (envelope?.url) {
        return {
          url: envelope.url,
          protocol: selected.format.protocol,
          mimeType: selected.format.mime_type,
          snipped: selected.snipped ?? false,
        }
      }
    }
    return null
  }

  private async streamEnvelope(url: string): Promise<StreamUrlEnvelope | null> {
    const anonymous = await this.tryAnonymous<StreamUrlEnvelope>(url)
    if (anonymous?.url) return anonymous
    const authed = await this.tryAuthed<StreamUrlEnvelope>(url)
    return authed?.url ? authed : null
  }

  private async tryAnonymous<T>(path: string): Promise<T | null> {
    try {
      return await this.get<T>(path)
    } catch {
      return null
    }
  }

  private async tryAuthed<T>(path: string): Promise<T | null> {
    if (!isTauri()) return null
    try {
      const url = await this.buildUrl(path, {})
      return (await this.transport.authedRequest('GET', url)) as T
    } catch {
      return null
    }
  }

  async waveformSamples(track: Track): Promise<number[] | null> {
    if (!track.waveform_url) return null
    try {
      const res = await fetch(track.waveform_url)
      if (!res.ok) return null
      const data = (await res.json()) as { samples?: number[]; height?: number }
      const samples = data.samples
      if (!Array.isArray(samples) || samples.length === 0) return null
      const peak = data.height && data.height > 0 ? data.height : Math.max(...samples)
      if (!Number.isFinite(peak) || peak <= 0) return null
      return samples.map((value) => Math.min(1, Math.max(0, value / peak)))
    } catch {
      return null
    }
  }

  async downloadUrl(track: Track): Promise<string | null> {
    if (!track.downloadable) return null
    const path = `/tracks/${track.id}/downloads`
    const anonymous = await this.tryAnonymous<DownloadUrlEnvelope>(path)
    if (anonymous?.download_url) return anonymous.download_url
    const authed = await this.tryAuthed<DownloadUrlEnvelope>(path)
    return authed?.download_url ?? null
  }

  genreUrn(slug: string): string {
    return GENRES[slug] ?? `soundcloud:genres:${slug}`
  }

  genres(): string[] {
    return [...GENRE_SLUGS]
  }
}
