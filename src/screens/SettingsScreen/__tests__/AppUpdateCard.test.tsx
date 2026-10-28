import React from 'react';
import {Platform} from 'react-native';

import {render, fireEvent, waitFor} from '../../../../jest/test-utils';

import {AppUpdateCard} from '../AppUpdateCard';
import {
  downloadAndInstall,
  fetchLatestBuild,
} from '../../../services/appUpdate';

jest.mock('../../../services/appUpdate', () => ({
  ...jest.requireActual('../../../services/appUpdate'),
  fetchLatestBuild: jest.fn(),
  downloadAndInstall: jest.fn(),
}));

const fetchLatestBuildMock = fetchLatestBuild as jest.Mock;
const downloadAndInstallMock = downloadAndInstall as jest.Mock;

const build = {buildNumber: 9, apkUrl: 'https://example/apk', sizeBytes: 120e6};

describe('AppUpdateCard', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('renders nothing where updates are not supported', () => {
    Platform.OS = 'ios';
    const {queryByTestId} = render(<AppUpdateCard />);
    expect(queryByTestId('app-update-card')).toBeNull();
  });

  it('shows the installed build and reports when it is current', async () => {
    fetchLatestBuildMock.mockResolvedValue({...build, buildNumber: 7});
    const {getByTestId, getByText} = render(<AppUpdateCard />);

    expect(getByText('Installed: build 7')).toBeTruthy();
    expect(getByText('Built on 2026-10-28')).toBeTruthy();
    fireEvent.press(getByTestId('app-update-check'));

    await waitFor(() =>
      expect(getByText('You have the latest build.')).toBeTruthy(),
    );
  });

  it('offers a newer build and installs it in one tap', async () => {
    fetchLatestBuildMock.mockResolvedValue(build);
    downloadAndInstallMock.mockResolvedValue(undefined);
    const {getByTestId, getByText} = render(<AppUpdateCard />);

    fireEvent.press(getByTestId('app-update-check'));
    await waitFor(() =>
      expect(getByText('Build 9 is available (120 MB).')).toBeTruthy(),
    );

    fireEvent.press(getByTestId('app-update-install'));
    await waitFor(() =>
      expect(getByTestId('app-update-message').props.children).toMatch(
        /Confirm the install/,
      ),
    );
    expect(downloadAndInstallMock).toHaveBeenCalledWith(
      build,
      expect.any(Function),
    );
  });

  it('explains a failed check', async () => {
    fetchLatestBuildMock.mockRejectedValue(new Error('offline'));
    const {getByTestId, getByText} = render(<AppUpdateCard />);

    fireEvent.press(getByTestId('app-update-check'));

    await waitFor(() =>
      expect(getByText(/Couldn't check for updates/)).toBeTruthy(),
    );
  });

  it('keeps the install button available after a failed install', async () => {
    fetchLatestBuildMock.mockResolvedValue(build);
    downloadAndInstallMock.mockRejectedValue(new Error('disk full'));
    const {getByTestId, getByText} = render(<AppUpdateCard />);

    fireEvent.press(getByTestId('app-update-check'));
    await waitFor(() => expect(getByTestId('app-update-install')).toBeTruthy());
    fireEvent.press(getByTestId('app-update-install'));

    await waitFor(() =>
      expect(getByText(/Couldn't download or install/)).toBeTruthy(),
    );
    expect(getByTestId('app-update-install')).toBeTruthy();
  });
});
