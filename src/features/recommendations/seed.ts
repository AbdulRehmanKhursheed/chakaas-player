/**
 * User's stated taste seed.
 *
 * Captured 2026-05-05: "i listen to nusrat, rahat fateh ali khan, atif, arijit
 * alot, old sad songs like tujh se naraz nahi zindagi etc or dil ne ye kaha ha
 * dil se i have some songs even downloaded as well … and also i listen to hip
 * hop honey singh badshah etc as well item songs as well so its a real mix"
 *
 * The artist affinity store is bootstrapped from these on first launch so the
 * Discover feed has something useful to show before any plays accumulate. As
 * the user listens, learned scores blend with and eventually dominate the
 * seed.
 */

export interface TasteSeed {
  /** Artist names with an initial affinity score (0–10 scale). */
  artists: Record<string, number>;
  /**
   * Curated text queries representing moods / sub-genres that don't map
   * cleanly to a single artist (e.g. "old sad songs"). Used as additional
   * Saavn search inputs in Discover.
   */
  moodQueries: string[];
}

export const USER_TASTE_SEED: TasteSeed = {
  artists: {
    // Sufi / qawwali — strong stated preference
    'Nusrat Fateh Ali Khan': 9,
    'Rahat Fateh Ali Khan': 9,
    // Bollywood vocalists — stated "alot"
    'Atif Aslam': 8,
    'Arijit Singh': 8,
    // Hip hop / rap
    'Yo Yo Honey Singh': 7,
    'Badshah': 7,
  },
  moodQueries: [
    // The pool deliberately overshoots — discoverEngine rotates a subset of
    // these per refresh so the user gets a genuinely fresh slice each tap
    // instead of the same six queries hammering the same Saavn ranking.

    // Sufi / qawwali
    'sufi qawwali hindi',
    'nusrat fateh ali khan qawwali',
    'rahat fateh ali khan',
    'ghazal',

    // Old sad classics (anchors: "Tujhse Naraz Nahi Zindagi", "Dil Ne Ye Kaha")
    'old hindi sad songs',
    'classic bollywood sad songs',
    'kishore kumar classic',
    'lata mangeshkar',
    'mohammed rafi',

    // Bollywood mainstream
    'romantic hindi songs',
    'bollywood romantic hits',
    'arijit singh romantic',
    'atif aslam best',
    'a r rahman bollywood',
    'pritam best songs',

    // Era buckets
    'bollywood 90s',
    'bollywood 2000s',

    // Item / dance numbers
    'hindi item songs',
    'bollywood dance hits',
    'bollywood party songs',
    'bollywood workout',

    // Rap / hip hop in Hindi
    'hindi rap',
    'desi hip hop',

    // Regional Punjabi / Haryanvi
    'punjabi pop',
    'punjabi hits',
    'haryanvi hits',
    'bhangra hits',

    // Indie + chill
    'hindi indie',
    'bollywood lofi',
    'classical hindi instrumental',

    // Occasion-driven
    'monsoon hindi songs',
    'wedding hindi songs',
  ],
};
