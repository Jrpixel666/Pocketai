import {Platform} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {APP_BUILD_DATE, APP_BUILD_NUMBER, UPDATE_REPO} from '@env';

import NativeApkInstaller from '../specs/NativeApkInstaller';

// Builds published by .github/workflows/build-apk.yml: one release per run,
// tagged apk-build-<run number>, with the APK attached.
const BUILD_TAG = /^apk-build-(\d+)$/;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

export interface AvailableBuild {
  buildNumber: number;
  apkUrl: string;
  sizeBytes: number;
}

export const installedBuildNumber = (): number | null => {
  const value = Number(APP_BUILD_NUMBER);
  return Number.isInteger(value) && value > 0 ? value : null;
};

export const installedBuildDate = (): string | null =>
  typeof APP_BUILD_DATE === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(APP_BUILD_DATE)
    ? APP_BUILD_DATE
    : null;

const updateRepo = (): string | null =>
  typeof UPDATE_REPO === 'string' && REPO_NAME.test(UPDATE_REPO)
    ? UPDATE_REPO
    : null;

export const isAppUpdateSupported = (): boolean =>
  Platform.OS === 'android' && updateRepo() !== null;

export const isNewerThanInstalled = (build: AvailableBuild): boolean => {
  const installed = installedBuildNumber();
  return installed === null || build.buildNumber > installed;
};

export async function fetchLatestBuild(): Promise<AvailableBuild | null> {
  const repo = updateRepo();
  if (!repo) {
    return null;
  }
  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=30`,
    {headers: {Accept: 'application/vnd.github+json'}},
  );
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`);
  }
  const releases: unknown = await response.json();
  if (!Array.isArray(releases)) {
    throw new Error('Unexpected response from GitHub');
  }

  let latest: AvailableBuild | null = null;
  for (const release of releases) {
    const match =
      typeof release?.tag_name === 'string'
        ? BUILD_TAG.exec(release.tag_name)
        : null;
    if (!match || release.draft) {
      continue;
    }
    const apk = Array.isArray(release.assets)
      ? release.assets.find(
          (asset: any) =>
            typeof asset?.name === 'string' &&
            asset.name.endsWith('.apk') &&
            typeof asset.browser_download_url === 'string',
        )
      : undefined;
    if (!apk) {
      continue;
    }
    const buildNumber = Number(match[1]);
    if (!latest || buildNumber > latest.buildNumber) {
      latest = {
        buildNumber,
        apkUrl: apk.browser_download_url,
        sizeBytes: Number(apk.size) || 0,
      };
    }
  }
  return latest;
}

export async function downloadAndInstall(
  build: AvailableBuild,
  onProgress: (fraction: number) => void,
): Promise<void> {
  if (!NativeApkInstaller) {
    throw new Error('Installing updates is only supported on Android');
  }
  const dir = `${RNFS.CachesDirectoryPath}/updates`;
  // Old downloads are never needed again; clear them before fetching anew.
  if (await RNFS.exists(dir)) {
    await RNFS.unlink(dir);
  }
  await RNFS.mkdir(dir);
  const apkPath = `${dir}/PocketPal-build-${build.buildNumber}.apk`;

  const {promise} = RNFS.downloadFile({
    fromUrl: build.apkUrl,
    toFile: apkPath,
    progressInterval: 500,
    progress: ({bytesWritten, contentLength}) =>
      onProgress(contentLength > 0 ? bytesWritten / contentLength : 0),
  });
  const result = await promise;
  if (result.statusCode !== 200) {
    throw new Error(`Download failed with status ${result.statusCode}`);
  }
  await NativeApkInstaller.install(apkPath);
}
