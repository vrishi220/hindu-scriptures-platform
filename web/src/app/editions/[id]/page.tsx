"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type SectionName = "front" | "body" | "back";

type EditionSnapshot = {
  id: number;
  draft_book_id: number;
  owner_id: number;
  version: number;
  snapshot_data: Record<string, unknown>;
  immutable: boolean;
  created_at: string;
};

type SnapshotRenderBlock = {
  section: SectionName;
  order: number;
  block_type: string;
  template_key: string;
  source_node_id: number | null;
  source_book_id: number | null;
  title: string;
  content: {
    level_name?: string;
    sequence_number?: number | null;
    sanskrit?: string;
    transliteration?: string;
    english?: string;
    text?: string;
    rendered_lines?: Array<{
      field?: string;
      label?: string;
      value?: string;
    }>;
  };
};

type SnapshotRenderSettings = {
  show_sanskrit: boolean;
  show_transliteration: boolean;
  show_english: boolean;
  show_metadata: boolean;
  text_order: Array<"sanskrit" | "transliteration" | "english" | "text">;
};

type SnapshotRenderArtifact = {
  snapshot_id: number;
  draft_book_id: number;
  version: number;
  section_order: SectionName[];
  sections: {
    front: SnapshotRenderBlock[];
    body: SnapshotRenderBlock[];
    back: SnapshotRenderBlock[];
  };
  render_settings: SnapshotRenderSettings;
  template_metadata?: {
    template_family: string;
    template_version: string;
    block_template_pattern: string;
    renderer: string;
    output_profile: string;
  };
};

type DraftProvenanceAppendixEntry = {
  section: SectionName;
  source_node_id: number;
  source_book_id?: number | null;
  title: string;
  source_author?: string | null;
  license_type: string;
  source_version: string;
};

const SECTION_LABELS: Record<SectionName, string> = {
  front: "Front Matter",
  body: "Body",
  back: "Back Matter",
};

