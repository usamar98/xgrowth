export type Account = {
  id: string;
  username: string;
  name: string;
  blocked_until: number;
};
export type Draft = {
  id: string;
  account_id: string | null;
  text: string;
  pillar: string;
  status: "draft" | "planned" | "publishing" | "published" | "uncertain";
  planned_at: string | null;
  post_id: string | null;
  last_error: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type Preferences = {
  audience: string;
  topics: string;
  weekly_target: number;
  budget: number;
};
export type Workspace = {
  accounts: Account[];
  drafts: Draft[];
  settings: Preferences;
  usage: number;
  configured: boolean;
  missing: string[];
};
export type XPost = {
  id: string;
  text: string;
  created_at: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
};
export type Analytics = {
  accountId: string;
  fetchedAt: string;
  profile: {
    name: string;
    username: string;
    public_metrics?: { followers_count: number; tweet_count: number };
  };
  posts: XPost[];
};
