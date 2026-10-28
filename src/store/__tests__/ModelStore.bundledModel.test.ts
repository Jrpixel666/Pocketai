jest.unmock('../../store');
import {runInAction} from 'mobx';
import {Platform} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {modelStore} from '..';

jest.mock('../../services/downloads', () => ({
  DownloadCancelledError: class extends Error {},
  downloadManager: {
    isDownloading: jest.fn().mockReturnValue(false),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(),
    setCallbacks: jest.fn(),
    syncWithActiveDownloads: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../services/deviceRules/rules', () => ({
  fetchRules: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/deviceRules/signals', () => ({
  readDeviceSignals: jest
    .fn()
    .mockResolvedValue({ramBytes: 8 * 1e9, socModel: 'SM8850'}),
}));

const FILE = 'Llama-3.2-1B-Instruct-abliterated.Q4_K_M.gguf';
const DEST = `/path/to/documents/models/local/${FILE}`;

const mocked = RNFS as unknown as Record<string, jest.Mock>;

describe('ModelStore.installBundledModel', () => {
  const originalOS = Platform.OS;
  const bundled = () => modelStore.models.filter(m => m.fullPath === DEST);

  beforeEach(() => {
    Platform.OS = 'android';
    jest.clearAllMocks();
    runInAction(() => {
      modelStore.models = [];
      modelStore.bundledModelInstalled = false;
    });
    mocked.existsAssets.mockResolvedValue(true);
    mocked.exists.mockResolvedValue(false);
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('copies the asset out and registers it once', async () => {
    await modelStore.installBundledModel();

    expect(mocked.copyFileAssets).toHaveBeenCalledWith(
      `models/${FILE}`,
      `${DEST}.part`,
    );
    expect(mocked.moveFile).toHaveBeenCalledWith(`${DEST}.part`, DEST);
    expect(bundled()).toHaveLength(1);
    expect(modelStore.bundledModelInstalled).toBe(true);

    await modelStore.installBundledModel();
    expect(mocked.copyFileAssets).toHaveBeenCalledTimes(1);
    expect(bundled()).toHaveLength(1);
  });

  it('reuses an already-copied file without copying again', async () => {
    mocked.exists.mockResolvedValue(true);

    await modelStore.installBundledModel();

    expect(mocked.copyFileAssets).not.toHaveBeenCalled();
    expect(bundled()).toHaveLength(1);
  });

  it('does nothing when the APK carries no bundled model', async () => {
    mocked.existsAssets.mockResolvedValue(false);

    await modelStore.installBundledModel();

    expect(mocked.copyFileAssets).not.toHaveBeenCalled();
    expect(bundled()).toHaveLength(0);
    expect(modelStore.bundledModelInstalled).toBe(false);
  });

  it('does nothing on iOS', async () => {
    Platform.OS = 'ios';

    await modelStore.installBundledModel();

    expect(mocked.existsAssets).not.toHaveBeenCalled();
    expect(bundled()).toHaveLength(0);
  });
});
