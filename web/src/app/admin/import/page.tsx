"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Schema {
  id: number;
  name: string;
  levels: string[];
}

interface FieldMapping {
  selector: string;
  attribute?: string;
  selector_multiple?: boolean;
  join_with?: string;
}

interface LevelRule {
  level_name: string;
  selector: string;
  sequence_number?: string;
  fields?: Record<string, string>;
  field_mappings?: Record<string, FieldMapping>;
  has_content: boolean;
  content_mapping?: Record<string, string>;
  children?: LevelRule[];
}

interface ExtractionRules {
  url: string;
  format: string;
  hierarchy: LevelRule[];
}

interface PDFExtractionRule {
  level_name: string;
  chapter_pattern?: string;
  verse_pattern?: string;
  has_content: boolean;
}

interface PDFImportConfig {
  book_name: string;
  book_code?: string;
  schema_id: number;
  language_primary: string;
  source_attribution?: string;
  original_source_url?: string;
  pdf_file_path: string;
  extraction_rules: PDFExtractionRule[];
  import_type: "pdf";
}

interface HTMLImportConfig {
  book_name: string;
  book_code?: string;
  schema_id: number;
  language_primary: string;
  license_type: string;
  source_attribution?: string;
  original_source_url?: string;
  extraction_rules: ExtractionRules;
  import_type: "html";
}

type ImportConfig = PDFImportConfig | HTMLImportConfig;

interface ImportResponse {
  success: boolean;
  book_id?: number;
  nodes_created: number;
  warnings: string[];
  error?: string;
}

// Predefined extraction rules for known sources
const PREDEFINED_HTML_RULES: Record<string, ExtractionRules> = {
  sanskritdocuments_gita: {
    url: "https://sanskritdocuments.org/doc_giitaa/bhagvadnew.html",
    format: "html",
    hierarchy: [
      {
        level_name: "Adhyaya",
        selector: "h2",  // Chapters are h2 headers containing "अध्यायः"
        sequence_number: "", // Will extract from title text (e.g., "अथ प्रथमोऽध्यायः")
        fields: {
          title_sanskrit: "h2",  // Full text like "अथ प्रथमोऽध्यायः ।   अर्जुनविषादयोगः"
        },
        has_content: false,
        children: [
          {
            level_name: "Shloka",
            selector: "p",  // Verses appear in paragraphs, extract from any siblings
            sequence_number: "", // Will extract verse numbers from text (१-१॥)
            fields: {
              title_transliteration: "p",
            },
            has_content: true,
            content_mapping: {
              "basic.text": "p",  // Store full paragraph as content
            },
          },
        ],
      },
    ],
  },
};

const PREDEFINED_PDF_RULES: Record<string, PDFExtractionRule[]> = {
  sanskritdocuments_gita: [
    {
      level_name: "Adhyaya",
      chapter_pattern: undefined,
      verse_pattern: "॥(\\d+)-(\\d+)॥",
      has_content: false,
    },
  ],
};

