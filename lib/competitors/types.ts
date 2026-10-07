export interface CompetitorPost {
  externalId: string
  type: string // reel | image | carousel | video | short
  publishedAt: string
  likes: number
  comments: number
  views: number | null
  caption: string | null
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
