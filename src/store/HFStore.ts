import {makeAutoObservable, runInAction} from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {makePersistable} from 'mobx-persist-store';
import * as Keychain from 'react-native-keychain';

import {fetchGGUFSpecs, fetchModelFilesDetails, fetchModels} from '../api/hf';

import {enrichSiblingsWithStorage} from '../utils';
import {processHFSearchResults} from '../utils/hf';
import {ErrorState, createErrorState} from '../utils/errors';
import {
  UNCENSORED_SEARCH_TERMS,
  looksUncensored,
  sortByDeviceFit,
} from '../utils/modelFitEstimator';
import {readDeviceSignals} from '../services/deviceRules/signals';

import {HuggingFaceModel} from '../utils/types';

// Service name for keychain storage
const HF_TOKEN_SERVICE = 'hf_token_service';

// Filter types for enhanced search
export type SortOption =
  | 'relevance'
  | 'downloads'
  | 'lastModified'
  | 'likes'
  | 'bestForDevice';

export interface SearchFilters {
  author: string;
  sortBy: SortOption;
  // Restricts results to the curated uncensored/abliterated keyword set
  // (see modelFitEstimator.ts). A quick content filter, not a device signal.
  uncensored: boolean;
}

class HFStore {
  models: HuggingFaceModel[] = [];
  isLoading = false;
  error: ErrorState | null = null;
  nextPageLink: string | null = null;
  private lastFetchedNextLink: string | null = null;
  private lastFetchMoreAttempt: number = 0;
  private consecutiveSmallResults: number = 0;
  searchQuery = '';
  queryFilter = 'gguf,conversational';
  queryFull = true;
  queryConfig = true;
  hfToken: string | null = null;
  useHfToken: boolean = true; // Only applies when token is set

  // search filters
  searchFilters: SearchFilters = {
    author: '',
    sortBy: 'relevance',
    uncensored: false,
  };

  // Lazily read and cached; device RAM doesn't change within a session.
  deviceRamBytes: number | null = null;
  private ramBytesPromise: Promise<number | null> | null = null;

  constructor() {
    makeAutoObservable(this);

    makePersistable(this, {
      name: 'HFStore',
      properties: ['useHfToken'],
      storage: AsyncStorage,
    });

    // Load token from secure storage on initialization
    this.loadTokenFromSecureStorage();
  }

