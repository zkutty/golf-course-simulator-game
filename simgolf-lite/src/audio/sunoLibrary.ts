export interface SunoAudioAsset {
  id: string;
  title: string;
  issue: string;
  sourceUrl: string;
  src: string;
  provenance: SunoAudioProvenance;
}

export interface SunoAudioProvenance {
  source: {
    kind: "suno-generation";
    creator: "Zach Kutlow";
    generatedOn: "2026-07-24";
  };
  license: {
    status: "pending-release-audit";
    basis: "subscribed-owner-account";
  };
  mastering: {
    runtimeFormat: "MP3";
    bitrateKbps: 96;
    treatment: "source-export-no-project-remaster-documented";
  };
  loop: {
    mode: "sequential-playlist";
    seamless: false;
    overlappingCrossfade: false;
  };
  loudness: {
    status: "unmeasured";
    runtimeControl: "master-and-channel-gain";
  };
}

const SUNO_PROVENANCE: SunoAudioProvenance = Object.freeze({
  source: Object.freeze({
    kind: "suno-generation",
    creator: "Zach Kutlow",
    generatedOn: "2026-07-24",
  }),
  license: Object.freeze({
    status: "pending-release-audit",
    basis: "subscribed-owner-account",
  }),
  mastering: Object.freeze({
    runtimeFormat: "MP3",
    bitrateKbps: 96,
    treatment: "source-export-no-project-remaster-documented",
  }),
  loop: Object.freeze({
    mode: "sequential-playlist",
    seamless: false,
    overlappingCrossfade: false,
  }),
  loudness: Object.freeze({
    status: "unmeasured",
    runtimeControl: "master-and-channel-gain",
  }),
});

function asset(
  issue: string,
  id: string,
  title: string,
  kind: "music" | "ambience",
  filename: string,
): SunoAudioAsset {
  return {
    id,
    title,
    issue,
    sourceUrl: `https://suno.com/song/${id}`,
    src: `/audio/${kind}/suno/${filename}.mp3`,
    provenance: SUNO_PROVENANCE,
  };
}

export const SUNO_MUSIC_PLAYLISTS = {
  title: [
    asset("ZK-409", "63b07204-34a5-4623-a742-68139affa08d", "Verdant Fairway", "music", "title-01"),
    asset("ZK-409", "e3e5dc8b-ea09-4da0-b812-0e577f293599", "Verdant Fairway", "music", "title-02"),
  ],
  "build-parkland": [
    asset("ZK-410", "ae9f105e-01f1-473f-b071-8ba61d66093b", "Oakland Fairways", "music", "build-parkland-01"),
    asset("ZK-410", "c0aa3d69-afb7-465c-8e29-d953e994a9f5", "Oakland Fairways", "music", "build-parkland-02"),
  ],
  "build-links": [
    asset("ZK-411", "9b11320a-5956-4fe3-af23-e4a3a4de19fd", "Dune Links", "music", "build-links-01"),
    asset("ZK-411", "fa4c112f-1ba3-4d5e-b239-ec221739e7dc", "Dune Links", "music", "build-links-02"),
  ],
  "build-desert": [
    asset("ZK-412", "80373bf2-3d8d-49b9-b41a-edc7af70883a", "Dry Room Acoustics", "music", "build-desert-01"),
    asset("ZK-412", "674042fc-0fd7-4cc5-ba44-faa1e83a0b93", "Sand Trap Gardens", "music", "build-desert-02"),
  ],
  live: [
    asset("ZK-413", "6896e1f9-04ec-4861-b262-c47534e3d651", "Fairway Ledger", "music", "operate-01"),
    asset("ZK-413", "dbe081f8-b0f5-4897-8d90-827b9d5829e4", "Fairway Ledger", "music", "operate-02"),
  ],
  play: [
    asset("ZK-414", "a7219a3c-76ed-436a-863b-46321d6c5385", "Fairway Pocket Loop", "music", "player-pro-01"),
    asset("ZK-414", "7f361633-8987-4e4f-ae68-0fb0cc9d2f0e", "Fairway Pocket Loop", "music", "player-pro-02"),
  ],
  "tournament-local": [
    asset("ZK-415", "19c89501-c8c0-42ac-a477-24428c8fc963", "Pinecrest Open", "music", "tournament-local-01"),
    asset("ZK-415", "8552b26c-9273-4577-a155-abcaf2af0639", "Pinecrest Open", "music", "tournament-local-02"),
  ],
  "tournament-regional": [
    asset("ZK-416", "602bdc3c-a57f-4028-a4a3-52456af330c7", "Clubhouse on the Wind", "music", "tournament-regional-01"),
    asset("ZK-416", "e4496aa8-b144-4d7e-a38a-1acba4036610", "Clubhouse on the Wind", "music", "tournament-regional-02"),
  ],
  "tournament-championship": [
    asset("ZK-417", "f5a33ede-94bf-4148-8168-17edc9be99dd", "Greenside Final", "music", "tournament-championship-01"),
    asset("ZK-417", "b9abc607-904b-485a-b40d-8d3484192070", "Greenside Final", "music", "tournament-championship-02"),
  ],
  tension: [
    asset("ZK-418", "1bb4a455-4d2d-437a-b405-541828669348", "Pinched Budget", "music", "tension-01"),
    asset("ZK-418", "e285881d-83c2-4893-b96a-2a4d3a3e1a46", "Pinched Budget", "music", "tension-02"),
  ],
  victory: [
    asset("ZK-419", "bf3045b9-8a20-4a4c-ab2b-cf6a0a56fa5a", "Fairway Homecoming", "music", "victory-01"),
    asset("ZK-419", "0068ac86-6a31-4026-be84-6083b7ccfc14", "Fairway Homecoming", "music", "victory-02"),
  ],
} as const;

