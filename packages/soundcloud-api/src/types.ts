export interface UserBadges {
  pro?: boolean
  pro_unlimited?: boolean
  creator_mid_tier?: boolean
  verified?: boolean
}

export interface UserVisual {
  visual_url: string
  urn?: string
  entry_time?: number
}

export interface UserVisuals {
  urn?: string
  enabled?: boolean
  visuals?: UserVisual[]
  tracking?: unknown
}

export interface User {
  id: number
  kind: 'user'
  username: string
  full_name: string
  first_name: string
  last_name: string
  permalink: string
  permalink_url: string
  uri: string
  urn: string
  avatar_url: string | null
  city: string | null
  country_code: string | null
  followers_count: number
  followings_count?: number | null
  likes_count?: number | null
  track_count?: number | null
  playlist_count?: number | null
  verified: boolean
  badges?: UserBadges | null
  last_modified?: string
  station_permalink?: string | null
  station_urn?: string | null
  description?: string | null
  visuals?: UserVisuals | null
}

export type TrackPolicy = 'ALLOW' | 'SNIP' | 'BLOCK' | string

export interface Transcoding {
  url: string
  format: {
    protocol: 'progressive' | 'hls'
    mime_type: string
  }
  quality: 'sq' | 'hq' | 'lq' | string
  preset?: string
  duration?: number
  snipped?: boolean
  is_legacy_transcoding?: boolean
}

export interface Track {
  id: number
  kind: 'track'
  title: string
  description: string | null
  caption?: string | null
  permalink: string
  permalink_url: string
  uri: string
  urn: string
  user: User
  user_id: number
  artwork_url: string | null
  waveform_url: string | null
  visuals?: unknown
  duration: number
  full_duration?: number
  display_date?: string
  created_at?: string
  last_modified?: string
  release_date?: string
  genre?: string | null
  tag_list?: string
  label_name?: string | null
  license?: string
  public?: boolean
  sharing?: string
  state?: string
  streamable: boolean
  downloadable: boolean
  download_count?: number
  has_downloads_left?: boolean
  commentable?: boolean
  comment_count: number
  playback_count: number
  likes_count: number
  reposts_count: number
  embeddable_by?: string
  purchase_title?: string | null
  purchase_url?: string | null
  media: {
    transcodings: Transcoding[]
  }
  monetization_model: string | null
  policy: TrackPolicy
  access: { play?: boolean; preview?: boolean; item?: string } | null
  track_authorization?: string
  secret_token?: string
  station_permalink?: string
  station_urn?: string
  publisher_metadata?: {
    artist?: string | null
    album_title?: string | null
    upc?: string | null
    isrc?: string | null
  } | null
}

export interface TrackStub {
  id: number
  kind: 'track'
  title?: null
  monetization_model?: string | null
  policy?: string | null
}

export interface PlaylistSummary {
  id: number
  kind: 'playlist' | 'album'
  title: string
  duration?: number
  track_count?: number
  user: User
  user_id?: number
  artwork_url: string | null
  permalink_url: string
  permalink?: string
  uri?: string
  urn?: string
  is_album?: boolean
  set_type?: string
  managed_by_feeds?: boolean
  created_at?: string
  display_date?: string
  published_at?: string
  release_date?: string | null
  last_modified?: string
  likes_count?: number
  reposts_count?: number
  public?: boolean
  sharing?: string
  secret_token?: string
}

export type SelectionItem = PlaylistSummary

export interface Playlist extends PlaylistSummary {
  description: string | null
  genre?: string | null
  tag_list?: string
  label_name?: string | null
  license?: string
  tracks: (Track | TrackStub)[]
  comment_count?: number
  playback_count?: number
}

export interface Comment {
  id: number
  kind: 'comment'
  body: string
  created_at: string
  timestamp: number
  track_id: number
  user_id: number
  user: User
  self?: { urn: string }
}

export interface ChartItem {
  score: number
  track: Track
}

export interface Selection {
  id: string
  kind: string
  title: string
  description?: string
  style?: string
  tracking_feature_name?: string
  urn: string
  query_urn?: string
  items: {
    collection: SelectionItem[]
    next_href?: string | null
  }
}

export interface SearchResponse<T> {
  collection: T[]
  next_href: string | null
  total_results?: number | null
  query_urn?: string
}

export interface QuerySuggestion {
  output: string
  query?: string
}

export interface StreamUrlEnvelope {
  url: string
}

export interface DownloadUrlEnvelope {
  download_url: string
}

export type Searchable = Track | Playlist | User

export function isTrack(item: unknown): item is Track {
  return (item as { kind?: string }).kind === 'track' && typeof (item as Track).duration === 'number'
}

export function isPlaylist(item: unknown): item is Playlist {
  return (item as { kind?: string }).kind === 'playlist' || (item as { kind?: string }).kind === 'album'
}

export function isPlaylistSummary(item: unknown): item is PlaylistSummary {
  const kind = (item as { kind?: string }).kind
  return kind === 'playlist' || kind === 'album'
}

export function isUser(item: unknown): item is User {
  return (item as { kind?: string }).kind === 'user'
}

export function isTrackStub(track: Track | TrackStub): track is TrackStub {
  return typeof (track as Track).title !== 'string'
}
