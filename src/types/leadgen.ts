export type OutreachStatus =
  | "new"
  | "contacted"
  | "replied"
  | "qualified"
  | "converted"
  | "rejected";

export type SearchStatus = "pending" | "running" | "completed" | "failed";
export type OutreachChannel = "email" | "dm_instagram" | "call" | "pec";
export type OutreachDirection = "outbound" | "inbound";

export type LeadgenMemberRole = "owner" | "admin" | "sales";
export type LeadgenMemberTeam = "internal" | "external";
export type LeadgenLeadVisibility = "team" | "internal_only" | "private";

export interface LeadgenMember {
  id: string;
  portal_id: string;
  user_id: string;
  role: LeadgenMemberRole;
  team: LeadgenMemberTeam;
  display_name: string | null;
  active: boolean;
  notes: string | null;
  added_at: string;
  added_by: string | null;
}

export interface LeadgenSettings {
  id: string;
  portal_id: string;
  apify_token: string | null;
  actor_id: string;
  default_country_code: string;
  default_language: string;
  default_max_places: number;
  scrape_contacts: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadgenSearch {
  id: string;
  portal_id: string;
  country_code: string;
  postal_code: string;
  category: string | null;
  categories: string[];
  status: SearchStatus;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  total_results: number;
  with_website: number;
  without_website: number;
  excluded_count: number;
  discarded_no_contact_count: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface LeadgenLead {
  id: string;
  portal_id: string;
  search_id: string | null;
  place_id: string;
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country_code: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  rating: number | null;
  reviews_count: number | null;
  emails: string[];
  social_media: Record<string, string>;
  has_website: boolean;
  assigned_to: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  visibility: LeadgenLeadVisibility;
  last_activity_at: string | null;
  outreach_status: OutreachStatus;
  outreach_notes: string | null;
  contacted_at: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadgenLeadNote {
  id: string;
  portal_id: string;
  lead_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

export interface LeadgenOutreachEvent {
  id: string;
  portal_id: string;
  lead_id: string;
  user_id: string | null;
  channel: OutreachChannel;
  direction: OutreachDirection;
  notes: string | null;
  occurred_at: string;
}

export type BlacklistRuleType = "title_keyword" | "website_domain" | "category" | "min_reviews";

export interface LeadgenBlacklist {
  id: string;
  portal_id: string;
  rule_type: BlacklistRuleType;
  rule_value: string;
  active: boolean;
  created_at: string;
}

// Shape returned by Apify Google Maps Scraper dataset items
export interface ApifyPlaceResult {
  placeId: string;
  title: string;
  address: string | null;
  zip: string | null;
  city: string | null;
  countryCode: string | null;
  phone: string | null;
  website: string | null;
  categoryName: string | null;
  categories?: string[] | null;
  totalScore: number | null;
  reviewsCount: number | null;
  emails: string[] | null;
  instagram: string | null;
  facebook: string | null;
  twitter: string | null;
  linkedin: string | null;
}
