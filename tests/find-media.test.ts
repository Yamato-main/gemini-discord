import { describe, expect, it } from 'vitest';
import { normalizeMediaSearch } from '../src/tools/find-media.js';

describe('normalizeMediaSearch', () => {
  it('treats generic random media requests as random local media searches', () => {
    expect(normalizeMediaSearch('random image from my device')).toEqual({
      meaningfulQuery: '',
      random: true,
    });
    expect(normalizeMediaSearch('random video from my device')).toEqual({
      meaningfulQuery: '',
      random: true,
    });
  });

  it('keeps meaningful media search terms', () => {
    expect(normalizeMediaSearch('GCC folder image')).toEqual({
      meaningfulQuery: 'GCC folder',
      random: false,
    });
  });
});
