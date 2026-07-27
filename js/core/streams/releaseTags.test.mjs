import assert from "node:assert/strict";
import test from "node:test";
import {
  audioChannelsFromText,
  audioTagsFromText,
  encodeFromText,
  qualityFromText,
  resolutionFromText,
  visualTagsFromText
} from "./releaseTags.js";
import { StreamTagParser } from "../debrid/directDebridStreamPresentation.js";

const { languagesFromText } = StreamTagParser;

const CASES = [
  {
    name: "Obsession 2025 USA BluRay REMUX UHD DoVi HDR10 2160p Atmos TrueHD7.1-DreamHD.mkv",
    resolution: "P2160",
    quality: "BLURAY_REMUX",
    visual: ["HDR_DV", "HDR10", "DV", "HDR"],
    audio: ["ATMOS", "TRUEHD"],
    channels: ["CH_7_1"],
    encode: "UNKNOWN"
  },
  {
    name: "Obsession.2025.2160p.UHD.Blu-ray.Remux.DV.HDR.HEVC.TrueHD.Atmos.7.1-CiNEPHiLES",
    resolution: "P2160",
    quality: "BLURAY_REMUX",
    visual: ["HDR_DV", "DV", "HDR"],
    audio: ["ATMOS", "TRUEHD"],
    channels: ["CH_7_1"],
    encode: "HEVC"
  },
  {
    name: "Movie.2023.1080p.WEB-DL.SDR.x264.DD5.1-GRP",
    resolution: "P1080",
    quality: "WEB_DL",
    visual: ["SDR"],
    audio: ["DD"],
    channels: ["CH_5_1"],
    encode: "AVC"
  },
  {
    name: "Movie.2023.2160p.WEB-DL.HDR10+.HEVC.DDP5.1.Atmos-GRP",
    resolution: "P2160",
    quality: "WEB_DL",
    visual: ["HDR_ONLY", "HDR10_PLUS", "HDR10", "HDR"],
    audio: ["ATMOS", "DD_PLUS"],
    channels: ["CH_5_1"],
    encode: "HEVC"
  },
  {
    name: "Show.S01E01.1080p.HDTV.x264-AAC.2.0",
    resolution: "P1080",
    quality: "HDTV",
    visual: ["UNKNOWN"],
    audio: ["AAC"],
    channels: ["CH_2_0"],
    encode: "AVC"
  },
  {
    name: "Doc.2020.2160p.BluRay.HLG.10bit.AV1.FLAC.5.1",
    resolution: "P2160",
    quality: "BLURAY",
    visual: ["HDR_ONLY", "HDR", "HLG", "TEN_BIT"],
    audio: ["FLAC"],
    channels: ["CH_5_1"],
    encode: "AV1"
  },
  {
    name: "Film.IMAX.2019.1080p.BluRay.DTS-HD.MA.7.1.x265",
    resolution: "P1080",
    quality: "BLURAY",
    visual: ["IMAX"],
    audio: ["DTS_HD_MA", "DTS_HD", "DTS"],
    channels: ["CH_7_1"],
    encode: "HEVC"
  },
  {
    name: "Movie.2021.1080p.BluRay.DTS-X.7.1.x264",
    resolution: "P1080",
    quality: "BLURAY",
    visual: ["UNKNOWN"],
    audio: ["DTS_X", "DTS"],
    channels: ["CH_7_1"],
    encode: "AVC"
  },
  {
    name: "Movie.2018.1080p.WEBRip.DTS-ES.6.1.x264",
    resolution: "P1080",
    quality: "WEBRIP",
    visual: ["UNKNOWN"],
    audio: ["DTS_ES", "DTS"],
    channels: ["CH_6_1"],
    encode: "AVC"
  },
  {
    name: "Movie.2024.2160p.WEB.DDP5.1.Atmos.DV.HDR10.HEVC-Grp",
    resolution: "P2160",
    quality: "UNKNOWN",
    visual: ["HDR_DV", "HDR10", "DV", "HDR"],
    audio: ["ATMOS", "DD_PLUS"],
    channels: ["CH_5_1"],
    encode: "HEVC"
  },
  {
    name: "Movie.2016.720p.BRRip.XviD.AC3-GRP",
    resolution: "P720",
    quality: "BLURAY",
    visual: ["UNKNOWN"],
    audio: ["DD"],
    channels: ["UNKNOWN"],
    encode: "XVID"
  },
  {
    name: "Movie.2015.480p.DVDRip.DivX.MP3",
    resolution: "P480",
    quality: "DVDRIP",
    visual: ["UNKNOWN"],
    audio: ["UNKNOWN"],
    channels: ["UNKNOWN"],
    encode: "DIVX"
  },
  {
    name: "Movie.2022.1440p.WEB-DL.Opus.2.0.VP9",
    resolution: "P1440",
    quality: "WEB_DL",
    visual: ["UNKNOWN"],
    audio: ["OPUS"],
    channels: ["CH_2_0"],
    encode: "UNKNOWN"
  },
  {
    name: "Movie.2019.2160p.Dolby.Vision.Atmos.TrueHD.7.1.HEVC-GRP",
    resolution: "P2160",
    quality: "UNKNOWN",
    visual: ["DV_ONLY", "DV"],
    audio: ["ATMOS", "TRUEHD"],
    channels: ["CH_7_1"],
    encode: "HEVC"
  },
  {
    name: "Movie.2020.1080p.CAM.x264-GRP",
    resolution: "P1080",
    quality: "CAM",
    visual: ["UNKNOWN"],
    audio: ["UNKNOWN"],
    channels: ["UNKNOWN"],
    encode: "AVC"
  }
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    const text = testCase.name.toLowerCase();
    assert.deepEqual(resolutionFromText(text), testCase.resolution, "resolution");
    assert.deepEqual(qualityFromText(text), testCase.quality, "quality");
    assert.deepEqual(visualTagsFromText([], text), testCase.visual, "visual tags");
    assert.deepEqual(audioTagsFromText([], text), testCase.audio, "audio tags");
    assert.deepEqual(audioChannelsFromText([], text), testCase.channels, "audio channels");
    assert.deepEqual(encodeFromText(null, text), testCase.encode, "encode");
  });
}

