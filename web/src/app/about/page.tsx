import packageJson from "../../../package.json";
import AppBanner from "@/components/scriptle/AppBanner";

const sanitizeSha = (value: string) => value.trim().replace(/['"]/g, "");

const getVersionParts = (version: string) => {
  const parts = version.split(".");
  return { major: parts[0] || "0", minor: parts[1] || "0" };
};

const getBuildInfo = () => {
  const source =
    process.env.NEXT_PUBLIC_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER;
  if (!source) return { build: "0", isFallback: true };
  const digitsOnly = source.replace(/\D/g, "");
  if (!digitsOnly) return { build: "0", isFallback: true };
  return { build: digitsOnly, isFallback: false };
};

const getCommitSha = () => {
  const raw =
    process.env.NEXT_PUBLIC_GIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "local";
  return raw === "local" ? "local" : sanitizeSha(raw);
};

const formatVersion = () => {
  const rawVersion =
    process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || "0.1.0";
  const { major, minor } = getVersionParts(rawVersion);
  const { build } = getBuildInfo();
  const sha = getCommitSha();
  const shortSha = sha === "local" ? "local" : sha.slice(0, 7);
  return `${major}.${minor}.${build}.${shortSha}`;
};

const getVersionDetails = () => {
  const rawVersion =
    process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || "0.1.0";
  const { major, minor } = getVersionParts(rawVersion);
  const { build, isFallback } = getBuildInfo();
  const sha = getCommitSha();
  const shortSha = sha === "local" ? "local" : sha.slice(0, 7);
  return { major, minor, build, shortSha, isFallback };
};

export default function AboutPage() {
  const companyName =
    process.env.NEXT_PUBLIC_COMPANY_NAME || "Hindu Scriptures Platform";
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "Not set";
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE || "Not set";
  const contactAddress = process.env.NEXT_PUBLIC_CONTACT_ADDRESS || "Not set";
  const version = formatVersion();
  const { major, minor, build, shortSha, isFallback } = getVersionDetails();
  const year = new Date().getFullYear();

  return (
    <div data-scriptle="true">
      <AppBanner active="search" />
      <main className="page-shell">
        <header>
          <p className="page-eyebrow">About</p>
          <h1 className="page-h1">{companyName}</h1>
          <p className="page-lede">
            A living library of Hindu scriptures with deep search, multi-script
            translations, and community-tended commentary.
          </p>
        </header>

        <section className="page-grid cols-2">
          <div className="page-card">
            <h2 className="page-h2">Contact</h2>
            <dl className="page-dl">
              <div>
                <div className="page-dt">Email</div>
                <div>{contactEmail}</div>
              </div>
              <div>
                <div className="page-dt">Phone</div>
                <div>{contactPhone}</div>
              </div>
              <div>
                <div className="page-dt">Address</div>
                <div>{contactAddress}</div>
              </div>
            </dl>
          </div>

          <div className="page-card">
            <h2 className="page-h2">Version</h2>
            <dl className="page-dl">
              <div>
                <div className="page-dt">Full version</div>
                <div
                  className="page-mono"
                  title={
                    isFallback
                      ? "Build metadata unavailable (fallback)"
                      : undefined
                  }
                >
                  {version}
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <div>
                  <div className="page-dt">Release</div>
                  <div className="page-mono">
                    {major}.{minor}
                  </div>
                </div>
                <div>
                  <div className="page-dt">Build #</div>
                  <div className="page-mono">
                    {build}
                    {isFallback ? (
                      <span
                        aria-label="Build metadata fallback"
                        title="Build metadata unavailable (fallback)"
                        style={{ marginLeft: 6, opacity: 0.6 }}
                      >
                        ⚠
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div>
                <div className="page-dt">Commit SHA</div>
                <div className="page-mono">{shortSha}</div>
              </div>
              <div className="page-foot">
                © {year} {companyName}
              </div>
            </dl>
          </div>
        </section>
      </main>
    </div>
  );
}
