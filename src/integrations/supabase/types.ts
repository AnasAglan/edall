export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      courses: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          image_url: string | null
          price: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          image_url?: string | null
          price?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          image_url?: string | null
          price?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          course_id: string
          enrolled_at: string
          id: string
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_attempts: {
        Row: {
          exam_id: string
          expires_at: string | null
          id: string
          result_id: string | null
          started_at: string
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          exam_id: string
          expires_at?: string | null
          id?: string
          result_id?: string | null
          started_at?: string
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          exam_id?: string
          expires_at?: string | null
          id?: string
          result_id?: string | null
          started_at?: string
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_attempts_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "exam_results"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          correct_option: number | null
          exam_id: string
          id: string
          options: Json | null
          sort_order: number
          text: string
          type: Database["public"]["Enums"]["question_type"]
        }
        Insert: {
          correct_option?: number | null
          exam_id: string
          id?: string
          options?: Json | null
          sort_order?: number
          text: string
          type?: Database["public"]["Enums"]["question_type"]
        }
        Update: {
          correct_option?: number | null
          exam_id?: string
          id?: string
          options?: Json | null
          sort_order?: number
          text?: string
          type?: Database["public"]["Enums"]["question_type"]
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_results: {
        Row: {
          answers: Json
          essay_graded: boolean
          exam_id: string
          has_essay: boolean
          id: string
          passed: boolean
          score: number
          submitted_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          essay_graded?: boolean
          exam_id: string
          has_essay?: boolean
          id?: string
          passed?: boolean
          score?: number
          submitted_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          essay_graded?: boolean
          exam_id?: string
          has_essay?: boolean
          id?: string
          passed?: boolean
          score?: number
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_results_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          allow_retake: boolean
          created_at: string
          id: string
          lesson_id: string
          max_attempts: number | null
          passing_grade: number
          required_to_progress: boolean
          time_limit: number | null
          title: string | null
        }
        Insert: {
          allow_retake?: boolean
          created_at?: string
          id?: string
          lesson_id: string
          max_attempts?: number | null
          passing_grade?: number
          required_to_progress?: boolean
          time_limit?: number | null
          title?: string | null
        }
        Update: {
          allow_retake?: boolean
          created_at?: string
          id?: string
          lesson_id?: string
          max_attempts?: number | null
          passing_grade?: number
          required_to_progress?: boolean
          time_limit?: number | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          course_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_files: {
        Row: {
          file_name: string
          file_url: string
          id: string
          lesson_id: string
          sort_order: number | null
        }
        Insert: {
          file_name: string
          file_url: string
          id?: string
          lesson_id: string
          sort_order?: number | null
        }
        Update: {
          file_name?: string
          file_url?: string
          id?: string
          lesson_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_files_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          exam_completed: boolean
          id: string
          lesson_id: string
          pdf_opened: boolean
          updated_at: string
          user_id: string
          video_watched: boolean
        }
        Insert: {
          exam_completed?: boolean
          id?: string
          lesson_id: string
          pdf_opened?: boolean
          updated_at?: string
          user_id: string
          video_watched?: boolean
        }
        Update: {
          exam_completed?: boolean
          id?: string
          lesson_id?: string
          pdf_opened?: boolean
          updated_at?: string
          user_id?: string
          video_watched?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_videos: {
        Row: {
          id: string
          lesson_id: string
          sort_order: number
          video_url: string
        }
        Insert: {
          id?: string
          lesson_id: string
          sort_order?: number
          video_url: string
        }
        Update: {
          id?: string
          lesson_id?: string
          sort_order?: number
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_videos_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          content: string | null
          course_id: string
          created_at: string
          id: string
          is_free: boolean
          sort_order: number
          title: string
        }
        Insert: {
          content?: string | null
          course_id: string
          created_at?: string
          id?: string
          is_free?: boolean
          sort_order?: number
          title: string
        }
        Update: {
          content?: string | null
          course_id?: string
          created_at?: string
          id?: string
          is_free?: boolean
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          title: string
          type?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          banned: boolean | null
          bio: string | null
          email: string
          id: string
          joined_at: string
          last_active: string | null
          name: string
          phone: string | null
          public_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          banned?: boolean | null
          bio?: string | null
          email: string
          id: string
          joined_at?: string
          last_active?: string | null
          name: string
          phone?: string | null
          public_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          banned?: boolean | null
          bio?: string | null
          email?: string
          id?: string
          joined_at?: string
          last_active?: string | null
          name?: string
          phone?: string | null
          public_id?: string | null
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_topup_contacts: {
        Row: {
          created_at: string
          id: string
          link: string | null
          phone: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          phone: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          phone?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          type?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _finalize_exam_attempt: {
        Args: { _answers: Json; _attempt_id: string }
        Returns: Json
      }
      abandon_exam_attempt: {
        Args: { _attempt_id: string }
        Returns: undefined
      }
      admin_credit_wallet: {
        Args: { _amount: number; _note?: string; _user_id: string }
        Returns: number
      }
      admin_search_users: {
        Args: { _limit?: number; _offset?: number; _term: string }
        Returns: {
          avatar_url: string
          balance: number
          email: string
          id: string
          name: string
          public_id: string
        }[]
      }
      can_access_lesson: { Args: { _lesson_id: string }; Returns: boolean }
      course_enrollees: {
        Args: { _course_id: string }
        Returns: {
          avatar_url: string
          email: string
          enrolled_at: string
          name: string
          public_id: string
          user_id: string
        }[]
      }
      course_student_progress: {
        Args: { _course_id: string; _user_id: string }
        Returns: Json
      }
      exam_grading_list: {
        Args: { _exam_id: string }
        Returns: {
          answers: Json
          essay_graded: boolean
          has_essay: boolean
          name: string
          passed: boolean
          public_id: string
          result_id: string
          score: number
          submitted_at: string
          user_id: string
        }[]
      }
      generate_public_id: { Args: never; Returns: string }
      get_active_exam_attempt: { Args: never; Returns: Json }
      get_course_creators_public: {
        Args: never
        Returns: {
          avatar_url: string
          bio: string
          id: string
          name: string
        }[]
      }
      get_courses_sorted_by_enrollment: {
        Args: { _limit: number; _offset: number }
        Returns: {
          created_at: string
          created_by: string
          description: string
          enrollment_count: number
          id: string
          image_url: string
          lesson_count: number
          price: number
          title: string
          updated_at: string
        }[]
      }
      get_exam_questions_safe: {
        Args: { _exam_id: string }
        Returns: {
          exam_id: string
          id: string
          options: Json
          sort_order: number
          text: string
          type: Database["public"]["Enums"]["question_type"]
        }[]
      }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      grade_exam_submission: {
        Args: { _answers: Json; _exam_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      purchase_course: { Args: { _course_id: string }; Returns: Json }
      search_teachers_public: {
        Args: { _term: string }
        Returns: {
          avatar_url: string
          email: string
          id: string
          name: string
        }[]
      }
      setup_new_user:
        | {
            Args: { _email: string; _name: string; _user_id: string }
            Returns: undefined
          }
        | {
            Args: {
              _email: string
              _name: string
              _requested_role?: string
              _user_id: string
            }
            Returns: undefined
          }
      start_exam_attempt: { Args: { _exam_id: string }; Returns: Json }
      submit_exam_attempt: {
        Args: { _answers: Json; _attempt_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "teacher" | "student"
      question_type: "multiple" | "essay"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "teacher", "student"],
      question_type: ["multiple", "essay"],
    },
  },
} as const