  // Load token from secure storage
  private async loadTokenFromSecureStorage() {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: HF_TOKEN_SERVICE,
      });

      if (credentials) {
        runInAction(() => {
          this.hfToken = credentials.password;
        });
      }
    } catch (error) {
      console.error('Failed to load token from secure storage:', error);
    }
  }

  get isTokenPresent(): boolean {
    return !!this.hfToken && this.hfToken.trim().length > 0;
  }

  get shouldUseToken(): boolean {
    return this.isTokenPresent && this.useHfToken;
  }

  setUseHfToken(useToken: boolean) {
    runInAction(() => {
      this.useHfToken = useToken;
    });
  }

  async setToken(token: string) {
    try {
      // Save token in secure storage
      await Keychain.setGenericPassword('hf_token', token, {
        service: HF_TOKEN_SERVICE,
      });

      runInAction(() => {
        this.hfToken = token;
      });
      return true;
    } catch (error) {
      console.error('Failed to save HF token:', error);
      return false;
    }
  }

  async clearToken() {
    try {
      // Remove token from secure storage
      await Keychain.resetGenericPassword({
        service: HF_TOKEN_SERVICE,
      });

      runInAction(() => {
        this.hfToken = null;
      });
      return true;
    } catch (error) {
      console.error('Failed to clear HF token:', error);
      return false;
    }
  }

  setSearchQuery(query: string) {
    this.searchQuery = query;
  }

  setSearchFilters(filters: Partial<SearchFilters>) {
    if (
      filters.author !== undefined &&
      this.searchFilters.author !== filters.author
    ) {
      this.searchFilters.author = filters.author;
    }
    if (
      filters.sortBy !== undefined &&
      this.searchFilters.sortBy !== filters.sortBy
    ) {
      this.searchFilters.sortBy = filters.sortBy;
    }
    if (
      filters.uncensored !== undefined &&
      this.searchFilters.uncensored !== filters.uncensored
    ) {
      this.searchFilters.uncensored = filters.uncensored;
    }
  }

  setAuthorFilter(author: string) {
    this.searchFilters.author = author;
  }

  setSortBy(sortBy: SortOption) {
    this.searchFilters.sortBy = sortBy;
  }

  // One-tap entry point: restrict to the curated uncensored keyword set and
  // rank by estimated fit for this device.
  findBestModelsForDevice() {
    this.setSearchFilters({uncensored: true, sortBy: 'bestForDevice'});
    return this.fetchModels();
  }

  clearFilters() {
    this.searchFilters = {
      author: '',
      sortBy: 'relevance',
      uncensored: false,
    };
  }

  // Read and cache the device's total RAM for the "best for my device" sort.
  // Not device-tier classification (that's ModelStore's job for the curated
  // preset list) — just the raw figure needed to rank live search results.
  private async ensureDeviceRamBytes(): Promise<number | null> {
    if (this.deviceRamBytes !== null) {
      return this.deviceRamBytes;
    }
    if (!this.ramBytesPromise) {
      this.ramBytesPromise = readDeviceSignals()
        .then(signals => signals.ramBytes)
        .catch(() => null);
    }
    const ramBytes = await this.ramBytesPromise;
    runInAction(() => {
      this.deviceRamBytes = ramBytes;
    });
    return ramBytes;
  }

  clearError() {
    this.error = null;
  }

  // Fetch the GGUF specs for a specific model,
  // such as number of parameters, context length, chat template, etc.
  async fetchAndSetGGUFSpecs(modelId: string) {
    try {
      const authToken = this.shouldUseToken ? this.hfToken : null;
      const specs = await fetchGGUFSpecs(modelId, authToken);
      const model = this.models.find(m => m.id === modelId);
      if (model) {
        runInAction(() => {
          model.specs = specs;
        });
      }
    } catch (error) {
      console.error('Failed to fetch GGUF specs:', error);
      runInAction(() => {
        this.error = createErrorState(error, 'modelDetails', 'huggingface');
      });
    }
  }

  private async updateSiblingsWithFileDetails(
    model: HuggingFaceModel,
    fileDetails: any[],
  ) {
    const mergedSiblings = model.siblings.map(file => {
      const details = fileDetails.find(
        detail => detail.path === file.rfilename,
      );
      if (!details) {
        return {...file};
      }
      return {
        ...file,
        size: details.size,
        oid: details.oid,
        lfs: details.lfs,
      };
    });

    return enrichSiblingsWithStorage(model, mergedSiblings);
  }

  // Fetch the details (sizes, oid, lfs, ...) of the model files
  async fetchModelFileDetails(modelId: string) {
    try {
      console.log('Fetching model file details for', modelId);
      const authToken = this.shouldUseToken ? this.hfToken : null;
      const fileDetails = await fetchModelFilesDetails(modelId, authToken);
      const model = this.models.find(m => m.id === modelId);

      if (!model) {
        return;
      }

      const updatedSiblings = await this.updateSiblingsWithFileDetails(
        model,
        fileDetails,
      );

      runInAction(() => {
        model.siblings = updatedSiblings;
      });
    } catch (error) {
      console.error('Error fetching model file sizes:', error);
      runInAction(() => {
        this.error = createErrorState(error, 'modelDetails', 'huggingface');
      });
    }
  }

  getModelById(id: string): HuggingFaceModel | null {
    return this.models.find(model => model.id === id) || null;
  }

  async fetchModelData(modelId: string) {
    try {
      await this.fetchAndSetGGUFSpecs(modelId);
      await this.fetchModelFileDetails(modelId);
    } catch (error) {
      console.error('Error fetching model data:', error);
      runInAction(() => {
        this.error = createErrorState(error, 'modelDetails', 'huggingface');
      });
    }
  }

  get hasMoreResults() {
    return this.nextPageLink !== null;
  }

  // Check if we should prevent fetching more due to small result sets
  private shouldPreventFetchMore(): boolean {
    const now = Date.now();
    const timeSinceLastAttempt = now - this.lastFetchMoreAttempt;

    // If we have very few models and recent attempts, apply debouncing
    if (this.models.length < 5 && timeSinceLastAttempt < 2000) {
      console.log('🔵 Preventing fetchMore: too few models and recent attempt');
      return true;
    }

    // If we've had multiple consecutive small results, be more cautious
    if (this.consecutiveSmallResults >= 3 && timeSinceLastAttempt < 5000) {
      console.log(
        '🔵 Preventing fetchMore: multiple small results, applying longer debounce',
      );
      return true;
    }

    return false;
  }

  // Helper method to build filter string based on current filters
  private buildFilterString(): string {
    return this.queryFilter; // Just use the base filter
  }

  // Helper method to get sort parameters
  private getSortParams(): {sort: string; direction: string} | null {
    switch (this.searchFilters.sortBy) {
      case 'lastModified':
        return {sort: 'lastModified', direction: '-1'};
      case 'likes':
        return {sort: 'likes', direction: '-1'};
      case 'downloads':
        return {sort: 'downloads', direction: '-1'};
      case 'bestForDevice':
        // Ranked client-side after fetch (sortByDeviceFit); ask HF for its
        // default relevance ordering as the input to re-rank.
        return null;
      case 'relevance':
      default:
        return null; // No sorting - use HF's default relevance ranking
    }
  }

  // HF's `search` param is a single substring match against repo id/author,
  // so OR-ing the curated uncensored keyword set needs one request per term
  // when there's no free-text query to anchor on. With a free-text query,
  // fetch a wider page for that query and filter it to the curated set
  // instead, so the user's own search intent still drives the results.
  private async fetchUncensoredModels(
    authToken: string | null,
    sortParams: {sort: string; direction: string} | null,
  ): Promise<{models: HuggingFaceModel[]; nextLink: string | null}> {
    const query = this.searchQuery.trim();

    if (query) {
      const {models} = await fetchModels({
        search: query,
        author: this.searchFilters.author || undefined,
        limit: 50,
        sort: sortParams?.sort,
        direction: sortParams?.direction,
        filter: this.buildFilterString(),
        full: this.queryFull,
        config: this.queryConfig,
        authToken,
      });
      // No stable next-page cursor once we filter client-side; pagination
      // for this mode is covered by the wider initial page instead.
      return {models: models.filter(looksUncensored), nextLink: null};
    }

    const batches = await Promise.all(
      UNCENSORED_SEARCH_TERMS.map(term =>
        fetchModels({
          search: term,
          author: this.searchFilters.author || undefined,
          limit: 15,
          sort: sortParams?.sort,
          direction: sortParams?.direction,
          filter: this.buildFilterString(),
          full: this.queryFull,
          config: this.queryConfig,
          authToken,
        }).catch(() => ({models: [] as HuggingFaceModel[], nextLink: null})),
      ),
    );

    const seen = new Set<string>();
    const merged: HuggingFaceModel[] = [];
    for (const batch of batches) {
      for (const model of batch.models) {
        if (!seen.has(model.id)) {
          seen.add(model.id);
          merged.push(model);
        }
      }
    }
    // A merge of several independent queries has no single next-page cursor.
    return {models: merged, nextLink: null};
  }

  // Fetch the models from the Hugging Face API
  async fetchModels() {
    this.isLoading = true;
    this.error = null;

    // Fresh search → reset pagination guards
    this.lastFetchedNextLink = null;
    this.consecutiveSmallResults = 0;
    this.lastFetchMoreAttempt = 0;

    try {
      const authToken = this.shouldUseToken ? this.hfToken : null;
      const sortParams = this.getSortParams();

      const {models, nextLink} = this.searchFilters.uncensored
        ? await this.fetchUncensoredModels(authToken, sortParams)
        : await fetchModels({
            search: this.searchQuery,
            author: this.searchFilters.author || undefined,
            limit: 10,
            sort: sortParams?.sort,
            direction: sortParams?.direction,
            filter: this.buildFilterString(),
            full: this.queryFull,
            config: this.queryConfig,
            authToken: authToken,
          });

      let processedModels = processHFSearchResults(models);

      if (this.searchFilters.sortBy === 'bestForDevice') {
        const ramBytes = await this.ensureDeviceRamBytes();
        processedModels = sortByDeviceFit(processedModels, ramBytes);
      }

      runInAction(() => {
        this.models = processedModels;
        this.nextPageLink = nextLink;
      });
    } catch (error) {
      runInAction(() => {
        this.isLoading = false;
        this.nextPageLink = null;
        this.models = [];
      });
      // this need to be in a separate runInAction for the ui to render properly.
      runInAction(() => {
        this.error = createErrorState(error, 'search', 'huggingface');
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  // Fetch the next page of models
  async fetchMoreModels() {
    console.log('fetchMoreModels called');
    if (!this.nextPageLink || this.isLoading) {
      return;
    }

    // Check if we should prevent fetching more due to small result sets
    if (this.shouldPreventFetchMore()) {
      return;
    }

    // ⛔️ Don't refetch the same page over and over
    if (this.lastFetchedNextLink === this.nextPageLink) {
      console.log(
        '🔵 Skipping duplicate fetch for same nextPageLink:',
        this.nextPageLink,
      );
      return;
    }
    this.lastFetchedNextLink = this.nextPageLink;
    this.lastFetchMoreAttempt = Date.now();

    this.isLoading = true;
    this.error = null;

    try {
      const authToken = this.shouldUseToken ? this.hfToken : null;
      const {models, nextLink} = await fetchModels({
        nextPageUrl: this.nextPageLink,
        authToken: authToken,
      });

      let processedModels = processHFSearchResults(models);

      runInAction(() => {
        // Track consecutive small results for pagination protection
        if (processedModels.length < 3) {
          this.consecutiveSmallResults++;
        } else {
          this.consecutiveSmallResults = 0;
        }

        processedModels.forEach((model: HuggingFaceModel) =>
          this.models.push(model),
        );
        if (this.searchFilters.sortBy === 'bestForDevice') {
          this.models = sortByDeviceFit(this.models, this.deviceRamBytes);
        }
        this.nextPageLink = nextLink;
      });
    } catch (error) {
      runInAction(() => {
        this.error = createErrorState(error, 'search', 'huggingface');
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }
}

export const hfStore = new HFStore();