export default function AdminImportPage() {
  const router = useRouter();
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ImportResponse | null>(null);
  const [importType, setImportType] = useState<"pdf" | "html">("pdf");

  // PDF form state
  const [pdfConfig, setPdfConfig] = useState<PDFImportConfig>({
    book_name: "Bhagavad Gita",
    book_code: "bhagavad-gita",
    schema_id: 0,
    language_primary: "sanskrit",
    source_attribution: "SanskritDocuments.org",
    original_source_url: "https://sanskritdocuments.org/doc_giitaa/bhagvadnew.pdf",
    pdf_file_path: "https://sanskritdocuments.org/doc_giitaa/bhagvadnew.pdf",
    extraction_rules: PREDEFINED_PDF_RULES.sanskritdocuments_gita || [],
    import_type: "pdf",
  });

  // HTML form state
  const [htmlConfig, setHtmlConfig] = useState<HTMLImportConfig>({
    book_name: "",
    schema_id: 0,
    language_primary: "sanskrit",
    license_type: "CC-BY-SA-4.0",
    extraction_rules: {
      url: "",
      format: "html",
      hierarchy: [],
    },
    import_type: "html",
  });

  const [selectedPDFTemplate, setSelectedPDFTemplate] = useState<string>("");
  const [selectedHTMLTemplate, setSelectedHTMLTemplate] = useState<string>("");
  const [editingRules, setEditingRules] = useState(false);
  const [rulesJson, setRulesJson] = useState<string>(
    JSON.stringify(PREDEFINED_PDF_RULES.sanskritdocuments_gita, null, 2)
  );

  // Load schemas
  useEffect(() => {
    const loadSchemas = async () => {
      try {
        const response = await fetch("/api/content/schemas");
        if (!response.ok) throw new Error("Failed to load schemas");
        const data = await response.json();
        setSchemas(data);
        if (data.length > 0) {
          setPdfConfig((prev) => ({ ...prev, schema_id: data[0].id }));
          setHtmlConfig((prev) => ({ ...prev, schema_id: data[0].id }));
        }
      } catch (err) {
        setError(`Failed to load schemas: ${err}`);
      }
    };
    loadSchemas();
  }, []);

  const handlePDFTemplateSelect = (templateKey: string) => {
    const rules = PREDEFINED_PDF_RULES[templateKey];
    if (rules) {
      setSelectedPDFTemplate(templateKey);
      setPdfConfig((prev) => ({
        ...prev,
        extraction_rules: rules,
      }));
      setRulesJson(JSON.stringify(rules, null, 2));
    }
  };

  const handleHTMLTemplateSelect = (templateKey: string) => {
    const rules = PREDEFINED_HTML_RULES[templateKey];
    if (rules) {
      setSelectedHTMLTemplate(templateKey);
      setHtmlConfig((prev) => ({
        ...prev,
        extraction_rules: rules,
      }));
      setRulesJson(JSON.stringify(rules, null, 2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const config = importType === "pdf" ? pdfConfig : htmlConfig;

      if (!config.book_name) {
        throw new Error("Book name is required");
      }

      if (importType === "pdf") {
        const pdf = config as PDFImportConfig;
        if (!pdf.pdf_file_path) {
          throw new Error("PDF URL is required");
        }
        if (!pdf.schema_id || pdf.schema_id === 0) {
          throw new Error("Schema must be selected");
        }
        if (!pdf.extraction_rules || pdf.extraction_rules.length === 0) {
          throw new Error("Extraction rules are required");
        }
      } else {
        const html = config as HTMLImportConfig;
        if (!html.extraction_rules.url) {
          throw new Error("URL is required");
        }
        if (!html.extraction_rules.hierarchy || html.extraction_rules.hierarchy.length === 0) {
          throw new Error("Hierarchy rules are required");
        }
      }

      const response = await fetch("/api/content/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const result = (await response.json()) as ImportResponse;

      if (!response.ok) {
        throw new Error(result.error || "Import failed");
      }

      setSuccess(result);
      // Reset form
      if (importType === "pdf") {
        setPdfConfig({
          book_name: "",
          schema_id: schemas[0]?.id || 0,
          language_primary: "sanskrit",
          pdf_file_path: "",
          extraction_rules: PREDEFINED_PDF_RULES.sanskritdocuments_gita || [],
          import_type: "pdf",
        });
        setSelectedPDFTemplate("");
        setRulesJson(JSON.stringify(PREDEFINED_PDF_RULES.sanskritdocuments_gita, null, 2));
      } else {
        setHtmlConfig({
          book_name: "",
          schema_id: schemas[0]?.id || 0,
          language_primary: "sanskrit",
          license_type: "CC-BY-SA-4.0",
          extraction_rules: { url: "", format: "html", hierarchy: [] },
          import_type: "html",
        });
        setSelectedHTMLTemplate("");
        setRulesJson("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            Import Scripture Document
          </h1>
          <p className="text-slate-600">
            Import scripture texts from PDFs and HTML sources using configurable extraction rules
          </p>
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="text-red-800">{error}</div>
          </div>
        )}

        {success && (
          <div
            className={`${
              success.success ? "bg-green-50" : "bg-yellow-50"
            } border ${
              success.success ? "border-green-200" : "border-yellow-200"
            } rounded-lg p-4 mb-6`}
          >
            <div
              className={`${
                success.success ? "text-green-800" : "text-yellow-800"
              } font-semibold`}
            >
              {success.success ? "✓ Import Successful" : "⚠ Import Completed"}
            </div>
            <div
              className={`text-sm ${
                success.success ? "text-green-700" : "text-yellow-700"
              } mt-1`}
            >
              Book ID: {success.book_id} | Nodes Created: {success.nodes_created}
            </div>
            {success.warnings.length > 0 && (
              <div className="mt-2 text-sm space-y-1">
                {success.warnings.map((warning, idx) => (
                  <div key={idx} className="text-slate-700">
                    • {warning}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Import Type Tabs */}
        <div className="mb-6 border-b border-slate-200">
          <div className="flex gap-6">
            <button
              onClick={() => {
                setImportType("pdf");
                setEditingRules(false);
              }}
              className={`py-3 px-2 border-b-2 font-semibold transition ${
                importType === "pdf"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              📄 PDF Import
            </button>
            <button
              onClick={() => {
                setImportType("html");
                setEditingRules(false);
              }}
              className={`py-3 px-2 border-b-2 font-semibold transition ${
                importType === "html"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              🌐 HTML Import
            </button>
          </div>
        </div>

        {/* PDF Import Section */}
        {importType === "pdf" && (
          <>
            {/* PDF Templates */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                Quick Templates
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <button
                  onClick={() => handlePDFTemplateSelect("sanskritdocuments_gita")}
                  className={`p-4 border-2 rounded-lg transition-all ${
                    selectedPDFTemplate === "sanskritdocuments_gita"
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="font-semibold text-slate-900">
                    SanskritDocuments Gita
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    Bhagavad Gita PDF from sanskritdocuments.org
                  </div>
                </button>
              </div>
            </div>

            {/* PDF Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Basic Information */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Book Name *
                    </label>
                    <input
                      type="text"
                      value={pdfConfig.book_name}
                      onChange={(e) =>
                        setPdfConfig({
                          ...pdfConfig,
                          book_name: e.target.value,
                        })
                      }
                      placeholder="e.g., Bhagavad Gita"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Book Code
                    </label>
                    <input
                      type="text"
                      value={pdfConfig.book_code || ""}
                      onChange={(e) =>
                        setPdfConfig({
                          ...pdfConfig,
                          book_code: e.target.value,
                        })
                      }
                      placeholder="e.g., gita"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Schema *
                    </label>
                    <select
                      value={pdfConfig.schema_id}
                      onChange={(e) =>
                        setPdfConfig({
                          ...pdfConfig,
                          schema_id: parseInt(e.target.value),
                        })
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {schemas.map((schema) => (
                        <option key={schema.id} value={schema.id}>
                          {schema.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Primary Language
                    </label>
                    <select
                      value={pdfConfig.language_primary}
                      onChange={(e) =>
                        setPdfConfig({
                          ...pdfConfig,
                          language_primary: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="sanskrit">Sanskrit</option>
                      <option value="english">English</option>
                      <option value="hindi">Hindi</option>
                      <option value="tamil">Tamil</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Source Attribution
                    </label>
                    <input
                      type="text"
                      value={pdfConfig.source_attribution || ""}
                      onChange={(e) =>
                        setPdfConfig({
                          ...pdfConfig,
                          source_attribution: e.target.value,
                        })
                      }
                      placeholder="e.g., SanskritDocuments"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Original Source URL
                    </label>
                    <input
                      type="url"
                      value={pdfConfig.original_source_url || ""}
                      onChange={(e) =>
                        setPdfConfig({
                          ...pdfConfig,
                          original_source_url: e.target.value,
                        })
                      }
                      placeholder="https://..."
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* PDF Configuration */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">
                  PDF Configuration
                </h3>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    PDF URL or Path *
                  </label>
                  <input
                    type="text"
                    value={pdfConfig.pdf_file_path}
                    onChange={(e) =>
                      setPdfConfig({
                        ...pdfConfig,
                        pdf_file_path: e.target.value,
                      })
                    }
                    placeholder="https://example.com/scripture.pdf"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Extraction Rules (JSON) *
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditingRules(!editingRules)}
                      className="text-xs px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 transition"
                    >
                      {editingRules ? "Hide" : "Edit"}
                    </button>
                  </div>
                  {editingRules && (
                    <div className="space-y-2">
                      <textarea
                        value={rulesJson}
                        onChange={(e) => {
                          setRulesJson(e.target.value);
                          try {
                            const parsed = JSON.parse(e.target.value);
                            setPdfConfig({
                              ...pdfConfig,
                              extraction_rules: parsed,
                            });
                            setError(null);
                          } catch (err) {
                            // Only set error if user is done typing
                          }
                        }}
                        className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 font-mono text-sm ${
                          error?.includes("JSON")
                            ? "border-red-300 focus:ring-red-500"
                            : "border-slate-300 focus:ring-blue-500"
                        }`}
                        rows={10}
                        placeholder="Enter JSON extraction rules..."
                      />
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const parsed = JSON.parse(rulesJson);
                            setPdfConfig({
                              ...pdfConfig,
                              extraction_rules: parsed,
                            });
                            setEditingRules(false);
                            setError(null);
                          } catch (err) {
                            setError(`Invalid JSON: ${String(err)}`);
                          }
                        }}
                        className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                      >
                        Save Rules
                      </button>
                    </div>
                  )}
                  {!editingRules && rulesJson && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-xs text-slate-700 max-h-48 overflow-auto">
                      {rulesJson}
                    </div>
                  )}
                </div>

                <div className="text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded p-3">
                  <div className="font-semibold mb-1">Verse Pattern Help:</div>
                  <p>The regex pattern detects verse references in format like:</p>
                  <pre className="mt-1">
                    1-1|| (numeric) or १-१॥ (Devanagari)
                  </pre>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 rounded-lg transition"
                >
                  {loading ? "Importing..." : "Start PDF Import"}
                </button>
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-900 font-semibold py-3 rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}

        {/* HTML Import Section */}
        {importType === "html" && (
          <>
            {/* HTML Templates */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                Quick Templates
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <button
                  onClick={() =>
                    handleHTMLTemplateSelect("sanskritdocuments_gita")
                  }
                  className={`p-4 border-2 rounded-lg transition-all ${
                    selectedHTMLTemplate === "sanskritdocuments_gita"
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="font-semibold text-slate-900">
                    SanskritDocuments Gita
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    Bhagavad Gita from sanskritdocuments.org
                  </div>
                </button>
              </div>
            </div>

            {/* HTML Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Basic Information */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Book Name *
                    </label>
                    <input
                      type="text"
                      value={htmlConfig.book_name}
                      onChange={(e) =>
                        setHtmlConfig({
                          ...htmlConfig,
                          book_name: e.target.value,
                        })
                      }
                      placeholder="e.g., Bhagavad Gita"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Book Code
                    </label>
                    <input
                      type="text"
                      value={htmlConfig.book_code || ""}
                      onChange={(e) =>
                        setHtmlConfig({
                          ...htmlConfig,
                          book_code: e.target.value,
                        })
                      }
                      placeholder="e.g., gita"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Schema *
                    </label>
                    <select
                      value={htmlConfig.schema_id}
                      onChange={(e) =>
                        setHtmlConfig({
                          ...htmlConfig,
                          schema_id: parseInt(e.target.value),
                        })
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {schemas.map((schema) => (
                        <option key={schema.id} value={schema.id}>
                          {schema.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Primary Language
                    </label>
                    <select
                      value={htmlConfig.language_primary}
                      onChange={(e) =>
                        setHtmlConfig({
                          ...htmlConfig,
                          language_primary: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="sanskrit">Sanskrit</option>
                      <option value="english">English</option>
                      <option value="hindi">Hindi</option>
                      <option value="tamil">Tamil</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Source Attribution
                    </label>
                    <input
                      type="text"
                      value={htmlConfig.source_attribution || ""}
                      onChange={(e) =>
                        setHtmlConfig({
                          ...htmlConfig,
                          source_attribution: e.target.value,
                        })
                      }
                      placeholder="e.g., SanskritDocuments"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      License Type
                    </label>
                    <select
                      value={htmlConfig.license_type}
                      onChange={(e) =>
                        setHtmlConfig({
                          ...htmlConfig,
                          license_type: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="CC-BY-SA-4.0">CC-BY-SA-4.0</option>
                      <option value="CC-BY-4.0">CC-BY-4.0</option>
                      <option value="public-domain">Public Domain</option>
                      <option value="proprietary">Proprietary</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Extraction Rules */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">
                  Extraction Rules
                </h3>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Source URL *
                  </label>
                  <input
                    type="url"
                    value={htmlConfig.extraction_rules.url}
                    onChange={(e) =>
                      setHtmlConfig((prev) => ({
                        ...prev,
                        extraction_rules: {
                          ...prev.extraction_rules,
                          url: e.target.value,
                        },
                      }))
                    }
                    placeholder="https://example.com/scripture"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Hierarchy Rules (JSON) *
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditingRules(!editingRules)}
                      className="text-xs px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 transition"
                    >
                      {editingRules ? "Hide" : "Edit"}
                    </button>
                  </div>
                  {editingRules && (
                    <textarea
                      value={rulesJson}
                      onChange={(e) => {
                        setRulesJson(e.target.value);
                        try {
                          const parsed = JSON.parse(e.target.value);
                          setHtmlConfig((prev) => ({
                            ...prev,
                            extraction_rules: {
                              ...prev.extraction_rules,
                              hierarchy: parsed.hierarchy,
                            },
                          }));
                          setError(null);
                        } catch (err) {
                          // Only set error if user is done typing
                        }
                      }}
                      className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 font-mono text-sm ${
                        error?.includes("JSON")
                          ? "border-red-300 focus:ring-red-500"
                          : "border-slate-300 focus:ring-blue-500"
                      }`}
                      rows={12}
                      placeholder="Enter JSON extraction rules..."
                    />
                  )}
                  {!editingRules && rulesJson && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-xs text-slate-700 max-h-48 overflow-auto">
                      {rulesJson}
                    </div>
                  )}
                </div>

                <div className="text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded p-3">
                  <div className="font-semibold mb-1">JSON Schema:</div>
                  <pre className="whitespace-pre-wrap text-xs overflow-auto">
{JSON.stringify({
  url: "string",
  format: "html|xml|json",
  hierarchy: [{
    level_name: "string",
    selector: "CSS selector",
    has_content: "boolean",
    children: []
  }]
}, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 rounded-lg transition"
                >
                  {loading ? "Importing..." : "Start HTML Import"}
                </button>
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-900 font-semibold py-3 rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
