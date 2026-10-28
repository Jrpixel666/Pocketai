import type {TurboModule} from 'react-native';
import {Platform, TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  // Hands a downloaded APK (absolute path inside the app's cache dir) to the
  // system package installer, which asks the user to confirm.
  install(filePath: string): Promise<void>;
}

const NativeApkInstaller: Spec | null =
  Platform.OS === 'android'
    ? TurboModuleRegistry.getEnforcing<Spec>('ApkInstallerModule')
    : null;

export default NativeApkInstaller;
