// Firebase is not included in this build. App Check always fails, so callers
// fall through to their "only available for official builds" error path.
export const initializeAppCheck = async (): Promise<void> => {
  throw new Error('Firebase App Check is not available in this build');
};

export const getAppCheckToken = async (): Promise<string> => {
  throw new Error('Firebase App Check is not available in this build');
};
