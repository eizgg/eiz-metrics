export interface AudienceSnapshot {
  platformAccountId: string
  recordedAt: string
  ageGender: Record<string, Record<string, number>> | null
  countries: Record<string, number> | null
  cities: Record<string, number> | null
  onlineHours: Record<string, number> | null
}
