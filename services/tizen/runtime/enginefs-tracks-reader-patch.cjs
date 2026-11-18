/* Fixes the vendored embedded-track reader behind /tracks. ES5 for TV runtimes. */
// Seen on a Tizen 5.0 TV (EngineFS on Node 4.4.3), where /tracks never
// answered and, once its Buffer gaps were filled, froze the whole service:
// 1. After each range read the reader stored the chunk length as the next
//    offset instead of advancing by it, so it re-read the second range
//    (16384-32767) forever.
// 2. Every chunk that arrives is handed to the decoder, but the Matroska
//    decoder parses each chunk as if it began at the file start. A later
//    chunk starts mid-element, an element size of 0 is read, and the parse
//    loop never advances: the service's only thread spins forever.
// So the parse loops stop on an element that cannot advance, and one chunk is
// decoded at a time; a seek the decoder asks for (MP4 moov lookup) re-arms it.
var MARKER = "/* NUVIO_TRACKS_READER_FIXES */";

module.exports = function patchEngineFsTracksReader(source) {
  var code = String(source || "");
  if (code.indexOf(MARKER) !== -1) {
    return code;
  }
  var patched = code.replace(
    /([A-Za-z_$][\w$]*)\.bytesRead\+=([A-Za-z_$][\w$]*)\.length,\1\.bytesOffset=\2\.length/g,
    "$1.bytesRead+=$2.length,$1.bytesOffset+=$2.length"
  );
  patched = patched.replace(
    /for\(var ([A-Za-z_$][\w$]*)=\[\],([A-Za-z_$][\w$]*)=0;\2<([A-Za-z_$][\w$]*)\.length;\)\{var ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\3,\2\);\1\.push\(\4\),\2\+=\4\.size\}return \1/g,
    "for(var $1=[],$2=0;$2<$3.length;){var $4=$5($3,$2);if(!($4.size>0))break;$1.push($4),$2+=$4.size}return $1"
  );
  var seek =
    /([A-Za-z_$][\w$]*)=function\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{([A-Za-z_$][\w$]*)\.pause\(\),\4\.bytesOffset=\2,\4\.chunkSize=null!=\3\?\3:15728640,\4\.resume\(\)\}/;
  var seekMatch = seek.exec(patched);
  if (seekMatch) {
    var readerName = seekMatch[4];
    patched = patched.replace(
      seek,
      "$1=function($2,$3){$4.__nuvioDecoding=!1,$4.pause(),$4.bytesOffset=$2,$4.chunkSize=null!=$3?$3:15728640,$4.resume()}"
    );
    patched = patched.replace(
      /([A-Za-z_$][\w$]*)\?\(\1\.decode\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\.then\(([A-Za-z_$][\w$]*)\)\.catch\(([A-Za-z_$][\w$]*)\),\[2\]\)/,
      "$1?(" +
        readerName +
        ".__nuvioDecoding||(" +
        readerName +
        ".__nuvioDecoding=!0,$1.decode($2,$3).then($4).catch($5)),[2])"
    );
  }
  return patched === code ? code : patched + "\n" + MARKER + "\n";
};
