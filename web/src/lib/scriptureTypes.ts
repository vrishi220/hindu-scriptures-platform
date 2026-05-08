export type CanonicalUploadComplete = {
  upload_id?: string;
  canonical_json_url?: string;
  size_bytes?: number;
  detail?: string;
  error?: string;
};

export type ImportJobLifecycleStatus = "queued" | "running" | "succeeded" | "failed";

export type PersistedImportJobState = {
  jobId: string;
  status?: ImportJobLifecycleStatus | "uploading";
  progressMessage?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  canonicalJsonUrl?: string | null;
  fromUrlInput?: boolean;
};

export type MediaFile = {
  id: number;
  node_id: number;
  media_type: "image" | "audio" | "video" | string;
  url: string;
  metadata?: {
    content_type?: string;
    original_filename?: string;
    display_name?: string;
    asset_id?: number | string;
    asset_display_name?: string;
    size_bytes?: number;
    display_order?: number;
    is_default?: boolean;
    [key: string]: unknown;
  } | null;
  metadata_json?: {
    content_type?: string;
    original_filename?: string;
    display_name?: string;
    asset_id?: number | string;
    asset_display_name?: string;
    size_bytes?: number;
    display_order?: number;
    is_default?: boolean;
    [key: string]: unknown;
  } | null;
  created_at?: string | null;
};

export type MediaAsset = {
  id: number;
  media_type: "image" | "audio" | "video" | string;
  url: string;
  metadata?: {
    content_type?: string;
    original_filename?: string;
    display_name?: string;
    size_bytes?: number;
    [key: string]: unknown;
  } | null;
  created_by?: number | null;
  created_at?: string | null;
};

export type MediaLinkContext = "bank" | "node" | "book";

export type BookMediaItem = {
  media_type: "image" | "audio" | "video" | "link" | string;
  url: string;
  display_name?: string;
  content_type?: string;
  asset_id?: number | string;
  size_bytes?: number | string;
  replaced_at?: string;
  is_default?: boolean;
  display_order?: number | string;
};

export type SharePermission = "viewer" | "contributor" | "editor";

export type BookMetadata = Record<string, unknown> & {
  owner_id?: number | string | null;
  visibility?: "private" | "public" | string;
};

export type BookSchema = {
  id: number;
  name?: string;
  levels: string[];
  level_template_defaults?: Record<string, number | string | null>;
};

export type BookOption = {
  id: number;
  book_name: string;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  title_english?: string | null;
  has_content?: boolean;
  content_data?: {
    basic?: {
      sanskrit?: string;
      transliteration?: string;
      translation?: string;
    };
    translations?: Record<string, string>;
  } | null;
  status?: string;
  visibility?: "private" | "public" | string;
  metadata?: BookMetadata | null;
  metadata_json?: BookMetadata | null;
  schema?: BookSchema | null;
  variant_authors?: Record<string, string>;
  level_name_overrides?: Record<string, string> | null;
};

export type BookDetails = BookOption & {
  schema: BookSchema;
};

export type SchemaOption = {
  id: number;
  name: string;
  description?: string | null;
  levels: string[];
};

export type BookShare = {
  id: number;
  shared_with_user_id: number;
  shared_with_email: string;
  shared_with_username?: string | null;
  shared_with_is_active?: boolean;
  permission: SharePermission;
};

export type OwnedBookSummary = {
  id: number;
  book_name: string;
  book_code?: string | null;
  visibility: "private" | "public";
  status: "draft" | "published";
};

export type BookOwnershipTransferResponse = {
  source_user_id: number;
  target_user_id: number;
  target_email: string;
  transferred_book_ids: number[];
  transferred_count: number;
};

export type ShareDialogLinkOption = {
  key: string;
  label: string;
  url: string;
  emailSubject: string;
  emailBody: string;
  target: "book" | "node" | "leaf";
};

export type ShareDialogState = {
  bookId: string;
  bookName: string;
  visibility: "private" | "public";
  canManageShares: boolean;
  description: string;
  linkOptions: ShareDialogLinkOption[];
  privateAccessPath: string;
  privateCopyTarget: "book" | "node" | "leaf";
};

export type ImportResult = {
  success?: boolean;
  book_id?: number;
  nodes_created?: number;
  warnings?: string[];
  detail?: string;
  error?: string;
};

export type ImportJobStatus = {
  job_id?: string;
  status?: ImportJobLifecycleStatus;
  progress_message?: string | null;
  progress_current?: number | null;
  progress_total?: number | null;
  detail?: string;
  error?: string;
  result?: ImportResult | null;
};

export type CanonicalUploadInit = {
  upload_id?: string;
  chunk_size_bytes?: number;
  max_size_bytes?: number;
  detail?: string;
  error?: string;
};

export type CanonicalUploadChunk = {
  upload_id?: string;
  received_bytes?: number;
  next_index?: number;
  detail?: string;
  error?: string;
};

export type ImportJobStart = {
  job_id?: string;
  status?: ImportJobLifecycleStatus;
  detail?: string;
  error?: string;
};

export type ImportResultDialogState = {
  bookName: string;
  status: "completed" | "error";
  nodesCreated: number | null;
  reason: string;
};

export type CommentaryEntry = {
  id: number;
  node_id: number;
  author_id?: number | null;
  work_id?: number | null;
  content_text: string;
  language_code: string;
  display_order: number;
  metadata?: {
    [key: string]: unknown;
  } | null;
  created_at?: string | null;
};

export type CommentaryDisplayItem = {
  id: number | string;
  author: string;
  text: string;
};