const formatDate = (dateString: string) => {
  try {
    return new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
};

export default function PublishedEditionPage() {
  const params = useParams<{ id: string }>();
  const snapshotId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EditionSnapshot | null>(null);
  const [artifact, setArtifact] = useState<SnapshotRenderArtifact | null>(null);
  const [activeSection, setActiveSection] = useState<SectionName>("front");
  const sectionRefs = useRef<Record<SectionName, HTMLDivElement | null>>({
    front: null,
    body: null,
    back: null,
  });

  useEffect(() => {
    const loadPublishedEdition = async () => {
      setLoading(true);
      setError(null);

      try {
        const [snapshotResponse, artifactResponse] = await Promise.all([
          fetch(`/api/edition-snapshots/${snapshotId}`, {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(`/api/edition-snapshots/${snapshotId}/render-artifact`, {
            credentials: "include",
            cache: "no-store",
          }),
        ]);

        const snapshotPayload = (await snapshotResponse.json().catch(() => null)) as
          | EditionSnapshot
          | { detail?: string }
          | null;
        if (!snapshotResponse.ok) {
          throw new Error((snapshotPayload as { detail?: string } | null)?.detail || "Failed to load snapshot");
        }

        const artifactPayload = (await artifactResponse.json().catch(() => null)) as
          | SnapshotRenderArtifact
          | { detail?: string }
          | null;
        if (!artifactResponse.ok) {
          throw new Error((artifactPayload as { detail?: string } | null)?.detail || "Failed to load render artifact");
        }

        const resolvedSnapshot = snapshotPayload as EditionSnapshot;
        const resolvedArtifact = artifactPayload as SnapshotRenderArtifact;

        setSnapshot(resolvedSnapshot);
        setArtifact(resolvedArtifact);

        const firstNonEmpty = resolvedArtifact.section_order.find((section) =>
          (resolvedArtifact.sections[section] || []).length > 0
        );
        setActiveSection(firstNonEmpty || "front");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load published edition");
        setSnapshot(null);
        setArtifact(null);
      } finally {
        setLoading(false);
      }
    };

    if (snapshotId) {
      void loadPublishedEdition();
    }
  }, [snapshotId]);

  const appendixEntries = useMemo(() => {
    const raw = (snapshot?.snapshot_data?.provenance_appendix || null) as
      | { entries?: DraftProvenanceAppendixEntry[] }
      | null;
    const entries = raw?.entries;
    return Array.isArray(entries) ? entries : [];
  }, [snapshot]);

  const handleJumpToSection = (section: SectionName) => {
    setActiveSection(section);
    sectionRefs.current[section]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const resolveContentLines = (block: SnapshotRenderBlock, settings?: SnapshotRenderSettings) => {
    const resolvedSettings: SnapshotRenderSettings =
      settings || {
        show_sanskrit: true,
        show_transliteration: true,
        show_english: true,
        show_metadata: true,
        text_order: ["sanskrit", "transliteration", "english", "text"],
      };

    const visibleByKey: Record<string, boolean> = {
      sanskrit: resolvedSettings.show_sanskrit,
      transliteration: resolvedSettings.show_transliteration,
      english: resolvedSettings.show_english,
      text: true,
    };

    const lineClassNameForField = (fieldName: string) =>
      fieldName === "sanskrit"
        ? "text-base text-[color:var(--deep)]"
        : fieldName === "transliteration"
        ? "text-sm italic text-zinc-700"
        : "text-sm text-zinc-700";

    const lines: Array<{ key: string; label: string; value: string; className: string }> = [];
    const renderedLines = Array.isArray(block.content.rendered_lines) ? block.content.rendered_lines : [];
    if (renderedLines.length > 0) {
      for (let index = 0; index < renderedLines.length; index += 1) {
        const line = renderedLines[index];
        const value = (line?.value || "").trim();
        if (!value) {
          continue;
        }

        const fieldName = (line?.field || "text").trim().toLowerCase();
        if (fieldName in visibleByKey && !visibleByKey[fieldName]) {
          continue;
        }

        lines.push({
          key: `${fieldName || "line"}-${index}`,
          label: (line?.label || "").trim(),
          value,
          className: lineClassNameForField(fieldName),
        });
      }

      if (lines.length > 0) {
        return lines;
      }
    }

    for (const key of resolvedSettings.text_order) {
      const value = (block.content[key] || "").trim();
      if (!value || !visibleByKey[key]) {
        continue;
      }

      const label =
        key === "sanskrit"
          ? "Sanskrit"
          : key === "transliteration"
          ? "Transliteration"
          : key === "english"
          ? "English"
          : "Text";

      const className = lineClassNameForField(key);

      lines.push({ key, label, value, className });
    }

    if (lines.length === 0) {
      const fallback = (block.content.text || "").trim();
      if (fallback) {
        lines.push({ key: "text", label: "Text", value: fallback, className: "text-sm text-zinc-700" });
      }
    }

    return lines;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[color:var(--sand)] via-white to-[color:var(--sand)]">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)] sm:text-5xl">Published Edition</h1>
            {snapshot && (
              <p className="mt-2 text-sm text-zinc-600">
                Snapshot v{snapshot.version} • Created {formatDate(snapshot.created_at)}
              </p>
            )}
            {artifact?.template_metadata && (
              <p className="mt-1 text-xs text-zinc-500">
                Template {artifact.template_metadata.template_family}.{artifact.template_metadata.template_version} • {artifact.template_metadata.output_profile}
              </p>
            )}
          </div>
          {snapshot && (
            <div className="flex items-center gap-2">
              <a
                href={`/api/edition-snapshots/${snapshot.id}/export/pdf`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Download PDF
              </a>
              <a
                href="/drafts"
                className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Back to Drafts
              </a>
            </div>
          )}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-black/10 bg-white/85 p-6 text-sm text-zinc-600">Loading published edition…</div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            <div>{error}</div>
            <div className="mt-1 text-xs text-rose-600">
              Unpublished drafts are not accessible from viewer routes.
            </div>
          </div>
        ) : !snapshot || !artifact ? (
          <div className="rounded-2xl border border-black/10 bg-white/85 p-6 text-sm text-zinc-600">Edition snapshot is unavailable.</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-black/10 bg-white/85 p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Section Navigation</div>
              <div className="flex flex-wrap gap-2">
                {artifact.section_order.map((section) => {
                  const count = artifact.sections[section].length;
                  return (
                    <button
                      key={section}
                      type="button"
                      onClick={() => handleJumpToSection(section)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        activeSection === section
                          ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-white"
                          : "border-black/10 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {SECTION_LABELS[section]} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {artifact.section_order.map((section) => {
              const blocks = artifact.sections[section] || [];
              return (
                <div
                  key={section}
                  ref={(element) => {
                    sectionRefs.current[section] = element;
                  }}
                  className="rounded-2xl border border-black/10 bg-white/85 p-4"
                >
                  <h2 className="mb-3 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">{SECTION_LABELS[section]}</h2>
                  {blocks.length === 0 ? (
                    <p className="text-sm text-zinc-500">No items in this section.</p>
                  ) : (
                    <div className="space-y-2">
                      {blocks.map((block) => (
                        <div key={`${section}-${block.order}-${block.title}`} className="rounded-lg border border-black/10 bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-black/10 bg-white px-2 py-1 text-xs text-zinc-600">
                              #{block.order}
                            </span>
                            <span className="text-sm font-medium text-zinc-800">{block.title}</span>
                          </div>

                          {resolveContentLines(block, artifact.render_settings).length > 0 && (
                            <div className="mt-2 space-y-2">
                              {resolveContentLines(block, artifact.render_settings).map((line) => (
                                <div key={`${block.order}-${line.key}`}>
                                  {line.label && <div className="text-[11px] uppercase tracking-wider text-zinc-500">{line.label}</div>}
                                  <div className={`whitespace-pre-wrap ${line.className}`}>{line.value}</div>
                                </div>
                              ))}
                            </div>
                          )}

                          {artifact.render_settings.show_metadata && (
                            <div className="mt-2 text-xs text-zinc-500">
                              template: {block.template_key}
                              {typeof block.source_node_id === "number" ? ` • source node ${block.source_node_id}` : ""}
                              {typeof block.content.sequence_number === "number"
                                ? ` • seq ${block.content.sequence_number}`
                                : ""}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="rounded-2xl border border-black/10 bg-white/85 p-4">
              <h2 className="mb-3 font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                Provenance Appendix
              </h2>
              {appendixEntries.length === 0 ? (
                <p className="text-sm text-zinc-500">No provenance appendix entries available for this snapshot.</p>
              ) : (
                <div className="space-y-2">
                  {appendixEntries.map((entry, index) => (
                    <div key={`${entry.source_node_id}-${index}`} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700">
                      <div>
                        {entry.section} • {entry.title} (node {entry.source_node_id})
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {entry.license_type} • {entry.source_version}
                        {entry.source_author ? ` • ${entry.source_author}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
