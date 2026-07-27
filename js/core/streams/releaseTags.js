// Release name parsing. Scene/P2P release names are separator-delimited token
// runs ("Movie.2024.2160p.WEB-DL.DDP5.1.Atmos-GRP"), so tags are recognised by
// tokenizing and matching against a term table rather than by substring tests.
//
// Substring tests are what make naive detection wrong: "Camp Rock" contains
// "cam", "The Lights" contains "ts". Tokenizing removes that whole class of bug.

// Split on separators, and also between letter and digit runs so "TrueHD7"
// yields "truehd" and "7".
export function tokenize(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[^a-z0-9+]+/)
    .filter(Boolean);
}

// Term -> tag. Keys are token windows joined without separators, so one entry
// matches every spelling: "dtshdma" covers "DTS-HD.MA", "DTS HD MA", "DTS_HD_MA".
const TERMS = {
  "2160": "P2160",
  "4k": "P2160",
  uhd: "P2160",
  "1440": "P1440",
  "2k": "P1440",
  "1080": "P1080",
  fhd: "P1080",
  "720": "P720",
  hd: "P720",
  "576": "P576",
  "480": "P480",
  sd: "P480",
  "360": "P360",

  remux: "BLURAY_REMUX",
  bluray: "BLURAY",
  bdrip: "BLURAY",
  brrip: "BLURAY",
  web: "WEB",
  webdl: "WEB_DL",
  webrip: "WEBRIP",
  hdrip: "HDRIP",
  hcrip: "HD_RIP",
  dvdrip: "DVDRIP",
  hdtv: "HDTV",
  cam: "CAM",
  ts: "TS",
  tc: "TC",
  scr: "SCR",

  hdr: "HDR",
  hdr10: "HDR10",
  "hdr10+": "HDR10_PLUS",
  hdr10plus: "HDR10_PLUS",
  hlg: "HLG",
  dv: "DV",
  dovi: "DV",
  dolbyvision: "DV",
  sdr: "SDR",
  "10bit": "TEN_BIT",
  "3d": "THREE_D",
  imax: "IMAX",
  ai: "AI",
  hou: "H_OU",
  hsbs: "H_SBS",

  atmos: "ATMOS",
  truehd: "TRUEHD",
  "dd+": "DD_PLUS",
  ddp: "DD_PLUS",
  eac3: "DD_PLUS",
  "ec3": "DD_PLUS",
  dolbydigitalplus: "DD_PLUS",
  dd: "DD",
  ac3: "DD",
  dolbydigital: "DD",
  dtshdma: "DTS_HD_MA",
  dtshd: "DTS_HD",
  dtsx: "DTS_X",
  dtses: "DTS_ES",
  dts: "DTS",
  opus: "OPUS",
  flac: "FLAC",
  aac: "AAC",
  mp4a: "AAC",

  av1: "AV1",
  hevc: "HEVC",
  h265: "HEVC",
  x265: "HEVC",
  avc: "AVC",
  h264: "AVC",
  x264: "AVC",
  vp9: "VP9",
  xvid: "XVID",
  divx: "DIVX",

  mkv: "MKV",
  matroska: "MKV",
  webm: "WEBM",
  mp4: "MP4"
};

const MAX_TERM_TOKENS = 3;

// Greedy longest-window-first, so "dts hd ma" resolves to DTS_HD_MA and can
// never fall through to the shorter DTS_HD or DTS entries.
export function tagsIn(text = "", terms = TERMS) {
  const tokens = tokenize(text);
  const found = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    for (let size = Math.min(MAX_TERM_TOKENS, tokens.length - index); size >= 1; size -= 1) {
      const tag = terms[tokens.slice(index, index + size).join("")];
      if (tag) {
        found.add(tag);
        index += size - 1;
        break;
      }
    }
  }
  return found;
}

// Single-value categories: first entry present wins, so precedence stays
// explicit instead of depending on Set iteration order.
export function firstTag(found, ranked) {
  return ranked.find((tag) => found.has(tag)) || "UNKNOWN";
}

export function orderedTags(found, ranked) {
  const tags = ranked.filter((tag) => found.has(tag));
  return tags.length ? tags : ["UNKNOWN"];
}

