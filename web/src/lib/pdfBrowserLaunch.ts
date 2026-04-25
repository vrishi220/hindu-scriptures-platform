const envExecutableKeys = [
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  "CHROME_BIN",
  "CHROMIUM_PATH",
] as const;

const platformExecutableDefaults: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ],
};

export const getPdfBrowserExecutableCandidates = (
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env
): string[] => {
  const envCandidates = envExecutableKeys
    .map((key) => env[key])
    .filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  return [...envCandidates, ...(platformExecutableDefaults[platform] || [])];
};

export const canUseSparticuzChromium = (platform: string = process.platform): boolean => platform === "linux";