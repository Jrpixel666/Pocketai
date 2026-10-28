import {Platform} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {
  downloadAndInstall,
  fetchLatestBuild,
  installedBuildNumber,
  isAppUpdateSupported,
  isNewerThanInstalled,
} from '../appUpdate';
import NativeApkInstaller from '../../specs/NativeApkInstaller';

jest.mock('../../specs/NativeApkInstaller', () => ({
  __esModule: true,
  default: {install: jest.fn().mockResolvedValue(undefined)},
}));

const mockedFs = RNFS as unknown as Record<string, jest.Mock>;

const release = (tag: string, assets: object[], extra: object = {}) => ({
  tag_name: tag,
  draft: false,
  assets,
  ...extra,
});
const apk = (n: number, size = 120_000_000) => ({
  name: `PocketPal-build-${n}.apk`,
  browser_download_url: `https://github.com/owner/repo/releases/download/apk-build-${n}/PocketPal-build-${n}.apk`,
  size,
});

const respond = (body: unknown, ok = true, status = 200) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
};

describe('appUpdate', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    jest.clearAllMocks();
  });

  it('reads the installed build number and repo from the build env', () => {
    expect(installedBuildNumber()).toBe(7);
    Platform.OS = 'android';
    expect(isAppUpdateSupported()).toBe(true);
    Platform.OS = 'ios';
    expect(isAppUpdateSupported()).toBe(false);
  });

  it('picks the highest-numbered build release that has an APK', async () => {
    respond([
      release('apk-build-9', [apk(9)]),
      release('apk-build-12', [{name: 'notes.txt', browser_download_url: 'x'}]),
      release('apk-build-11', [apk(11, 99)]),
      release('apk-build-13', [apk(13)], {draft: true}),
      release('v1.21.2', [apk(99)]),
    ]);

    const latest = await fetchLatestBuild();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/releases?per_page=30',
      expect.anything(),
    );
    expect(latest).toEqual({
      buildNumber: 11,
      apkUrl: apk(11).browser_download_url,
      sizeBytes: 99,
    });
  });

  it('returns null when no build has been published', async () => {
    respond([]);
    expect(await fetchLatestBuild()).toBeNull();
  });

  it('throws on an error response or an unexpected body', async () => {
    respond({message: 'rate limited'}, false, 403);
    await expect(fetchLatestBuild()).rejects.toThrow('GitHub returned 403');
    respond({message: 'not a list'});
    await expect(fetchLatestBuild()).rejects.toThrow('Unexpected response');
  });

  it('only offers builds newer than the installed one', () => {
    const at = (buildNumber: number) => ({
      buildNumber,
      apkUrl: '',
      sizeBytes: 0,
    });
    expect(isNewerThanInstalled(at(8))).toBe(true);
    expect(isNewerThanInstalled(at(7))).toBe(false);
    expect(isNewerThanInstalled(at(3))).toBe(false);
  });

  it('downloads into a fresh cache folder and hands the APK to the installer', async () => {
    mockedFs.exists.mockResolvedValueOnce(true);
    mockedFs.downloadFile.mockImplementationOnce(({progress}) => {
      progress({bytesWritten: 50, contentLength: 100});
      return {promise: Promise.resolve({statusCode: 200})};
    });
    const onProgress = jest.fn();

    await downloadAndInstall(
      {buildNumber: 11, apkUrl: 'https://example/apk', sizeBytes: 100},
      onProgress,
    );

    const path = '/path/to/caches/updates/PocketPal-build-11.apk';
    expect(mockedFs.unlink).toHaveBeenCalledWith('/path/to/caches/updates');
    expect(mockedFs.mkdir).toHaveBeenCalledWith('/path/to/caches/updates');
    expect(mockedFs.downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({fromUrl: 'https://example/apk', toFile: path}),
    );
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(NativeApkInstaller!.install).toHaveBeenCalledWith(path);
  });

  it('does not install a failed download', async () => {
    mockedFs.downloadFile.mockReturnValueOnce({
      promise: Promise.resolve({statusCode: 404}),
    });

    await expect(
      downloadAndInstall(
        {buildNumber: 11, apkUrl: 'https://example/apk', sizeBytes: 1},
        jest.fn(),
      ),
    ).rejects.toThrow('status 404');
    expect(NativeApkInstaller!.install).not.toHaveBeenCalled();
  });
});