export const RESOLUTION_PRECEDENCE = ["P2160", "P1440", "P1080", "P720", "P576", "P480", "P360"];
export const QUALITY_PRECEDENCE = [
  "BLURAY_REMUX",
  "BLURAY",
  "WEB_DL",
  "WEBRIP",
  "HDRIP",
  "HD_RIP",
  "DVDRIP",
  "HDTV",
  "CAM",
  "TS",
  "TC",
  "SCR"
];
export const ENCODE_PRECEDENCE = ["AV1", "HEVC", "AVC", "XVID", "DIVX"];
const VISUAL_TAG_ORDER = [
  "HDR_DV",
  "DV_ONLY",
  "HDR_ONLY",
  "HDR10_PLUS",
  "HDR10",
  "DV",
  "HDR",
  "HLG",
  "TEN_BIT",
  "THREE_D",
  "IMAX",
  "AI",
  "SDR",
  "H_OU",
  "H_SBS"
];
const AUDIO_TAG_ORDER = [
  "ATMOS",
  "DD_PLUS",
  "DD",
  "DTS_X",
  "DTS_HD_MA",
  "DTS_HD",
  "DTS_ES",
  "DTS",
  "TRUEHD",
  "OPUS",
  "FLAC",
  "AAC"
];

export const HDR_TAGS = ["HDR", "HDR10", "HDR10_PLUS", "HLG"];

export function resolutionFromText(text = "") {
  return firstTag(tagsIn(text), RESOLUTION_PRECEDENCE);
}

export function qualityFromText(text = "") {
  // Keep HD-Rip distinct from HDRip. Token compaction intentionally makes
  // separator variants equivalent for most tags, but these two labels have
  // different meanings and therefore need the separator to remain semantic.
  if (/(^|[^a-z0-9])hd[\s._-]+rip([^a-z0-9]|$)/i.test(String(text || ""))) {
    return "HD_RIP";
  }
  return firstTag(tagsIn(text), QUALITY_PRECEDENCE);
}

export function encodeFromText(parsedCodec, search = "") {
  return firstTag(tagsIn([parsedCodec, search].filter(Boolean).join(" ")), ENCODE_PRECEDENCE);
}

export function visualTagsFromText(parsedHdr = [], search = "") {
  const parsed = Array.isArray(parsedHdr) ? parsedHdr : [];
  const found = tagsIn([...parsed, search].join(" "));
  const hasDv = found.has("DV");
  const hasHdr = HDR_TAGS.some((tag) => found.has(tag));

  // Broader tags are implied by the specific ones.
  if (found.has("HDR10_PLUS")) found.add("HDR10");
  if (hasHdr) found.add("HDR");
  if (hasDv && hasHdr) found.add("HDR_DV");
  if (hasDv && !hasHdr) found.add("DV_ONLY");
  if (hasHdr && !hasDv) found.add("HDR_ONLY");
  // A release carrying HDR or DV is not SDR, whatever else the name claims.
  if (hasHdr || hasDv) found.delete("SDR");

  return orderedTags(found, VISUAL_TAG_ORDER);
}

export function audioTagsFromText(parsedAudio = [], search = "") {
  const text = [...(Array.isArray(parsedAudio) ? parsedAudio : []), search].join(" ");
  const found = tagsIn(text);
  // Android historically exposes the generic DD tag alongside the explicit
  // "Dolby Digital Plus" label, while compact DDP/EAC3 remain DD_PLUS only.
  if (/(^|[^a-z0-9])dolby[\s._-]+digital[\s._-]+plus([^a-z0-9]|$)/i.test(text)) {
    found.add("DD");
  }
  if (found.has("DTS_HD_MA")) found.add("DTS_HD");
  if (["DTS_X", "DTS_HD_MA", "DTS_HD", "DTS_ES"].some((tag) => found.has(tag))) found.add("DTS");
  return orderedTags(found, AUDIO_TAG_ORDER);
}

// Channels stay on a regex: tokenizing drops the separator, so a "7" next to an
// unrelated "1" would read as 7.1.
export function audioChannelsFromText(parsedChannels = [], search = "") {
  const text = [...(Array.isArray(parsedChannels) ? parsedChannels : []), search]
    .join(" ")
    .toLowerCase();
  const channels = [];
  if (/(^|[^0-9])7[\s._-]1(?![0-9])/.test(text)) channels.push("CH_7_1");
  if (/(^|[^0-9])6[\s._-]1(?![0-9])/.test(text)) channels.push("CH_6_1");
  if (/(^|[^0-9])5[\s._-]1(?![0-9])/.test(text) || /(^|[^a-z0-9])6ch([^a-z0-9]|$)/.test(text))
    channels.push("CH_5_1");
  if (/(^|[^0-9])2[\s._-]0(?![0-9])/.test(text)) channels.push("CH_2_0");
  return channels.length ? channels : ["UNKNOWN"];
}

// Builds a language term table in the same shape as TERMS, so both the code
// ("pt-br") and the label ("Brazilian Portuguese") resolve to the language key.
export function buildLanguageTerms(labels = {}) {
  const terms = {};
  Object.entries(labels).forEach(([key, [code, label]]) => {
    [code, label].forEach((term) => {
      terms[tokenize(term).join("")] = key;
    });
  });
  return terms;
}
