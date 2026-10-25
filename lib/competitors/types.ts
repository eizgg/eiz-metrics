export interface CompetitorPost {
  externalId: string
  type: string // reel | image | carousel | video | short
  publishedAt: string
  likes: number
  comments: number
  views: number | null
  caption: string | null
  // Opcionales (los trae Scrape Creators para TikTok; Business Discovery / YouTube no los tienen)
  url?: string | null
  shares?: number | null
  saves?: number | null
  durationSeconds?: number | null
  sound?: 'propio' | 'de_otro' | 'tema' | null
}

export interface CompetitorFetch {
  followers: number | null
  mediaCount: number | null
  posts: CompetitorPost[]
  externalId: string | null
}

export interface CompetitorSnapshotInput extends CompetitorFetch {
  postsPerWeek: number | null
  avgEngagementRate: number | null
}
