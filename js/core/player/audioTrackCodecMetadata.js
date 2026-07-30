function cleanCodecText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatAudioCodecName(value) {
  const text = cleanCodecText(value).toLowerCase();
  if (!text) {
    return "";
  }

  if (text.includes("truehd") && text.includes("atmos")) return "TrueHD Atmos";
  if (
    text.includes("eac3-joc") ||
    text.includes("ec-3-joc") ||
    text.includes("e-ac-3-joc") ||
    /\bjoc\b/.test(text) ||
    text.includes("atmos")
  )
    return "E-AC-3-JOC";
  if (text.includes("truehd")) return "TrueHD";
  if (text.includes("dts-hd")) return "DTS-HD";
  if (text.includes("dts express")) return "DTS Express";
  if (text.includes("dts")) return "DTS";
  if (
    text.includes("ec-3") ||
    text.includes("eac3") ||
    text.includes("ddp") ||
    text.includes("dolby digital plus")
  )
    return "E-AC-3";
  if (text.includes("ac-3") || text.includes("ac3") || text.includes("dolby digital"))
    return "AC-3";
  if (text.includes("ac-4") || text.includes("ac4")) return "AC-4";
  if (text.includes("aac") || text.includes("mp4a")) return "AAC";
  if (text.includes("mp3") || text.includes("mpeg audio")) return "MP3";
  if (text.includes("mp2")) return "MP2";
  if (text.includes("vorbis")) return "Vorbis";
  if (text.includes("opus")) return "Opus";
  if (text.includes("flac")) return "FLAC";
  if (text.includes("alac")) return "ALAC";
  if (text.includes("wav") || text.includes("pcm")) return "WAV";
  if (text.includes("amr-wb")) return "AMR-WB";
  if (text.includes("amr-nb")) return "AMR-NB";
  if (text.includes("amr")) return "AMR";
  if (text.includes("iamf")) return "IAMF";
  if (text.includes("mpegh") || text.includes("mhm1") || text.includes("mha1")) return "MPEG-H";
  return "";
}

export function getAuthoritativeAudioCodecValue(track = {}) {
  const candidates = [
    track?.sampleMimeType,
    track?.sample_mime_type,
    track?.codec,
    track?.codecs,
    track?.audioCodec,
    track?.codec_name,
    track?.codec_id,
    track?.codec_tag_string,
    track?.mimeType,
    track?.mime_type,
    track?.codecProfile,
    track?.codec_profile,
    track?.format,
    track?.format_name
  ];
  return candidates.map(cleanCodecText).find((value) => Boolean(formatAudioCodecName(value))) || "";
}

export function getAudioTrackCodecCompatibilityText(track = {}, fallbackMetadataText = "") {
  const recognizedCodec = getAuthoritativeAudioCodecValue(track);
  if (recognizedCodec) {
    return recognizedCodec;
  }
  const structuredCodec = [
    track?.sampleMimeType,
    track?.sample_mime_type,
    track?.codec,
    track?.codecs,
    track?.audioCodec,
    track?.codec_name,
    track?.codec_id,
    track?.codec_tag_string,
    track?.mimeType,
    track?.mime_type,
    track?.codecProfile,
    track?.codec_profile,
    track?.format,
    track?.format_name
  ]
    .map(cleanCodecText)
    .find(Boolean);
  return structuredCodec || cleanCodecText(fallbackMetadataText);
}

export function getAudioCodecFamily(value) {
  const codecName = formatAudioCodecName(value).toLowerCase();
  if (!codecName) {
    return "";
  }
  if (codecName.startsWith("dts")) return "dts";
  if (codecName.startsWith("truehd")) return "truehd";
  if (codecName.startsWith("e-ac-3")) return "eac3";
  return codecName;
}

export function audioTrackLabelConflictsWithCodec(label, authoritativeCodecValue) {
  const labelFamily = getAudioCodecFamily(label);
  const codecFamily = getAudioCodecFamily(authoritativeCodecValue);
  return Boolean(labelFamily && codecFamily && labelFamily !== codecFamily);
}

export function getAudioTrackLabelPrefix(label) {
  const prefix = cleanCodecText(label).split(/[/|·]/)[0]?.trim() || "";
  return prefix && !formatAudioCodecName(prefix) ? prefix : "";
}

export function mapAudioTrackNativeIndexes(
  supportedTracks = [],
  { filterUnsupported = false } = {}
) {
  let nextNativeIndex = 0;
  return supportedTracks.map((supported, index) => {
    if (!filterUnsupported) {
      return index;
    }
    if (supported === false) {
      return -1;
    }
    const nativeIndex = nextNativeIndex;
    nextNativeIndex += 1;
    return nativeIndex;
  });
}