test("HDR release is never also tagged SDR", () => {
  assert.deepEqual(visualTagsFromText([], "movie.2160p.hdr10.sdr.remux"), [
    "HDR_ONLY",
    "HDR10",
    "HDR"
  ]);
});

// Titles whose words contain tag names as substrings. These broke the player
// autoplay scorer, which used text.includes().
test("title words are not mistaken for tags", () => {
  assert.equal(qualityFromText("Camp.Rock.2008.1080p.WEB-DL.x264"), "WEB_DL", "Camp -> CAM");
  assert.equal(qualityFromText("The.Lights.2019.2160p.BluRay.x265"), "BLURAY", "Lights -> TS");
  assert.equal(qualityFromText("Arts.and.Crafts.2020.1080p.WEBRip"), "WEBRIP", "Arts -> TS");
  assert.equal(qualityFromText("Scream.2022.1080p.WEB-DL.x264"), "WEB_DL", "Scream -> SCR");
  assert.deepEqual(
    visualTagsFromText([], "Movie.2020.1080p.HDRip.x264"),
    ["UNKNOWN"],
    "HDRip -> HDR"
  );
});

test("real low-quality releases are still detected", () => {
  assert.equal(qualityFromText("Movie.2021.1080p.CAM.x264"), "CAM");
  assert.equal(qualityFromText("Movie.2021.1080p.TS.x264"), "TS");
});

test("HD-Rip stays distinct from HDRip", () => {
  assert.equal(qualityFromText("Movie.2021.1080p.HD-Rip.x264"), "HD_RIP");
  assert.equal(qualityFromText("Movie.2021.1080p.HD.Rip.x264"), "HD_RIP");
  assert.equal(qualityFromText("Movie.2021.1080p.HDRip.x264"), "HDRIP");
});

test("separator variants retain the Android TV tag contract", () => {
  assert.deepEqual(audioTagsFromText([], "Movie.Dolby.Digital.Plus.5.1"), ["DD_PLUS", "DD"]);
  assert.equal(encodeFromText(null, "Movie.1080p.H.264"), "AVC");
  assert.equal(encodeFromText(null, "Movie.2160p.H.265"), "HEVC");
});

test("languages", () => {
  assert.deepEqual(languagesFromText([], "movie.2021.1080p.multi.en.fr"), ["EN", "FR", "MULTI"]);
  assert.deepEqual(languagesFromText([], "movie.2021.1080p.pt-br.web-dl"), ["PT_BR"], "pt-br > pt");
  assert.deepEqual(languagesFromText(["Brazilian Portuguese"], ""), ["PT_BR"], "from label");
  assert.deepEqual(languagesFromText(["de"], "movie.en.1080p"), ["DE"], "parsed wins over text");
  assert.deepEqual(languagesFromText([], "movie.2021.1080p.web-dl.x264"), []);
});
