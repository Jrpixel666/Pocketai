import React, {useContext, useEffect, useRef, useState} from 'react';
import {View} from 'react-native';

import {Button, Card, Text} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {t} from '../../locales';
import {L10nContext} from '../../utils';
import {formatBytes} from '../../utils/formatters';
import {
  AvailableBuild,
  downloadAndInstall,
  fetchLatestBuild,
  installedBuildDate,
  installedBuildNumber,
  isAppUpdateSupported,
  isNewerThanInstalled,
} from '../../services/appUpdate';

import {createStyles} from './styles';

type UpdateState =
  | {kind: 'idle'}
  | {kind: 'checking'}
  | {kind: 'upToDate'}
  | {kind: 'available'; build: AvailableBuild}
  | {kind: 'downloading'; build: AvailableBuild; percent: number}
  | {kind: 'installPrompted'}
  | {kind: 'checkFailed'}
  | {kind: 'installFailed'; build: AvailableBuild};

export const AppUpdateCard: React.FC = () => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const l10n = useContext(L10nContext);
  const copy = l10n.settings.appUpdate;
  const [state, setState] = useState<UpdateState>({kind: 'idle'});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!isAppUpdateSupported()) {
    return null;
  }

  const update = (next: UpdateState) => {
    if (mounted.current) {
      setState(next);
    }
  };

  const check = async () => {
    update({kind: 'checking'});
    try {
      const build = await fetchLatestBuild();
      update(
        build && isNewerThanInstalled(build)
          ? {kind: 'available', build}
          : {kind: 'upToDate'},
      );
    } catch {
      update({kind: 'checkFailed'});
    }
  };

  const install = async (build: AvailableBuild) => {
    update({kind: 'downloading', build, percent: 0});
    try {
      await downloadAndInstall(build, fraction =>
        update({
          kind: 'downloading',
          build,
          percent: Math.round(fraction * 100),
        }),
      );
      update({kind: 'installPrompted'});
    } catch {
      update({kind: 'installFailed', build});
    }
  };

  const installed = installedBuildNumber();
  const buildDate = installedBuildDate();
  const busy = state.kind === 'checking' || state.kind === 'downloading';

  const message = (() => {
    switch (state.kind) {
      case 'upToDate':
        return copy.upToDate;
      case 'available':
        return t(copy.available, {
          build: state.build.buildNumber,
          size: formatBytes(state.build.sizeBytes, 0),
        });
      case 'downloading':
        return t(copy.downloading, {percent: state.percent});
      case 'installPrompted':
        return copy.installPrompt;
      case 'checkFailed':
        return copy.checkFailed;
      case 'installFailed':
        return copy.installFailed;
      default:
        return null;
    }
  })();

  const installable =
    state.kind === 'available' ||
    state.kind === 'downloading' ||
    state.kind === 'installFailed'
      ? state.build
      : null;

  return (
    <Card elevation={0} style={styles.card} testID="app-update-card">
      <Card.Title title={copy.title} />
      <Card.Content>
        <View style={styles.settingItemContainer}>
          <Text variant="bodyMedium" testID="app-update-installed">
            {installed === null
              ? copy.localBuild
              : t(copy.installedBuild, {build: installed})}
          </Text>
          {buildDate && (
            <Text variant="bodySmall" testID="app-update-built-on">
              {t(copy.builtOn, {date: buildDate})}
            </Text>
          )}
          {message && (
            <Text variant="bodyMedium" testID="app-update-message">
              {message}
            </Text>
          )}
          {installable ? (
            <Button
              testID="app-update-install"
              mode="contained"
              onPress={() => install(installable)}
              loading={state.kind === 'downloading'}
              disabled={busy}
              style={styles.menuButton}>
              {copy.install}
            </Button>
          ) : (
            <Button
              testID="app-update-check"
              mode="outlined"
              onPress={check}
              loading={state.kind === 'checking'}
              disabled={busy}
              style={styles.menuButton}>
              {copy.check}
            </Button>
          )}
        </View>
      </Card.Content>
    </Card>
  );
};
