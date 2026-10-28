import {
  estimateParamsBillionFromModelId,
  estimateDeviceFit,
  sortByDeviceFit,
  looksUncensored,
  UNCENSORED_SEARCH_TERMS,
} from '../modelFitEstimator';
import {HuggingFaceModel} from '../types';

const makeModel = (id: string, tags: string[] = []): HuggingFaceModel =>
  ({
    id,
    tags,
  }) as HuggingFaceModel;

describe('modelFitEstimator', () => {
  describe('estimateParamsBillionFromModelId', () => {
    it('parses a plain "<N>B" suffix', () => {
      expect(
        estimateParamsBillionFromModelId('meta-llama/Llama-3.1-8B-Instruct'),
      ).toBe(8);
    });

    it('parses a decimal param count', () => {
      expect(
        estimateParamsBillionFromModelId('microsoft/Phi-3.8B-mini'),
      ).toBeCloseTo(3.8);
    });

    it('parses MoE "<experts>x<size>B" naming as total params', () => {
      expect(
        estimateParamsBillionFromModelId('mistralai/Mixtral-8x7B-Instruct'),
      ).toBe(56);
    });

    it('returns null when no param count is encoded in the name', () => {
      expect(
        estimateParamsBillionFromModelId('author/some-cool-model'),
      ).toBeNull();
    });

    it.each([null, undefined, 42, {}, ''])(
      'does not throw on a malformed id (%p)',
      malformed => {
        expect(() =>
          estimateParamsBillionFromModelId(malformed as unknown as string),
        ).not.toThrow();
        expect(
          estimateParamsBillionFromModelId(malformed as unknown as string),
        ).toBeNull();
      },
    );

    it('rejects an out-of-range parse instead of returning a bogus value', () => {
      // Not a real naming convention, but proves the sanity clamp holds even
      // if the regex were ever loosened.
      expect(
        estimateParamsBillionFromModelId('author/model-999999B'),
      ).toBeNull();
    });
  });

  describe('estimateDeviceFit', () => {
    it('is "unknown" when ram is not available', () => {
      expect(estimateDeviceFit('author/model-7B', null).fit).toBe('unknown');
    });

    it('is "unknown" when no param count can be parsed', () => {
      expect(estimateDeviceFit('author/model', 8 * 1e9).fit).toBe('unknown');
    });

    it('fits a small model on a high-RAM device', () => {
      const result = estimateDeviceFit('author/model-3B', 12 * 1e9);
      expect(result.paramsBillion).toBe(3);
      expect(result.fit).toBe('fits');
    });

    it('is "tooLarge" for a big model on a low-RAM device', () => {
      expect(estimateDeviceFit('author/model-70B', 4 * 1e9).fit).toBe(
        'tooLarge',
      );
    });

    it.each([0, -1, NaN, Infinity])(
      'is "unknown", not a zero budget, for an invalid ram reading (%p)',
      ramBytes => {
        expect(estimateDeviceFit('author/model-3B', ramBytes).fit).toBe(
          'unknown',
        );
      },
    );
  });

  describe('sortByDeviceFit', () => {
    it('ranks fits before tooLarge before unknown stays relative', () => {
      const models = [
        makeModel('author/model-70B'), // tooLarge on 6GB
        makeModel('author/model-3B'), // fits on 6GB
        makeModel('author/model-no-size'), // unknown
      ];
      const sorted = sortByDeviceFit(models, 6 * 1e9);
      expect(sorted.map(m => m.id)).toEqual([
        'author/model-3B',
        'author/model-no-size',
        'author/model-70B',
      ]);
    });

    it('does not throw and returns [] for a non-array input', () => {
      expect(() =>
        sortByDeviceFit(null as unknown as HuggingFaceModel[], 6 * 1e9),
      ).not.toThrow();
      expect(
        sortByDeviceFit(null as unknown as HuggingFaceModel[], 6 * 1e9),
      ).toEqual([]);
    });

    it('does not throw on a null/undefined entry mixed into the array', () => {
      const models = [
        makeModel('author/model-3B'),
        null as unknown as HuggingFaceModel,
        undefined as unknown as HuggingFaceModel,
      ];
      expect(() => sortByDeviceFit(models, 6 * 1e9)).not.toThrow();
    });
  });

  describe('looksUncensored', () => {
    it.each(UNCENSORED_SEARCH_TERMS)(
      'matches the "%s" keyword in the model id',
      term => {
        expect(looksUncensored(makeModel(`author/my-${term}-model`))).toBe(
          true,
        );
      },
    );

    it('matches the not-for-all-audiences tag', () => {
      expect(
        looksUncensored(makeModel('author/model', ['not-for-all-audiences'])),
      ).toBe(true);
    });

    it('is false for an unrelated model', () => {
      expect(looksUncensored(makeModel('author/friendly-helper-bot'))).toBe(
        false,
      );
    });

    it('does not throw and returns false for a malformed model entry', () => {
      const malformed = [
        null,
        undefined,
        {},
        {id: 42},
        {id: 'author/model', tags: 'not-an-array'},
        {id: 'author/model', tags: [null, 42, 'uncensored']},
      ];
      for (const model of malformed) {
        expect(() =>
          looksUncensored(model as unknown as HuggingFaceModel),
        ).not.toThrow();
      }
      // The last case has a valid 'uncensored' tag among the junk entries.
      expect(looksUncensored(malformed[5] as unknown as HuggingFaceModel)).toBe(
        true,
      );
    });
  });
});