export type SunoMusicContext = keyof typeof SUNO_MUSIC_PLAYLISTS;

export const SUNO_AMBIENCE_PLAYLISTS = {
  parkland: [
    asset("ZK-420", "29f5c2b3-1d4d-4a37-959d-1d52bbb3f280", "Fairway Morning", "ambience", "parkland-01"),
    asset("ZK-420", "ec051ec5-176b-428e-ae39-8f33b30a8fe1", "Fairway Morning", "ambience", "parkland-02"),
  ],
  links: [
    asset("ZK-421", "d8f803f4-eb12-434d-9ffa-b8a3d68d2e09", "Fescue and Tide", "ambience", "links-01"),
    asset("ZK-421", "11275410-0907-4485-882e-22a19aa50c1b", "Fescue and Tide", "ambience", "links-02"),
  ],
  desert: [
    asset("ZK-422", "3d1d6464-11ca-416f-be23-f7cb80f4000e", "Desert Fairway Drift", "ambience", "desert-01"),
    asset("ZK-422", "25cefc2a-82f9-47fd-a26b-232602b3f402", "Desert Fairway Drift", "ambience", "desert-02"),
  ],
  water: [
    asset("ZK-423", "647a5c74-ed03-4aea-9840-524af630113a", "Pond Edge Drift", "ambience", "water-01"),
    asset("ZK-423", "96cdbbcc-6782-4634-ac71-7443fa8b141c", "Reeds and Rain", "ambience", "water-02"),
  ],
  campus: [
    asset("ZK-424", "95639460-d1d1-4038-bffa-7071401f744d", "Fairway Afternoon", "ambience", "campus-01"),
    asset("ZK-424", "102cbf42-78bd-4b89-bdb8-9bf0ef4976c2", "Fairway Afternoon", "ambience", "campus-02"),
  ],
  resort: [
    asset("ZK-425", "bd706c67-68a8-44f2-b7c6-31c94f5c5523", "Evening Fairway Air", "ambience", "resort-01"),
    asset("ZK-425", "02020847-a9cd-4fac-9550-ab1c29ba7da6", "Evening Fairway Air", "ambience", "resort-02"),
  ],
  rain: [
    asset("ZK-426", "c48e6773-80e2-4666-b86c-678a446b681e", "Rain Over Fairways", "ambience", "rain-01"),
    asset("ZK-426", "2486c8ac-1ead-4c42-9019-5fe1e49ccdbd", "Rain Over Fairways", "ambience", "rain-02"),
  ],
  night: [
    asset("ZK-427", "a168626d-bc12-4acf-a68a-82140f8bfce5", "Dusk on the Fescue", "ambience", "night-01"),
    asset("ZK-427", "371440a5-09aa-4acd-a9e9-b8452e93fabc", "Dusk on the Fescue", "ambience", "night-02"),
  ],
  winter: [
    asset("ZK-428", "a77596af-4e8d-4581-9bd3-d65cd9acc0a6", "Dormant Fairway", "ambience", "winter-01"),
    asset("ZK-428", "0c84426f-ebb7-41ee-b7aa-f04847fc6abe", "Dormant Fairway", "ambience", "winter-02"),
  ],
} as const;

export type SunoAmbienceContext = keyof typeof SUNO_AMBIENCE_PLAYLISTS;

export const ALL_SUNO_AUDIO = [
  ...Object.values(SUNO_MUSIC_PLAYLISTS).flat(),
  ...Object.values(SUNO_AMBIENCE_PLAYLISTS).flat(),
];
