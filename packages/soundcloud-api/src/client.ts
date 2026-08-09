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
import { API_BASE, resetClientIdCache, type Transport } from './transport'

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
  punk: 'soundcloud:genres:punks',
}

export class SoundCloudAPI {
  constructor(private readonly transport: Transport) {}

  private async buildUrl(path: string, params: Record<string, string | number | boolean | undefined>): Promise<string> {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value))
    }
    qs.set('client_id', await this.transport.getClientId())
    return `${API_BASE}${path}?${qs.toString()}`
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const doFetch = async (): Promise<T> => {
      const url = await this.buildUrl(path, params)
      return (await this.transport.getJSON(url)) as T
    }
    try {
      return await doFetch()
    } catch (error) {
      if (String(error).includes('401')) {
        resetClientIdCache()
        return doFetch()
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
    return this.mapPaged<Searchable>(await this.get(`/users/${id}/${kind}`, { offset, limit }))
  }

  async charts(genre = 'soundcloud:genres:all-music', kind = 'trending', offset = 0, limit = 20): Promise<SearchResponse<ChartItem>> {
    return this.mapPaged<ChartItem>(await this.get('/charts', { genre, kind, offset, limit }))
  }

  async featured(genre = 'all-music', offset = 0, limit = 20): Promise<SearchResponse<Track>> {
    return this.mapPaged<Track>(await this.get(`/featured_tracks/top/${genre}`, { offset, limit }))
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
      if (String(error).includes('401') || String(error).includes('403')) return null
      throw error
    }
  }

  async meLikes(offset = 0, limit = 50): Promise<SearchResponse<Searchable>> {
    const url = await this.buildUrl('/me/library/all', { offset, limit })
    const response = (await this.transport.authedRequest('GET', url)) as SearchResponse<unknown>
    return this.mapPaged<Searchable>(response)
  }

  async toggleAccountLike(trackId: number, liked: boolean): Promise<void> {
    const url = await this.buildUrl(`/me/likes/${trackId}`, {})
    const body = liked ? { item_urn: `soundcloud:tracks:${trackId}` } : undefined
    await this.transport.authedRequest(liked ? 'PUT' : 'DELETE', url, body)
  }

  async streamUrl(track: Track, preferred: StreamProtocol = 'progressive'): Promise<StreamTarget | null> {
    if (!track.streamable) return null
    const transcodings = track.media?.transcodings ?? []
    if (transcodings.length === 0) return null
    const byProtocol = (protocol: StreamProtocol) => transcodings.find((t) => t.format.protocol === protocol)
    const selected =
      preferred === 'progressive'
        ? byProtocol('progressive') ?? byProtocol('hls')
        : byProtocol('hls') ?? byProtocol('progressive')
    if (!selected) return null
    const envelope = (await this.get<StreamUrlEnvelope>(selected.url)) as StreamUrlEnvelope
    return {
      url: envelope.url,
      protocol: selected.format.protocol,
      mimeType: selected.format.mime_type,
      snipped: selected.snipped ?? false,
    }
  }

  async waveformSamples(track: Track): Promise<number[] | null> {
    if (!track.waveform_url) return null
    try {
      const res = await fetch(track.waveform_url)
      if (!res.ok) return null
      const data = (await res.json()) as { samples?: number[] }
      return data.samples ?? null
    } catch {
      return null
    }
  }

  async downloadUrl(track: Track): Promise<string | null> {
    if (!track.downloadable) return null
    try {
      const envelope = (await this.get<DownloadUrlEnvelope>(`/tracks/${track.id}/downloads`)) as DownloadUrlEnvelope
      return envelope.download_url ?? null
    } catch {
      return null
    }
  }

  genreUrn(slug: string): string {
    return GENRES[slug] ?? `soundcloud:genres:${slug}`
  }

  async topGenres(): Promise<string[]> {
    return Object.keys(GENRES)
  }
}
