export interface User {
  id: string;
  display_name?: string;
  avatar_url?: string;
  is_instructor: boolean;
  created_at: string;
}

export interface Credits {
  id: string;
  user_id: string;
  balance: number;
  updated_at: string;
}

export interface InstructorProfile extends User {}
