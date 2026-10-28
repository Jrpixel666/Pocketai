import React from 'react';
import {waitFor} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';

import {PalsScreen} from '../PalsScreen';

import {authService, syncService} from '../../../services';
import {palStore} from '../../../store';
import {createPal} from '../../../../jest/fixtures/pals';

describe('PalsScreen with PalsHub switched off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authService.isAuthenticated = false;
    palStore.pals = [];
    palStore.cachedPalsHubPals = [];
    palStore.userLibrary = [];
    palStore.userCreatedPals = [];
  });

  it('hides every PalsHub control and makes no hub calls', async () => {
    const {queryByTestId, getByTestId} = render(<PalsScreen />, {
      withNavigation: true,
      withSafeArea: true,
      withBottomSheetProvider: true,
    });

    expect(queryByTestId('compact-auth-bar')).toBeNull();
    expect(queryByTestId('expandable-search')).toBeNull();
    expect(queryByTestId('filter-chip-all')).toBeNull();
    expect(queryByTestId('bottom-action-search')).toBeNull();
    expect(queryByTestId('bottom-action-profile')).toBeNull();
    expect(getByTestId('pals-flat-list')).toBeTruthy();

    await waitFor(() => {
      expect(palStore.searchPalsHubPals).not.toHaveBeenCalled();
      expect(syncService.needsSync).not.toHaveBeenCalled();
    });
  });

  it('still lists local pals', () => {
    palStore.pals = [createPal({name: 'My Local Pal'})];

    const {getByText} = render(<PalsScreen />, {
      withNavigation: true,
      withSafeArea: true,
      withBottomSheetProvider: true,
    });

    expect(getByText('My Local Pal')).toBeTruthy();
  });
});