export type AuthorVariantDraft = {
  author_slug: string;
  author: string;
  language: string;
  field: string;
  text: string;
};

export type NodeComment = {
  id: number;
  node_id: number;
  parent_comment_id?: number | null;
  content_text: string;
  language_code: string;
  metadata?: {
    [key: string]: unknown;
  } | null;
  created_by?: number | null;
  created_at?: string | null;
};

export type BookPreviewBlock = {
  section: "body";
  order: number;
  block_type: string;
  template_key: string;
  source_node_id: number | null;
  source_book_id: number | null;
  title: string;
  content: {
    level_name?: string;
    sequence_number?: string | number | null;
    sanskrit?: string;
    transliteration?: string;
    english?: string;
    translations?: Record<string, string>;
    translation_variants?: Array<{
      author_slug?: string;
      author?: string;
      language?: string;
      field?: string;
      text?: string;
    }>;
    commentary_variants?: Array<{
      author_slug?: string;
      author?: string;
      language?: string;
      field?: string;
      text?: string;
    }>;
    text?: string;
    rendered_lines?: Array<{
      field?: string;
      label?: string;
      value?: string;
    }>;
    word_meanings_rows?: Array<{
      id?: string;
      order?: number;
      source?: {
        language?: string | null;
        script_text?: string | null;
        transliteration?: Record<string, string | null | undefined> | null;
      };
      resolved_source?: {
        text?: string;
        mode?: string | null;
        scheme?: string | null;
        generated?: boolean;
      };
      resolved_meaning?: {
        language?: string | null;
        text?: string;
        fallback_used?: boolean;
        fallback_badge_visible?: boolean;
      };
    }>;
    word_meanings?: {
      rows?: Array<{
        id?: string;
        order?: number;
        source?: {
          language?: string | null;
          script_text?: string | null;
          transliteration?: Record<string, string | null | undefined> | null;
        };
        meanings?: Record<string, { text?: string } | null>;
      }>;
    };
    media_items?: Array<{
      id?: number | null;
      media_type?: string;
      url?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
};

export type BookPreviewRenderSettings = {
  show_sanskrit: boolean;
  show_transliteration: boolean;
  show_english: boolean;
  show_metadata: boolean;
  show_media: boolean;
  text_order: Array<"sanskrit" | "transliteration" | "english" | "text">;
};

export type BookPreviewLanguageSettings = {
  show_sanskrit: boolean;
  show_transliteration: boolean;
  show_english: boolean;
  show_commentary: boolean;
};

export type BookPreviewArtifact = {
  book_id: number;
  book_name: string;
  preview_scope?: "book" | "node";
  root_node_id?: number | null;
  root_title?: string | null;
  reader_hierarchy_path?: string | null;
  section_order: Array<"body">;
  sections: {
    body: BookPreviewBlock[];
  };
  book_media_items?: BookMediaItem[];
  book_template?: {
    template_key: string;
    resolved_template_source: string;
    rendered_text: string;
    child_count: number;
  };
  render_settings: BookPreviewRenderSettings;
  warnings?: string[];
  offset?: number;
  limit?: number;
  total_blocks?: number;
  has_more?: boolean;
};

export type BasketItem = {
  cart_item_id?: number;
  node_id: number;
  title?: string;
  content?: string;
  breadcrumb?: string;
  order: number;
  book_name?: string;
  level_name?: string;
};

export type MetadataCategory = {
  id: number;
  name: string;
  description?: string | null;
  applicable_scopes: string[];
  is_deprecated: boolean;
};

export type EffectivePropertyBinding = {
  property_internal_name: string;
  property_display_name: string;
  property_data_type: "text" | "boolean" | "number" | "dropdown" | "date" | "datetime";
  description?: string | null;
  default_value?: unknown;
  is_required?: boolean;
  dropdown_options?: string[] | null;
};

export type CategoryEffectiveProperties = {
  category_id: number;
  category_name: string;
  properties: EffectivePropertyBinding[];
};

export type ResolvedPropertyValue = {
  property_internal_name: string;
  property_data_type: string;
  value: unknown;
};

export type ResolvedMetadata = {
  category_id: number | null;
  property_overrides: Record<string, unknown>;
  properties: ResolvedPropertyValue[];
};

export type PropertiesScope = "book" | "node";

export type TreeNode = {
  id: number;
  parent_node_id?: number | null;
  level_name: string;
  level_order?: number | null;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_hindi?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  has_content?: boolean | null;
  children?: TreeNode[];
};

export type NodeContent = {
  id: number;
  parent_node_id?: number | null;
  level_name: string;
  level_order?: number | null;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_hindi?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  has_content?: boolean | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
  content_data?: {
    basic?: {
      sanskrit?: string | null;
      transliteration?: string | null;
      translation?: string | null;
      [key: string]: unknown;
    } | null;
    translations?: Record<string, string> | null;
    word_meanings?: {
      version?: string;
      rows?: Array<{
        id?: string;
        order?: number;
        source?: {
          language?: string;
          script_text?: string;
          transliteration?: {
            iast?: string;
            [key: string]: string | undefined;
          };
        };
        meanings?: Record<string, { text?: string }>;
      }>;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

export type LevelTemplateOption = {
  id: number;
  name: string;
  target_schema_id?: number | null;
  target_level?: string | null;
  visibility: "private" | "published";
  is_system?: boolean;
  system_key?: string | null;
  current_version: number;
  is_active: boolean;
};

export type LevelTemplateAssignment = {
  id: number;
  entity_type: string;
  entity_id: number;
  level_key: string;
  template_id: number;
  is_active: boolean;
};
