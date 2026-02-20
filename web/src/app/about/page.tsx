import packageJson from "../../../package.json";

const getVersionParts = (version: string) => {
  const parts = version.split(".");
  const major = parts[0] || "0";
  const minor = parts[1] || "0";
  return { major, minor };
};

const getBuildNumber = () => {
  return (
    process.env.NEXT_PUBLIC_BUILD_NUMBER ||
    process.env.GITHUB_RUN_NUMBER ||
    process.env.VERCEL_BUILD_ID ||
    "0"
  );
};

const getCommitSha = () => {
  return (
    process.env.NEXT_PUBLIC_GIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "local"
  );
};

const formatVersion = () => {
  const rawVersion =
    process.env.NEXT_PUBLIC_APP_VERSION ||
    packageJson.version ||
    "0.1.0";
  const { major, minor } = getVersionParts(rawVersion);
  const build = getBuildNumber();
  const sha = getCommitSha();
  const shortSha = sha === "local" ? "local" : sha.slice(0, 7);

  return `${major}.${minor}.${build}.${shortSha}`;
};

const getVersionDetails = () => {
  const rawVersion =
    process.env.NEXT_PUBLIC_APP_VERSION ||
    packageJson.version ||
    "0.1.0";
  const { major, minor } = getVersionParts(rawVersion);
  const build = getBuildNumber();
  const sha = getCommitSha();
  const shortSha = sha === "local" ? "local" : sha.slice(0, 7);

  return { major, minor, build, shortSha };
};

export default function AboutPage() {
  const companyName =
    process.env.NEXT_PUBLIC_COMPANY_NAME || "Hindu Scriptures Platform";
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "Not set";
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE || "Not set";
  const contactAddress = process.env.NEXT_PUBLIC_CONTACT_ADDRESS || "Not set";
  const version = formatVersion();
  const { major, minor, build, shortSha } = getVersionDetails();
  const year = new Date().getFullYear();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 px-6 pb-16 pt-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
          About
        </p>
        <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)]">
          {companyName}
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600">
          A living library of Hindu scriptures with deep search, translations,
          and community contributions.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-white/80 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-[color:var(--deep)]">
            Contact
          </h2>
          <dl className="mt-4 space-y-3 text-sm text-zinc-600">
            <div className="flex flex-col">
              <dt className="text-xs uppercase tracking-wide text-zinc-400">
                Email
              </dt>
              <dd>{contactEmail}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs uppercase tracking-wide text-zinc-400">
                Phone
              </dt>
              <dd>{contactPhone}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs uppercase tracking-wide text-zinc-400">
                Address
              </dt>
              <dd>{contactAddress}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white/80 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-[color:var(--deep)]">
            Version
          </h2>
          <div className="mt-4 space-y-4 text-sm text-zinc-600">
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wide text-zinc-400">
                Full Version
              </span>
              <span className="font-mono text-base font-semibold text-[color:var(--deep)]">
                {version}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-wide text-zinc-400">
                  Release
                </span>
                <span className="font-mono text-[color:var(--deep)]">
                  {major}.{minor}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-wide text-zinc-400">
                  Build #
                </span>
                <span className="font-mono text-[color:var(--deep)]">
                  {build}
                </span>
              </div>
              <div className="col-span-2 flex flex-col">
                <span className="text-xs uppercase tracking-wide text-zinc-400">
                  Commit SHA
                </span>
                <span className="font-mono text-[color:var(--deep)]">
                  {shortSha}
                </span>
              </div>
            </div>
            <div className="flex flex-col pt-2 border-t border-black/5">
              <span className="text-xs uppercase tracking-wide text-zinc-400">
                Copyright
              </span>
              <span>Copyright © {year} {companyName}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
